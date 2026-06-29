import unittest
from datetime import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

import main
from db import (
    CommerceQnaAnalysis,
    CommerceQnaAnalysisIssueTag,
    CommerceQnaAnalysisKeyword,
    CommerceQnaDraft,
    CommerceQnaDraftValidation,
    CommerceQnaFeedbackKnowledge,
    CommerceQnaRaw,
    CommerceQnaSubmitLog,
    SessionLocal,
    init_db,
)
from schemas import QnaDraftResponse, QnaSyncRequest, QnaWorkbenchItem


class QnaApiTest(unittest.TestCase):
    def setUp(self) -> None:
        init_db()
        self.client = TestClient(main.app)
        with SessionLocal() as db:
            db.query(CommerceQnaAnalysisIssueTag).delete(synchronize_session=False)
            db.query(CommerceQnaAnalysisKeyword).delete(synchronize_session=False)
            db.query(CommerceQnaAnalysis).delete(synchronize_session=False)
            db.query(CommerceQnaSubmitLog).delete(synchronize_session=False)
            db.query(CommerceQnaDraftValidation).delete(synchronize_session=False)
            db.query(CommerceQnaFeedbackKnowledge).delete(synchronize_session=False)
            db.query(CommerceQnaDraft).delete(synchronize_session=False)
            db.query(CommerceQnaRaw).delete(synchronize_session=False)
            db.commit()

    def test_qna_model_name_fields_disable_protected_namespace_warning(self) -> None:
        protected_namespaces_response = tuple(QnaDraftResponse.model_config.get("protected_namespaces", ()))
        protected_namespaces_workbench = tuple(QnaWorkbenchItem.model_config.get("protected_namespaces", ()))
        self.assertEqual(protected_namespaces_response, ())
        self.assertEqual(protected_namespaces_workbench, ())

    def _insert_qna(
        self,
        *,
        qna_key: str,
        qna_kind: str,
        external_inquiry_id: str,
        inquiry_text: str,
        answered: bool = False,
        answer_text: str | None = None,
        answer_content_id: str | None = None,
        category: str | None = None,
        inquiry_registered_at: datetime | None = None,
    ) -> None:
        with SessionLocal() as db:
            db.add(
                CommerceQnaRaw(
                    qna_key=qna_key,
                    qna_kind=qna_kind,
                    external_inquiry_id=external_inquiry_id,
                    title="문의 제목" if qna_kind == "customer" else None,
                    category=category,
                    inquiry_text=inquiry_text,
                    answered=answered,
                    answer_text=answer_text,
                    answer_content_id=answer_content_id,
                    product_name="테스트 상품",
                    customer_name="홍길동" if qna_kind == "customer" else None,
                    masked_writer_id="user****" if qna_kind == "product" else None,
                    inquiry_registered_at=inquiry_registered_at,
                )
            )
            db.commit()

    def _insert_draft(
        self,
        *,
        draft_id: str,
        qna_key: str,
        status: str,
        draft_text: str,
    ) -> None:
        with SessionLocal() as db:
            db.add(
                CommerceQnaDraft(
                    draft_id=draft_id,
                    qna_key=qna_key,
                    status=status,
                    draft_text=draft_text,
                    model_name="gpt-test",
                    prompt_version="commerce_qna_v1",
                )
            )
            db.commit()

    def test_update_qna_draft_marks_validation_as_needs_recheck(self) -> None:
        self._insert_qna(
            qna_key="customer:update-validate",
            qna_kind="customer",
            external_inquiry_id="update-validate",
            inquiry_text="배송 일정이 궁금합니다.",
            category="배송",
        )
        self._insert_draft(
            draft_id="draft-update-validate",
            qna_key="customer:update-validate",
            status="generated",
            draft_text="기존 초안",
        )
        with SessionLocal() as db:
            db.add(
                CommerceQnaDraftValidation(
                    draft_id="draft-update-validate",
                    qna_key="customer:update-validate",
                    check_status="passed",
                )
            )
            db.commit()

        resp = self.client.post(
            "/qna/drafts/update",
            json={
                "draft_id": "draft-update-validate",
                "draft_text": "수정된 초안입니다.",
            },
        )

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        workbench = self.client.get("/qna/workbench")
        self.assertEqual(workbench.status_code, 200, msg=workbench.text)
        item = next(row for row in (workbench.json().get("items") or []) if row["qna_key"] == "customer:update-validate")
        self.assertEqual(item["validation_result"]["status"], "needs_recheck")

    def test_validate_qna_draft_saves_manual_validation_result(self) -> None:
        self._insert_qna(
            qna_key="customer:manual-validate",
            qna_kind="customer",
            external_inquiry_id="manual-validate",
            inquiry_text="배송 일정이 궁금합니다.",
            category="배송",
        )
        self._insert_draft(
            draft_id="draft-manual-validate",
            qna_key="customer:manual-validate",
            status="generated",
            draft_text="오늘 100% 출고되며 내일 무조건 도착합니다.",
        )

        resp = self.client.post(
            "/qna/drafts/validate",
            json={
                "draft_id": "draft-manual-validate",
            },
        )

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertEqual(body["validation_result"]["status"], "failed")
        self.assertGreater(len(body["validation_result"]["final_issues"]), 0)

        with SessionLocal() as db:
            validation_row = (
                db.query(CommerceQnaDraftValidation)
                .filter(CommerceQnaDraftValidation.draft_id == "draft-manual-validate")
                .one_or_none()
            )
            self.assertIsNotNone(validation_row)
            self.assertEqual(str(getattr(validation_row, "check_status", "")), "failed")

    def test_approve_qna_draft_is_blocked_when_validation_failed(self) -> None:
        self._insert_qna(
            qna_key="customer:approve-blocked",
            qna_kind="customer",
            external_inquiry_id="approve-blocked",
            inquiry_text="배송 일정이 궁금합니다.",
            category="배송",
        )
        self._insert_draft(
            draft_id="draft-approve-blocked",
            qna_key="customer:approve-blocked",
            status="generated",
            draft_text="문제 있는 초안",
        )
        with SessionLocal() as db:
            db.add(
                CommerceQnaDraftValidation(
                    draft_id="draft-approve-blocked",
                    qna_key="customer:approve-blocked",
                    check_status="failed",
                    final_issues_json='["근거 없는 확정 표현을 수정하세요."]',
                )
            )
            db.commit()

        resp = self.client.post(
            "/qna/drafts/status",
            json={
                "draft_id": "draft-approve-blocked",
                "status": "approved",
            },
        )

        self.assertEqual(resp.status_code, 409, msg=resp.text)
        self.assertIn("draft_validation_blocked", resp.text)

    def test_sync_qna_saves_customer_and_product_items(self) -> None:
        customer_items = [
            {
                "inquiryNo": 101,
                "category": "배송",
                "title": "언제 오나요?",
                "inquiryContent": "배송 일정이 궁금합니다.",
                "answered": False,
                "orderId": "ORDER-1",
                "productNo": "5001",
                "productName": "테스트 샴푸",
                "customerName": "홍길동",
            }
        ]
        product_items = [
            {
                "questionId": 9001,
                "question": "민감성 두피에도 사용 가능한가요?",
                "answer": None,
                "answered": False,
                "productId": 6001,
                "productName": "테스트 샴푸",
                "maskedWriterId": "abc***",
            }
        ]

        with patch("qna_api._fetch_customer_inquiries", return_value=customer_items), patch(
            "qna_api._fetch_product_qnas", return_value=product_items
        ):
            resp = self.client.post("/qna/sync", json={})

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertEqual(body["customer_fetched"], 1)
        self.assertEqual(body["product_fetched"], 1)

        with SessionLocal() as db:
            rows = db.query(CommerceQnaRaw).order_by(CommerceQnaRaw.qna_key.asc()).all()
            self.assertEqual(len(rows), 2)
            self.assertEqual(rows[0].qna_key, "customer:101")
            self.assertEqual(rows[1].qna_key, "product:9001")

    def test_sync_qna_accepts_explicit_date_range(self) -> None:
        captured: dict[str, tuple[str | None, str | None]] = {}

        def fake_fetch_customer(_db, req):
            captured["customer"] = (
                req.start_date.isoformat() if req.start_date else None,
                req.end_date.isoformat() if req.end_date else None,
            )
            return []

        def fake_fetch_product(_db, req):
            captured["product"] = (
                req.start_date.isoformat() if req.start_date else None,
                req.end_date.isoformat() if req.end_date else None,
            )
            return []

        with patch("qna_api._fetch_customer_inquiries", side_effect=fake_fetch_customer), patch(
            "qna_api._fetch_product_qnas", side_effect=fake_fetch_product
        ):
            resp = self.client.post(
                "/qna/sync",
                json={"start_date": "2026-04-01", "end_date": "2026-04-04"},
            )

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        self.assertEqual(captured["customer"], ("2026-04-01", "2026-04-04"))
        self.assertEqual(captured["product"], ("2026-04-01", "2026-04-04"))

    def test_customer_sync_splits_long_date_range_into_windows(self) -> None:
        with SessionLocal() as db:
            called_ranges: list[tuple[str | None, str | None]] = []

            def fake_call_json(*_args, **kwargs):
                params = kwargs.get("params") or {}
                called_ranges.append((params.get("startSearchDate"), params.get("endSearchDate")))
                return 200, {"content": []}, None

            with patch("qna_api._commerce_call_json", side_effect=fake_call_json):
                from qna_api import _fetch_customer_inquiries

                _fetch_customer_inquiries(
                    db,
                    QnaSyncRequest(
                        start_date="2025-01-01",
                        end_date="2025-07-15",
                        customer_pages=1,
                        customer_page_size=50,
                    ),
                )

        self.assertEqual(
            called_ranges,
            [
                ("2025-01-01", "2025-03-31"),
                ("2025-04-01", "2025-06-29"),
                ("2025-06-30", "2025-07-15"),
            ],
        )

    def test_workbench_filters_items_by_inquiry_date_range(self) -> None:
        self._insert_qna(
            qna_key="customer:111",
            qna_kind="customer",
            external_inquiry_id="111",
            inquiry_text="4월 1일 문의",
            inquiry_registered_at=datetime(2026, 4, 1, 9, 0, tzinfo=ZoneInfo("Asia/Seoul")),
        )
        self._insert_qna(
            qna_key="product:222",
            qna_kind="product",
            external_inquiry_id="222",
            inquiry_text="4월 4일 문의",
            inquiry_registered_at=datetime(2026, 4, 4, 9, 0, tzinfo=ZoneInfo("Asia/Seoul")),
        )

        resp = self.client.get("/qna/workbench?from_date=2026-04-04&to_date=2026-04-04")

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertEqual(body["dashboard"]["total_items"], 1)
        self.assertEqual(len(body["items"]), 1)
        self.assertEqual(body["items"][0]["qna_key"], "product:222")

    def test_workbench_filters_items_by_issue_tag(self) -> None:
        self._insert_qna(
            qna_key="product:odor-1",
            qna_kind="product",
            external_inquiry_id="odor-1",
            inquiry_text="사용 후 냄새가 너무 강합니다.",
            category="불만",
            inquiry_registered_at=datetime(2026, 4, 5, 9, 0, tzinfo=ZoneInfo("Asia/Seoul")),
        )
        self._insert_qna(
            qna_key="product:color-1",
            qna_kind="product",
            external_inquiry_id="color-1",
            inquiry_text="색상이 사진과 다릅니다.",
            category="불만",
            inquiry_registered_at=datetime(2026, 4, 5, 10, 0, tzinfo=ZoneInfo("Asia/Seoul")),
        )
        with SessionLocal() as db:
            db.add(
                CommerceQnaAnalysisIssueTag(
                    qna_key="product:odor-1",
                    issue_tag="ODOR",
                    severity="HIGH",
                )
            )
            db.add(
                CommerceQnaAnalysisIssueTag(
                    qna_key="product:color-1",
                    issue_tag="COLOR_DIFF",
                    severity="MEDIUM",
                )
            )
            db.commit()

        resp = self.client.get("/qna/workbench?issue_tag=%EB%83%84%EC%83%88")

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertEqual(body["dashboard"]["total_items"], 1)
        self.assertEqual(body["dashboard"]["issue_tag_counts"].get("냄새"), 1)
        self.assertEqual(body["dashboard"]["issue_tag_counts"].get("색상"), 1)
        self.assertEqual(len(body["items"]), 1)
        self.assertEqual(body["items"][0]["qna_key"], "product:odor-1")
        self.assertIn("냄새", body["items"][0]["issue_tags"])

    def test_generate_qna_draft_calls_openai_and_saves_row(self) -> None:
        self._insert_qna(
            qna_key="customer:201",
            qna_kind="customer",
            external_inquiry_id="201",
            inquiry_text="배송이 언제 오는지 알고 싶습니다.",
            category="배송",
        )

        class FakeResp:
            status_code = 200

            def json(self):
                return {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": "안녕하세요 고객님, 문의 주셔서 감사합니다. 배송 일정은 주문 정보를 확인한 뒤 빠르게 안내드리겠습니다.",
                            }
                        }
                    ],
                    "model": "gpt-test",
                }

        with patch("qna_api._get_api_setting", return_value="sk-test"), patch(
            "qna_api._post_openai_chat_completion_compatible", return_value=FakeResp()
        ):
            resp = self.client.post("/qna/drafts/generate", json={"qna_key": "customer:201"})

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body["generated_now"])
        self.assertEqual(body["status"], "generated")
        self.assertIn("배송 일정", body["draft_text"])

        with SessionLocal() as db:
            rows = db.query(CommerceQnaDraft).filter(CommerceQnaDraft.qna_key == "customer:201").all()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0].status, "generated")

    def test_generate_qna_draft_saves_validation_result_and_exposes_in_workbench(self) -> None:
        self._insert_qna(
            qna_key="customer:validate-1",
            qna_kind="customer",
            external_inquiry_id="validate-1",
            inquiry_text="배송이 언제 오는지 알고 싶습니다.",
            category="배송",
        )

        class FakeResp:
            status_code = 200

            def json(self):
                return {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": "안녕하세요 고객님, 주문 정보를 확인한 뒤 배송 일정을 안내드리겠습니다.",
                            }
                        }
                    ],
                    "model": "gpt-test",
                }

        with patch("qna_api._get_api_setting", return_value="sk-test"), patch(
            "qna_api._post_openai_chat_completion_compatible", return_value=FakeResp()
        ):
            resp = self.client.post("/qna/drafts/generate", json={"qna_key": "customer:validate-1"})

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertEqual(body["validation_result"]["status"], "passed")
        self.assertEqual(body["validation_result"]["initial_issues"], [])
        self.assertFalse(body["validation_result"]["rewrite_attempted"])

        with SessionLocal() as db:
            validation_row = (
                db.query(CommerceQnaDraftValidation)
                .filter(CommerceQnaDraftValidation.draft_id == body["draft_id"])
                .one_or_none()
            )
            self.assertIsNotNone(validation_row)
            self.assertEqual(str(getattr(validation_row, "check_status", "")), "passed")

        workbench = self.client.get("/qna/workbench")
        self.assertEqual(workbench.status_code, 200, msg=workbench.text)
        item = next(row for row in (workbench.json().get("items") or []) if row["qna_key"] == "customer:validate-1")
        self.assertEqual(item["validation_result"]["status"], "passed")
        self.assertEqual(item["validation_result"]["final_issues"], [])

    def test_example_corpus_prioritizes_same_category_and_product(self) -> None:
        target_registered_at = datetime(2026, 4, 4, 9, 0, tzinfo=ZoneInfo("Asia/Seoul"))
        self._insert_qna(
            qna_key="customer:target",
            qna_kind="customer",
            external_inquiry_id="700",
            inquiry_text="배송 일정이 궁금합니다.",
            category="배송",
            inquiry_registered_at=target_registered_at,
        )
        with SessionLocal() as db:
            target = db.query(CommerceQnaRaw).filter(CommerceQnaRaw.qna_key == "customer:target").one()
            target.product_name = "테스트 샴푸"
            target.customer_name = "홍길동"
            db.add(
                CommerceQnaRaw(
                    qna_key="customer:answered-other",
                    qna_kind="customer",
                    external_inquiry_id="701",
                    category="배송",
                    inquiry_text="언제 출고되나요?",
                    answered=True,
                    answer_text="안녕하세요 고객님, 순차 출고 예정입니다.",
                    product_name="다른 상품",
                    inquiry_registered_at=datetime(2026, 4, 3, 9, 0, tzinfo=ZoneInfo("Asia/Seoul")),
                )
            )
            db.add(
                CommerceQnaRaw(
                    qna_key="customer:approved-best",
                    qna_kind="customer",
                    external_inquiry_id="702",
                    category="배송",
                    inquiry_text="배송은 언제 되나요?",
                    answered=False,
                    product_name="테스트 샴푸",
                    inquiry_registered_at=datetime(2026, 4, 2, 9, 0, tzinfo=ZoneInfo("Asia/Seoul")),
                )
            )
            db.add(
                CommerceQnaDraft(
                    draft_id="draft-approved-best",
                    qna_key="customer:approved-best",
                    status="approved",
                    draft_text="안녕하세요 고객님, 주문 정보를 확인한 뒤 배송 일정을 신속히 안내드리겠습니다.",
                    model_name="gpt-test",
                    prompt_version="commerce_qna_v1",
                )
            )
            db.commit()

            from qna_api import _build_qna_example_corpus

            examples = _build_qna_example_corpus(db, qna_row=target, limit=3)

        self.assertGreaterEqual(len(examples), 2)
        self.assertIn("주문 정보를 확인한 뒤 배송 일정을 신속히 안내드리겠습니다.", examples[0])

    def test_generate_qna_draft_rewrites_once_when_validation_fails(self) -> None:
        self._insert_qna(
            qna_key="customer:202",
            qna_kind="customer",
            external_inquiry_id="202",
            inquiry_text="배송이 언제 오는지 알고 싶습니다.",
            category="배송",
        )

        captured_payloads: list[dict] = []

        class FakeResp:
            def __init__(self, content: str, model: str = "gpt-test"):
                self.status_code = 200
                self._content = content
                self._model = model

            def json(self):
                return {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": self._content,
                            }
                        }
                    ],
                    "model": self._model,
                }

        responses = [
            FakeResp("오늘 바로 출고되며 100% 내일 도착합니다."),
            FakeResp("안녕하세요 고객님, 주문 정보를 확인한 뒤 배송 일정을 다시 안내드리겠습니다."),
        ]

        def fake_post(*args, **kwargs):
            captured_payloads.append(dict(kwargs.get("payload") or {}))
            return responses.pop(0)

        with patch("qna_api._get_api_setting", return_value="sk-test"), patch(
            "qna_api._post_openai_chat_completion_compatible", side_effect=fake_post
        ):
            resp = self.client.post("/qna/drafts/generate", json={"qna_key": "customer:202"})

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body["generated_now"])
        self.assertEqual(body["status"], "generated")
        self.assertIn("주문 정보를 확인한 뒤", body["draft_text"])
        self.assertEqual(body["validation_result"]["status"], "rewritten_passed")
        self.assertTrue(body["validation_result"]["rewrite_attempted"])
        self.assertTrue(body["validation_result"]["rewrite_succeeded"])
        self.assertGreater(len(body["validation_result"]["initial_issues"]), 0)
        self.assertEqual(body["validation_result"]["final_issues"], [])
        self.assertEqual(len(captured_payloads), 2)
        first_messages = captured_payloads[0].get("messages") or []
        second_messages = captured_payloads[1].get("messages") or []
        self.assertIn("배송", str(first_messages))
        self.assertIn("초안을 아래 규칙에 맞게 다시 써줘", str(second_messages))

        with SessionLocal() as db:
            validation_row = (
                db.query(CommerceQnaDraftValidation)
                .filter(CommerceQnaDraftValidation.draft_id == body["draft_id"])
                .one_or_none()
            )
            self.assertIsNotNone(validation_row)
            self.assertEqual(str(getattr(validation_row, "check_status", "")), "rewritten_passed")

    def test_reject_qna_draft_saves_feedback_knowledge(self) -> None:
        self._insert_qna(
            qna_key="product:301",
            qna_kind="product",
            external_inquiry_id="301",
            inquiry_text="향이 강한가요?",
            category="상품",
        )
        self._insert_draft(
            draft_id="draft-reject-1",
            qna_key="product:301",
            status="generated",
            draft_text="향이 강하지 않습니다.",
        )

        resp = self.client.post(
            "/qna/drafts/status",
            json={
                "draft_id": "draft-reject-1",
                "status": "rejected",
                "rejection_comment": "강한 향 여부를 단정하지 말고 개인차 안내를 넣어주세요.",
            },
        )

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        with SessionLocal() as db:
            draft = db.query(CommerceQnaDraft).filter(CommerceQnaDraft.draft_id == "draft-reject-1").one()
            knowledge_rows = db.query(CommerceQnaFeedbackKnowledge).filter(
                CommerceQnaFeedbackKnowledge.source_draft_id == "draft-reject-1"
            ).all()
            self.assertEqual(draft.status, "rejected")
            self.assertEqual(len(knowledge_rows), 1)

    def test_submit_customer_qna_updates_raw_and_log(self) -> None:
        self._insert_qna(
            qna_key="customer:401",
            qna_kind="customer",
            external_inquiry_id="401",
            inquiry_text="교환은 어떻게 진행되나요?",
            category="교환",
        )
        self._insert_draft(
            draft_id="draft-submit-customer",
            qna_key="customer:401",
            status="approved",
            draft_text="안녕하세요 고객님, 교환 접수 여부를 확인한 뒤 순서대로 안내드리겠습니다.",
        )

        with patch("qna_api._commerce_call_json", return_value=(200, {"answerContentId": 555}, None)):
            resp = self.client.post("/qna/drafts/submit", json={"draft_id": "draft-submit-customer"})

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertEqual(body["status"], "submitted")
        self.assertEqual(body["remote_answer_content_id"], "555")

        with SessionLocal() as db:
            qna_row = db.query(CommerceQnaRaw).filter(CommerceQnaRaw.qna_key == "customer:401").one()
            draft_row = db.query(CommerceQnaDraft).filter(CommerceQnaDraft.draft_id == "draft-submit-customer").one()
            submit_log = db.query(CommerceQnaSubmitLog).filter(
                CommerceQnaSubmitLog.draft_id == "draft-submit-customer"
            ).one()
            self.assertTrue(qna_row.answered)
            self.assertEqual(qna_row.answer_content_id, "555")
            self.assertEqual(draft_row.status, "submitted")
            self.assertTrue(submit_log.success)
            self.assertEqual(submit_log.request_method, "POST")

    def test_submit_product_qna_uses_put_path(self) -> None:
        self._insert_qna(
            qna_key="product:501",
            qna_kind="product",
            external_inquiry_id="501",
            inquiry_text="두피가 예민한데 사용 가능할까요?",
            category="상품",
        )
        self._insert_draft(
            draft_id="draft-submit-product",
            qna_key="product:501",
            status="approved",
            draft_text="안녕하세요 고객님, 예민한 두피는 성분을 먼저 확인하신 뒤 사용 여부를 결정하시는 것을 권장드립니다.",
        )

        with patch("qna_api._commerce_call_json", return_value=(204, {}, None)):
            resp = self.client.post("/qna/drafts/submit", json={"draft_id": "draft-submit-product"})

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        with SessionLocal() as db:
            submit_log = db.query(CommerceQnaSubmitLog).filter(
                CommerceQnaSubmitLog.draft_id == "draft-submit-product"
            ).one()
            self.assertEqual(submit_log.request_method, "PUT")
            self.assertEqual(submit_log.request_path, "/v1/contents/qnas/501")

    def test_run_qna_analysis_builds_summary_and_trends(self) -> None:
        self._insert_qna(
            qna_key="customer:analysis-1",
            qna_kind="customer",
            external_inquiry_id="analysis-1",
            inquiry_text="민감한 두피도 사용 가능한가요? 구매 전에 안전성이 궁금합니다.",
            category="상품",
            inquiry_registered_at=datetime(2026, 4, 1, 9, 0, tzinfo=ZoneInfo("Asia/Seoul")),
        )
        self._insert_qna(
            qna_key="customer:analysis-2",
            qna_kind="customer",
            external_inquiry_id="analysis-2",
            inquiry_text="얼마나 지속되나요? 구매 직전에 가장 궁금합니다.",
            category="효과",
            inquiry_registered_at=datetime(2026, 4, 2, 10, 0, tzinfo=ZoneInfo("Asia/Seoul")),
        )
        self._insert_qna(
            qna_key="product:analysis-3",
            qna_kind="product",
            external_inquiry_id="analysis-3",
            inquiry_text="사용 후 냄새가 너무 강하고 색상이 달라서 불만입니다.",
            category="불만",
            inquiry_registered_at=datetime(2026, 4, 3, 11, 0, tzinfo=ZoneInfo("Asia/Seoul")),
        )

        resp = self.client.post(
            "/qna/analysis/run",
            json={"from_date": "2026-04-01", "to_date": "2026-04-03", "force_reanalyze": True},
        )
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        run_body = resp.json()
        self.assertEqual(run_body["analyzed_count"], 3)
        self.assertEqual(run_body["requested_count"], 3)

        summary = self.client.get("/qna/analysis/summary?from_date=2026-04-01&to_date=2026-04-03")
        self.assertEqual(summary.status_code, 200, msg=summary.text)
        summary_body = summary.json()
        self.assertEqual(summary_body["summary"]["total_items"], 3)
        self.assertGreaterEqual(summary_body["summary"]["faq_candidate_count"], 1)
        self.assertGreaterEqual(summary_body["summary"]["high_conversion_count"], 1)
        self.assertIn("구매직전", summary_body["purchase_stage_counts"])
        self.assertIn("NEGATIVE", summary_body["sentiment_counts"])
        self.assertGreaterEqual(len(summary_body["top_products"]), 1)
        self.assertGreaterEqual(len(summary_body["action_guides"]), 1)
        self.assertIn("what_to_do", summary_body["action_guides"][0])

        trends = self.client.get("/qna/analysis/trends?from_date=2026-04-01&to_date=2026-04-03")
        self.assertEqual(trends.status_code, 200, msg=trends.text)
        trend_body = trends.json()
        self.assertEqual(len(trend_body["points"]), 3)
        self.assertEqual(trend_body["points"][0]["date"], "2026-04-01")

    def test_qna_analysis_detail_endpoints_rank_conversion_quality_and_marketing_items(self) -> None:
        self._insert_qna(
            qna_key="customer:barrier-1",
            qna_kind="customer",
            external_inquiry_id="barrier-1",
            inquiry_text="구매 전에 얼마나 지속되는지 알고 싶어요. 효과가 오래가나요?",
            category="효과",
            inquiry_registered_at=datetime(2026, 4, 4, 9, 0, tzinfo=ZoneInfo("Asia/Seoul")),
        )
        self._insert_qna(
            qna_key="customer:barrier-2",
            qna_kind="customer",
            external_inquiry_id="barrier-2",
            inquiry_text="민감한 두피에도 괜찮나요? 구매 전에 자극이 걱정됩니다.",
            category="상품",
            inquiry_registered_at=datetime(2026, 4, 4, 10, 0, tzinfo=ZoneInfo("Asia/Seoul")),
        )
        self._insert_qna(
            qna_key="product:issue-1",
            qna_kind="product",
            external_inquiry_id="issue-1",
            inquiry_text="사용 후 냄새가 심하고 두피가 따갑습니다. 불만이 큽니다.",
            category="불만",
            inquiry_registered_at=datetime(2026, 4, 5, 9, 0, tzinfo=ZoneInfo("Asia/Seoul")),
        )

        run_resp = self.client.post(
            "/qna/analysis/run",
            json={"from_date": "2026-04-04", "to_date": "2026-04-05", "force_reanalyze": True},
        )
        self.assertEqual(run_resp.status_code, 200, msg=run_resp.text)

        conversion = self.client.get("/qna/analysis/conversion-barriers?from_date=2026-04-04&to_date=2026-04-05")
        self.assertEqual(conversion.status_code, 200, msg=conversion.text)
        conversion_body = conversion.json()
        self.assertGreaterEqual(len(conversion_body["items"]), 1)
        self.assertIn("구매", conversion_body["items"][0]["inquiry_text"])
        self.assertIn("recommended_action", conversion_body["items"][0])

        quality = self.client.get("/qna/analysis/quality-issues?from_date=2026-04-04&to_date=2026-04-05")
        self.assertEqual(quality.status_code, 200, msg=quality.text)
        quality_body = quality.json()
        self.assertGreaterEqual(len(quality_body["items"]), 1)
        self.assertEqual(quality_body["items"][0]["qna_key"], "product:issue-1")
        self.assertIn("냄새", quality_body["items"][0]["issue_tags"])
        self.assertIn("자극", quality_body["items"][0]["issue_tags"])

        faq = self.client.get("/qna/analysis/faq-candidates?from_date=2026-04-04&to_date=2026-04-05")
        self.assertEqual(faq.status_code, 200, msg=faq.text)
        faq_body = faq.json()
        self.assertGreaterEqual(len(faq_body["items"]), 1)
        self.assertTrue(faq_body["items"][0]["faq_candidate"])

        marketing = self.client.get("/qna/analysis/marketing-insights?from_date=2026-04-04&to_date=2026-04-05")
        self.assertEqual(marketing.status_code, 200, msg=marketing.text)
        marketing_body = marketing.json()
        self.assertGreaterEqual(len(marketing_body["top_keywords"]), 1)
        self.assertGreaterEqual(len(marketing_body["copy_candidates"]), 1)

    def test_qna_analysis_items_support_filters_and_include_structured_detail(self) -> None:
        self._insert_qna(
            qna_key="customer:item-1",
            qna_kind="customer",
            external_inquiry_id="item-1",
            inquiry_text="비교 중인데 얼마나 지속되나요?",
            category="효과",
            inquiry_registered_at=datetime(2026, 4, 6, 9, 0, tzinfo=ZoneInfo("Asia/Seoul")),
        )
        self._insert_qna(
            qna_key="product:item-2",
            qna_kind="product",
            external_inquiry_id="item-2",
            inquiry_text="배송 문의가 아니라 사용 후 자극이 있습니다.",
            category="불만",
            inquiry_registered_at=datetime(2026, 4, 6, 10, 0, tzinfo=ZoneInfo("Asia/Seoul")),
        )

        run_resp = self.client.post(
            "/qna/analysis/run",
            json={"from_date": "2026-04-06", "to_date": "2026-04-06", "force_reanalyze": True},
        )
        self.assertEqual(run_resp.status_code, 200, msg=run_resp.text)

        items = self.client.get(
            "/qna/analysis/items?from_date=2026-04-06&to_date=2026-04-06&qna_kind=customer&purchase_stage=비교검토&category=효과&inquiry_type=효과문의&conversion_level=HIGH&product_name=테스트+상품"
        )
        self.assertEqual(items.status_code, 200, msg=items.text)
        body = items.json()
        self.assertEqual(body["total_items"], 1)
        self.assertEqual(len(body["items"]), 1)
        self.assertEqual(body["items"][0]["qna_key"], "customer:item-1")
        self.assertEqual(body["items"][0]["analysis"]["purchase_stage"], "비교검토")
        self.assertIn("keywords", body["items"][0]["analysis"])

        summary = self.client.get(
            "/qna/analysis/summary?from_date=2026-04-06&to_date=2026-04-06&category=효과&inquiry_type=효과문의&conversion_level=HIGH"
        )
        self.assertEqual(summary.status_code, 200, msg=summary.text)
        self.assertEqual(summary.json()["summary"]["total_items"], 1)


if __name__ == "__main__":
    unittest.main()
