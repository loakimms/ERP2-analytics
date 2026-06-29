import unittest
from datetime import date
from unittest.mock import patch

from fastapi.testclient import TestClient

import main
from db import (
    NaverReviewRaw,
    NaverReviewReplyRaw,
    ReviewReplyDraft,
    SessionLocal,
    TrackedProductKeyword,
    TrackedProductMeta,
    init_db,
)


SAMPLE_REVIEW_CARD_HTML = """
<li class="BnwL_cs1av" data-review-id="rv-1001">
  <span class="_2L3vDiadT9">24.03.15.</span>
  <div class="_2FXNMst_ak">
    테스트 상품
    <dl class="XbGQRlzveO">기타 정보</dl>
    제품 선택: 라벤더
  </div>
  <div class="_1kMfD5ErZ6">
    <span class="_2L3vDiadT9">향이 좋고 두피가 편안해요.</span>
  </div>
  <div class="seller-reply">
    <strong>판매자 답글</strong>
    <span>정성 후기 감사합니다.</span>
  </div>
</li>
""".strip()

LIVE_REVIEW_CARD_HTML = """
<li class="PxsZltB5tV _nlog_click _nlog_impression_element" data-shp-contents-id="4940333279">
  <div class="AlfkEF45qI">
    <div class="uyooaw19E8">
      <a href="#" class="DpXj3MxW8W" aria-expanded="false"><span class="blind">리뷰 더보기/접기</span></a>
      <div class="Tf5fecQ5mT">
        <div class="IwcuBUIAKf">
          <div class="YcwE4WsS9z">
            <div class="O2M37e85_1">
              <div class="zAX67kpex5">
                <div class="SlmASURvHy"></div>
                <div class="uyBAhJxDVs">
                  <div class="g23xE8v5Dm">
                    <span class="_rvQSUB5wU"><span class="t7PPhhAQtT" style="width: 100%;"><span class="blind">평점</span></span></span>
                    <em class="n6zq2yy0KA">5</em>
                  </div>
                  <strong class="QrAd3vYcRb">ppol****</strong>
                  <span class="QrAd3vYcRb">26.03.31.</span>
                  <span class="QrAd3vYcRb">신고</span>
                  <span class="QrAd3vYcRb CYl_WGlwi8">색상: (7%할인) 레드1개+브라운1개</span>
                  <p>헤어건성탈모새치윤기 부족사용효과아주 만족해요두피자극순해요</p>
                  <div class="review-text">
                    한달사용
                    진심 그렇게 오랜시간 염색약 바르고 있었던적은 처음이라 걱정했는데 얼마나 순하고 두피에 안전하면 그럴까 생각하니 좋더라고요
                    염색도 잘 되요 빨강색을 냉장고에 두었다 밤색이랑 섞어서 했더니 빨강이 발효가 잘 됐는지 좀 어둡게 색이 나와서 담에는 같이 섞어서 하려구요
                  </div>
                  <div>이미지 펼쳐보기</div>
                  <div>0</div>
                  <div class="seller-area">
                    <strong>판매자</strong>
                    <span>26.03.31.</span>
                    <span>신고</span>
                    <div class="reply-text">
                      안녕하세요~~고객님!!!
                      항상 고객님들의 건강을 위해 최상위 유기농 제품으로 품질 유지하고 있습니다.
                      저희 제품 애용해주셔서 감사합니다.
                      즐거운 하루되세요^^
                    </div>
                  </div>
                  <div>더보기</div>
                  <div>이 구매자의 처음 리뷰보기</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</li>
""".strip()

CHIP_MIXED_REVIEW_BLOCK_HTML = """
<li class="PxsZltB5tV" data-shp-contents-id="rv-live-2">
  <strong>rlas****</strong>
  <span>26.03.27.</span>
  <span>색상: 브라운</span>
  <div class="_1kMfD5ErZ6">
    <p>헤어건성탈모새치윤기 부족사용효과아주 만족해요두피자극순해요</p>
    <p>냄새가 일단 순해서 좋네요. 쑥냄새같기도하고 그래서 좋더라고요.</p>
  </div>
</li>
""".strip()

CHIP_FRAGMENT_REVIEW_BLOCK_HTML = """
<li class="PxsZltB5tV" data-shp-contents-id="rv-live-3">
  <strong>rlas****</strong>
  <span>26.03.27.</span>
  <span>색상: 브라운</span>
  <div class="_1kMfD5ErZ6">
    <span>사용효과</span>
    <span>괜찮아요</span>
    <span>두피자극</span>
    <span>순해요</span>
    <p>냄새가 일단 순해서 좋네요.</p>
    <p>쑥냄새같기도하고 그래서 좋더라고요.</p>
  </div>
</li>
""".strip()

STRUCTURED_BODY_REVIEW_HTML = """
<li class="PxsZltB5tV _nlog_click _nlog_impression_element" data-shp-contents-id="4942853823">
  <div class="Db9Dtnf7gY">
    <strong class="MX91DFZo2F">jod3***</strong>
    <span class="MX91DFZo2F">26.03.31.</span>
  </div>
  <div class="b_caIle8kC">색상: 레드
    <div class="eWRrdDdSzW XR8o5fU_Yg">
      <div class="RVbIFwX5dY">
        <div class="YtlfLnnteK">헤어</div>
        <ul class="gwiZvk1quX">
          <li class="kxY1I7FBLx">
            <span class="MX91DFZo2F"><span>볼륨 부족</span></span>
            <span class="MX91DFZo2F"><span>윤기 부족</span></span>
            <span class="MX91DFZo2F"><span>가는 모발</span></span>
          </li>
        </ul>
      </div>
      <div class="h8uqAeqIe7">
        <div class="YtlfLnnteK">사용효과</div>
        <div class="MX91DFZo2F">괜찮아요</div>
        <div class="YtlfLnnteK">두피자극</div>
        <div class="MX91DFZo2F">보통이에요</div>
      </div>
    </div>
  </div>
  <div class="HakaEZ240l">
    <div class="KqJ8Qqw082">
      <span class="MX91DFZo2F">기존에 사용하던 헤나와 큰 차이는 없지만
나쁘지는 않았어요
자세한사용방법 대로 사용했는데
흰머리 색은 많이 차이가났어요
크게 나쁘지않아 4점 주었어요</span>
    </div>
  </div>
</li>
""".strip()

STRUCTURED_REPLY_REVIEW_HTML = """
<li class="PxsZltB5tV _nlog_click _nlog_impression_element" data-shp-contents-id="4939603479">
  <div class="Db9Dtnf7gY">
    <strong class="MX91DFZo2F">dl****</strong>
    <span class="MX91DFZo2F">26.03.27.</span>
  </div>
  <div class="b_caIle8kC">색상: 브라운
    <div class="eWRrdDdSzW XR8o5fU_Yg">
      <div class="RVbIFwX5dY">
        <div class="YtlfLnnteK">헤어</div>
        <ul class="gwiZvk1quX">
          <li class="kxY1I7FBLx">
            <span class="MX91DFZo2F"><span>지성</span></span>
            <span class="MX91DFZo2F"><span>지루성 두피</span></span>
            <span class="MX91DFZo2F"><span>가는 모발</span></span>
            <span class="MX91DFZo2F"><span>민감성 두피</span></span>
          </li>
        </ul>
      </div>
    </div>
  </div>
  <div class="HakaEZ240l">
    <div class="KqJ8Qqw082">
      <span class="MX91DFZo2F">아직 사용전이지만 엄마가 구매해달라고하셔서 구매했습니다. 피부 자극이 없었으면 좋겠고 많이 번창하세요 많이 번창하세요 많이 번창하세요 많이 번창하세요 많이 번창하세요 ^^</span>
    </div>
  </div>
  <div class="Wsm9me_nCc">
    <div class="HakaEZ240l">
      <div class="pCG_kj27_c">
        <div class="uyBAhJxDVs">
          <strong class="zi5UNys_9u">판매자</strong>
          <span class="zi5UNys_9u">26.03.27.</span>
        </div>
      </div>
      <div class="gCwNtyh1ki">
        <p class="gF203kDj_q">안녕하세요~~고객님!!!
항상 고객님들의 건강을 위해 최상위 유기농 제품으로 품질 유지하고 있습니다.
저희 제품 애용해주셔서 감사합니다.
즐거운 하루되세요^^</p>
      </div>
    </div>
  </div>
</li>
""".strip()

OPTION_ONLY_REVIEW_HTML = """
<li class="PxsZltB5tV _nlog_click _nlog_impression_element" data-shp-contents-id="4920314252">
  <div class="Db9Dtnf7gY">
    <strong class="MX91DFZo2F">ohyo***</strong>
    <span class="MX91DFZo2F">26.03.02.</span>
  </div>
  <div class="b_caIle8kC">제품선택: 손상케어 헤어팩 헤어</div>
</li>
""".strip()

INCOMPLETE_BODY_ONLY_REVIEW_HTML = """
<li class="PxsZltB5tV _nlog_click _nlog_impression_element">
  <div class="Db9Dtnf7gY">
    <span class="MX91DFZo2F">26.03.31.</span>
  </div>
  <div class="HakaEZ240l">
    <div class="KqJ8Qqw082">
      <span class="MX91DFZo2F">진심 그렇게 오랜시간 염색약 바르고 있었던적은 처음이라 걱정했는데 얼마나 순하고 두피에 안전하면 그럴까 생각하니 좋더라고요</span>
    </div>
  </div>
</li>
""".strip()


class ReviewTextParseTest(unittest.TestCase):
    def test_parse_review_card_extracts_review_and_reply_text(self) -> None:
        item = main._parse_smartstore_review_card_html(SAMPLE_REVIEW_CARD_HTML)
        self.assertIsNotNone(item)
        assert item is not None
        self.assertEqual(item["review_id_original"], "rv-1001")
        self.assertEqual(item["review_written_at"], date(2024, 3, 15))
        self.assertEqual(item["option_text"], "라벤더")
        self.assertEqual(item["review_text"], "향이 좋고 두피가 편안해요.")
        self.assertEqual(item["reply_text"], "정성 후기 감사합니다.")

    def test_parse_live_review_card_extracts_rating_option_reply_and_reviewer(self) -> None:
        item = main._parse_smartstore_review_card_html(LIVE_REVIEW_CARD_HTML)
        self.assertIsNotNone(item)
        assert item is not None
        self.assertEqual(item["review_id_original"], "4940333279")
        self.assertEqual(item["review_written_at"], date(2026, 3, 31))
        self.assertEqual(item["rating"], 5.0)
        self.assertEqual(item["option_text"], "(7%할인) 레드1개+브라운1개")
        self.assertEqual(item["reviewer_masked_id"], "ppol****")
        self.assertEqual(
            item["review_text"],
            "한달사용 진심 그렇게 오랜시간 염색약 바르고 있었던적은 처음이라 걱정했는데 얼마나 순하고 두피에 안전하면 그럴까 생각하니 좋더라고요 염색도 잘 되요 빨강색을 냉장고에 두었다 밤색이랑 섞어서 했더니 빨강이 발효가 잘 됐는지 좀 어둡게 색이 나와서 담에는 같이 섞어서 하려구요",
        )
        self.assertEqual(
            item["reply_text"],
            "안녕하세요~~고객님!!! 항상 고객님들의 건강을 위해 최상위 유기농 제품으로 품질 유지하고 있습니다. 저희 제품 애용해주셔서 감사합니다. 즐거운 하루되세요^^",
        )

    def test_parse_review_block_skips_chip_line_and_keeps_actual_body(self) -> None:
        item = main._parse_smartstore_review_card_html(CHIP_MIXED_REVIEW_BLOCK_HTML)
        self.assertIsNotNone(item)
        assert item is not None
        self.assertEqual(item["option_text"], "브라운")
        self.assertEqual(item["reviewer_masked_id"], "rlas****")
        self.assertEqual(item["review_text"], "냄새가 일단 순해서 좋네요. 쑥냄새같기도하고 그래서 좋더라고요.")

    def test_parse_review_block_skips_split_chip_fragments_and_keeps_body(self) -> None:
        item = main._parse_smartstore_review_card_html(CHIP_FRAGMENT_REVIEW_BLOCK_HTML)
        self.assertIsNotNone(item)
        assert item is not None
        self.assertEqual(item["option_text"], "브라운")
        self.assertEqual(item["reviewer_masked_id"], "rlas****")
        self.assertEqual(item["review_text"], "냄새가 일단 순해서 좋네요. 쑥냄새같기도하고 그래서 좋더라고요.")

    def test_parse_structured_review_prefers_haka_body_block(self) -> None:
        item = main._parse_smartstore_review_card_html(STRUCTURED_BODY_REVIEW_HTML)
        self.assertIsNotNone(item)
        assert item is not None
        self.assertEqual(item["option_text"], "레드")
        self.assertEqual(item["reviewer_masked_id"], "jod3***")
        self.assertEqual(
            item["review_text"],
            "기존에 사용하던 헤나와 큰 차이는 없지만 나쁘지는 않았어요 자세한사용방법 대로 사용했는데 흰머리 색은 많이 차이가났어요 크게 나쁘지않아 4점 주었어요",
        )
        self.assertNotIn('class="', item["review_text"])
        self.assertNotIn("<div", item["review_text"])

    def test_parse_structured_review_extracts_seller_reply_block(self) -> None:
        item = main._parse_smartstore_review_card_html(STRUCTURED_REPLY_REVIEW_HTML)
        self.assertIsNotNone(item)
        assert item is not None
        self.assertEqual(item["option_text"], "브라운")
        self.assertEqual(item["reviewer_masked_id"], "dl****")
        self.assertEqual(
            item["review_text"],
            "아직 사용전이지만 엄마가 구매해달라고하셔서 구매했습니다. 피부 자극이 없었으면 좋겠고 많이 번창하세요 많이 번창하세요 많이 번창하세요 많이 번창하세요 많이 번창하세요 ^^",
        )
        self.assertEqual(
            item["reply_text"],
            "안녕하세요~~고객님!!! 항상 고객님들의 건강을 위해 최상위 유기농 제품으로 품질 유지하고 있습니다. 저희 제품 애용해주셔서 감사합니다. 즐거운 하루되세요^^",
        )
        self.assertNotIn('class="', item["review_text"])
        self.assertNotIn("<div", item["review_text"])
        self.assertNotIn('class="', item["reply_text"])
        self.assertNotIn("<div", item["reply_text"])

    def test_parse_option_only_card_returns_none(self) -> None:
        item = main._parse_smartstore_review_card_html(OPTION_ONLY_REVIEW_HTML)
        self.assertIsNone(item)

    def test_parse_body_only_card_without_core_meta_returns_none(self) -> None:
        item = main._parse_smartstore_review_card_html(INCOMPLETE_BODY_ONLY_REVIEW_HTML)
        self.assertIsNone(item)


class ReviewCollectApiTest(unittest.TestCase):
    def setUp(self) -> None:
        init_db()
        self.client = TestClient(main.app)
        with SessionLocal() as db:
            db.query(NaverReviewReplyRaw).delete(synchronize_session=False)
            db.query(NaverReviewRaw).delete(synchronize_session=False)
            db.query(ReviewReplyDraft).delete(synchronize_session=False)
            db.query(TrackedProductKeyword).delete(synchronize_session=False)
            db.query(TrackedProductMeta).delete(synchronize_session=False)
            db.commit()

    @patch("main._collect_smartstore_reviews_text")
    def test_collect_now_persists_review_and_reply_rows(self, mock_collect) -> None:
        product_url = "https://smartstore.naver.com/testmall/products/2000"
        with SessionLocal() as db:
            db.add(TrackedProductKeyword(product_url=product_url, keyword="헤나", is_active=True))
            db.add(
                TrackedProductMeta(
                    product_url=product_url,
                    keyword="헤나",
                    title="테스트 헤나",
                    mall_name="테스트몰",
                    product_id_catalog=2000,
                )
            )
            db.commit()

        mock_collect.return_value = [
            {
                "product_url": product_url,
                "review_id_original": "rv-1001",
                "review_written_at": date(2024, 3, 15),
                "rating": 4.8,
                "option_text": "라벤더",
                "review_text": "향이 좋고 두피가 편안해요.",
                "reply_text": "정성 후기 감사합니다.",
            }
        ]

        res = self.client.post(
            "/reviews/collect-now",
            json={"product_url": product_url, "max_pages": 1, "max_items": 20},
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["fetched"], 1)
        self.assertEqual(body["saved_reviews"], 1)
        self.assertEqual(body["saved_replies"], 1)

        list_res = self.client.get("/reviews/raw", params={"product_url": product_url, "limit": 10})
        self.assertEqual(list_res.status_code, 200)
        items = list_res.json()
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["keyword"], "헤나")
        self.assertEqual(items[0]["product_id_catalog"], 2000)
        self.assertEqual(items[0]["review_text"], "향이 좋고 두피가 편안해요.")
        self.assertEqual(items[0]["reply_text"], "정성 후기 감사합니다.")

    @patch("main._collect_smartstore_reviews_text")
    def test_collect_tracked_uses_active_tracked_products_as_targets(self, mock_collect) -> None:
        product_url_1 = "https://smartstore.naver.com/testmall/products/2000"
        product_url_2 = "https://smartstore.naver.com/testmall/products/3000"
        with SessionLocal() as db:
            db.add(TrackedProductKeyword(product_url=product_url_1, keyword="헤나", is_active=True))
            db.add(TrackedProductKeyword(product_url=product_url_2, keyword="염색약", is_active=True))
            db.add(
                TrackedProductMeta(
                    product_url=product_url_1,
                    keyword="헤나",
                    title="테스트 헤나",
                    mall_name="테스트몰",
                    product_id_catalog=2000,
                )
            )
            db.add(
                TrackedProductMeta(
                    product_url=product_url_2,
                    keyword="염색약",
                    title="테스트 염색약",
                    mall_name="테스트몰",
                    product_id_catalog=3000,
                )
            )
            db.commit()

        def fake_collect(*, product_url: str, max_pages: int, max_items: int, date_from=None, date_to=None):  # noqa: ARG001
            if product_url == product_url_1:
                return [
                    {
                        "product_url": product_url,
                        "review_id_original": "rv-2001",
                        "review_written_at": date(2024, 3, 16),
                        "rating": 4.6,
                        "option_text": "브라운",
                        "review_text": "첫 번째 상품 리뷰입니다.",
                        "reply_text": None,
                    }
                ]
            return [
                {
                    "product_url": product_url,
                    "review_id_original": "rv-3001",
                    "review_written_at": date(2024, 3, 17),
                    "rating": 4.9,
                    "option_text": "블랙",
                    "review_text": "두 번째 상품 리뷰입니다.",
                    "reply_text": "답글 완료",
                }
            ]

        mock_collect.side_effect = fake_collect

        res = self.client.post(
            "/reviews/collect-tracked",
            json={"max_pages": 1, "max_items": 20, "max_targets": 10},
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["total_targets"], 2)
        self.assertEqual(body["processed_targets"], 2)
        self.assertEqual(body["fetched"], 2)
        self.assertEqual(body["saved_reviews"], 2)
        self.assertEqual(body["saved_replies"], 1)
        self.assertEqual(len(body["items"]), 2)

        list_res = self.client.get("/reviews/raw", params={"limit": 10})
        self.assertEqual(list_res.status_code, 200)
        items = list_res.json()
        self.assertEqual(len(items), 2)
        texts = {item["review_text"] for item in items}
        self.assertEqual(texts, {"첫 번째 상품 리뷰입니다.", "두 번째 상품 리뷰입니다."})

    @patch("main._debug_smartstore_review_dom")
    def test_debug_dom_endpoint_returns_probe_payload(self, mock_debug) -> None:
        product_url = "https://smartstore.naver.com/testmall/products/2000"
        mock_debug.return_value = {
            "ok": True,
            "product_url": product_url,
            "clickedReviewTab": True,
            "clickedLatestSort": True,
            "before": {"hasReviewRoot": False},
            "after": {"hasReviewRoot": True, "candidateLiCount": 3},
        }

        res = self.client.get("/reviews/debug-dom", params={"product_url": product_url})
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertTrue(body["ok"])
        self.assertTrue(body["clickedReviewTab"])
        self.assertTrue(body["clickedLatestSort"])
        self.assertEqual(body["after"]["candidateLiCount"], 3)

    @patch("main._debug_smartstore_review_dom")
    def test_debug_dom_endpoint_can_request_full_card_html_and_parsed_preview(self, mock_debug) -> None:
        product_url = "https://smartstore.naver.com/testmall/products/2000"
        mock_debug.return_value = {
            "ok": True,
            "product_url": product_url,
            "clickedReviewTab": True,
            "clickedLatestSort": True,
            "before": {"hasReviewRoot": False},
            "after": {
                "hasReviewRoot": True,
                "candidateLiCount": 1,
                "candidateHtml": ["<li>trimmed</li>"],
                "candidateHtmlFull": ["<li data-review-id='rv-1'>full html</li>"],
                "candidateParsed": [{"review_id_original": "rv-1", "review_text": "리뷰 본문"}],
            },
        }

        res = self.client.get(
            "/reviews/debug-dom",
            params={"product_url": product_url, "include_full_html": "true"},
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["after"]["candidateHtmlFull"][0], "<li data-review-id='rv-1'>full html</li>")
        self.assertEqual(body["after"]["candidateParsed"][0]["review_id_original"], "rv-1")


if __name__ == "__main__":
    unittest.main()
