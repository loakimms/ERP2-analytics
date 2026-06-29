import unittest
from unittest.mock import MagicMock, patch


class AdsCollectRangeReusesMetaTest(unittest.TestCase):
    @patch("main.upsert_keyword_daily_from_df")
    @patch("main._searchad_fetch_report_rows")
    @patch("main._searchad_build_meta")
    def test_range_collect_builds_meta_once_and_reuses_for_days(
        self,
        mock_build_meta: MagicMock,
        mock_fetch_rows: MagicMock,
        mock_upsert_kw: MagicMock,
    ) -> None:
        """
        목표(안전성):
        - mode=range 수집 시, 캠페인/광고그룹 메타(_searchad_build_meta include_keywords=False)를
          날짜 수만큼 반복 호출하지 않고 1회만 생성/재사용한다.

        이 테스트는 네트워크/API 호출 없이 로직만 검증한다.
        """
        from main import collect_ads, AdsCollectRequest

        mock_build_meta.return_value = ({}, {}, {}, {}, {})
        mock_fetch_rows.return_value = []
        mock_upsert_kw.return_value = 0

        out = collect_ads(
            AdsCollectRequest(
                mode="range",
                date_from="2026-01-01",
                date_to="2026-01-03",
                kinds=["keyword"],
                debug=False,
            )
        )

        self.assertIsInstance(out, dict)
        self.assertIn("processed", out)
        self.assertEqual(len(out.get("processed") or []), 3)

        # 핵심: range 전체에서 meta는 1회만 생성
        self.assertEqual(mock_build_meta.call_count, 1)
        _args, kwargs = mock_build_meta.call_args
        self.assertEqual(kwargs.get("include_keywords"), False)

