import unittest
from datetime import date
from unittest.mock import patch

import main


class PurchaseKeywordsCommerceDateFormatRetryTest(unittest.TestCase):
    def test_fetch_changed_orders_retries_on_date_format_error(self) -> None:
        calls = []

        def fake_get_json_with_params(*, path: str, access_token: str, params: dict, timeout_sec: float = 12.0):  # noqa: ARG001
            calls.append(dict(params))
            if len(calls) == 1:
                # 커머스 GW의 날짜 포맷 오류(코드 4000) 시뮬레이션
                return 400, None, '{"code":"4000","message":"날짜 포맷 오류입니다"}'
            return 200, {"data": []}, None

        with patch.object(main, "_naver_commerce_get_access_token_cached", return_value="tok"):
            with patch.object(main, "_naver_commerce_get_json_with_params", side_effect=fake_get_json_with_params):
                items, meta = main._fetch_commerce_changed_product_orders_for_day(date(2026, 3, 8))  # type: ignore[attr-defined]

        self.assertEqual(items, [])
        # 1회 실패 후 후보 포맷으로 재시도
        self.assertGreaterEqual(len(calls), 2)
        self.assertTrue(isinstance(meta, dict))


if __name__ == "__main__":
    unittest.main()

