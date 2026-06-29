import unittest
from datetime import date
from unittest.mock import patch

import main
from db import SessionLocal


class PurchaseKeywordsBizdataMappingTest(unittest.TestCase):
    def test_sync_uses_keyword_by_product_and_writes_fact(self) -> None:
        d = date(2026, 3, 8)

        fake_kw_resp = {
            "data": [
                {
                    "productNo": 111,
                    "productName": "A",
                    "channelName": "통합검색",
                    "keywords": [
                        {"keyword": "헤나", "paymentAmount": 10000, "paymentCnt": 2},
                        {"keyword": "염색", "paymentAmount": 5000, "paymentCnt": 1},
                    ],
                }
            ]
        }

        def fake_fetch(path: str, access_token: str, params: dict, timeout_sec: float = 12.0):  # noqa: ARG001
            # keyword-by-product만 성공시키고, detail은 404로 흡수
            if "keyword-by-product" in path:
                return 200, fake_kw_resp, None
            return 404, None, "not_found"

        with patch.object(main, "_naver_commerce_get_access_token_cached", return_value="tok"):
            with patch.object(main, "_naver_commerce_get_json_with_params", side_effect=fake_fetch):
                with SessionLocal() as s:
                    r = main.purchase_keywords_sync(main.PurchaseKeywordsSyncRequest(date_from=d, date_to=d, channel_no=500122550), db=s)  # type: ignore[arg-type]

        self.assertTrue(bool(r.get("ok")))
        self.assertEqual(r.get("processed_dates"), [d.isoformat()])
        self.assertEqual(int((r.get("fact_rows_by_date") or {}).get(d.isoformat()) or 0), 2)

    def test_sync_forbidden_bizdata_returns_actionable_error(self) -> None:
        d = date(2026, 3, 8)

        def fake_fetch(path: str, access_token: str, params: dict, timeout_sec: float = 12.0):  # noqa: ARG001
            if "keyword-by-product" in path:
                return 403, None, '{"code":"GW.AUTHN","message":"접근 권한 오류","timestamp":"2026-03-09T00:00:00+09:00"}'
            return 404, None, "not_found"

        with patch.object(main, "_naver_commerce_get_access_token_cached", return_value="tok"):
            with patch.object(main, "_naver_commerce_get_json_with_params", side_effect=fake_fetch):
                with SessionLocal() as s:
                    r = main.purchase_keywords_sync(main.PurchaseKeywordsSyncRequest(date_from=d, date_to=d, channel_no=500122550), db=s)  # type: ignore[arg-type]

        self.assertFalse(bool(r.get("ok")))
        errs = r.get("errors") or {}
        self.assertIn(d.isoformat(), errs)
        self.assertIn("BIZDATA_FORBIDDEN", str(errs.get(d.isoformat())))


if __name__ == "__main__":
    unittest.main()

