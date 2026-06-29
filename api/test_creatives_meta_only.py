import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock, patch


class CreativesMetaOnlyTest(unittest.TestCase):
    @patch("main._searchad_get")
    @patch("main._searchad_build_meta")
    def test_list_creative_daily_include_meta_only_adds_missing_creatives(
        self,
        mock_build_meta: MagicMock,
        mock_get: MagicMock,
    ) -> None:
        import main
        from main import list_creative_daily

        # 글로벌 캐시가 테스트 간에 공유되므로, 이 테스트는 항상 깨끗한 상태에서 시작한다.
        try:
            main._SEARCHAD_ADS_BY_ADGROUP_CACHE.clear()
        except Exception:
            pass

        # DB rows: 통계에 잡힌 소재 1개만 존재
        db_row = SimpleNamespace(
            date=date(2026, 1, 11),
            campaign_name="CAMP1",
            adgroup_name="GRP1",
            creative_id="nad-a001-02-000000000000001",
            device="ALL",
            creative_name="DB_AD_1",
            product_title="상품1",
            image_url="http://img/db1.png",
            current_bid=1000,
            quality_index=5.0,
            avg_rank=None,
            impressions=10,
            clicks=1,
            cost=1000,
            conversions=0,
            revenue=0,
            ctr=10.0,
            cpc=1000.0,
            cvr=0.0,
            roas=0.0,
            source="db",
        )

        q = MagicMock()
        q.filter.return_value = q
        q.order_by.return_value = q
        q.offset.return_value = q
        q.limit.return_value = q
        q.all.return_value = [db_row]

        db = MagicMock()
        db.query.return_value = q

        # name mapping: GRP1 -> grp-1, CAMP1 -> cmp-1
        mock_build_meta.return_value = (
            {"cmp-1": "CAMP1"},
            {"grp-1": "GRP1"},
            {},
            {},
            {},
        )

        def get_side_effect(path: str, *args, **kwargs):
            if path == "/ncc/ads":
                r = MagicMock()
                r.status_code = 200
                # 통계에 안 잡힌 소재 1개를 추가로 반환
                r.json.return_value = [
                    {
                        "nccAdId": "nad-a001-02-000000000000002",
                        "nccAdgroupId": "grp-1",
                        "nccCampaignId": "cmp-1",
                        "name": "API_AD_2",
                        "productName": "상품2",
                        "thumbnailUrl": "http://img/api2.png",
                        "adAttr": {"bidAmt": 1200},
                        "nccQi": {"qiGrade": 7},
                    }
                ]
                return r
            r = MagicMock()
            r.status_code = 404
            r.json.return_value = []
            return r

        mock_get.side_effect = get_side_effect

        out = list_creative_daily(
            date_from=date(2026, 1, 11),
            date_to=date(2026, 1, 11),
            campaign=None,
            adgroup=None,
            include_meta_only=True,
            limit=1000,
            offset=0,
            db=db,
        )

        # DB row 1 + meta-only row 1 = 2
        self.assertEqual(len(out), 2)
        ids = sorted([str(x.get("creative_id")) for x in out])
        self.assertEqual(
            ids,
            ["nad-a001-02-000000000000001", "nad-a001-02-000000000000002"],
        )
        added = [x for x in out if x.get("creative_id") == "nad-a001-02-000000000000002"][0]
        self.assertEqual(added.get("source"), "meta_only_api")
        self.assertEqual(int(added.get("impressions") or 0), 0)
        self.assertEqual(int(added.get("current_bid") or 0), 1200)
        self.assertEqual(float(added.get("quality_index") or 0.0), 7.0)

