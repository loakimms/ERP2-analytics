import unittest
from datetime import timedelta

from fastapi.testclient import TestClient

from db import (
    SessionLocal,
    TrackedProductPageDaily,
    TrackedProductMeta,
    NaverSmartstorePurchaseKeywordDaily,
    NaverAdCreativeDaily,
    CreativeOrganicDerived,
)
from main import app, _today_kst


class TestProductIndexSuggestedInputsSources(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_suggested_inputs_fills_weekly_views_and_sales_30d(self) -> None:
        product_url = "https://smartstore.naver.com/testmall/products/999000000040?NaPm=ct%3Dxxx"
        base_url = "https://smartstore.naver.com/testmall/products/999000000040"
        today = _today_kst()

        pid = 123456789012

        with SessionLocal() as db:
            # 메타: product_id_catalog 연결
            db.query(TrackedProductMeta).filter(TrackedProductMeta.product_url.in_([product_url, base_url])).delete(
                synchronize_session=False
            )
            db.add(TrackedProductMeta(product_url=base_url, title="테스트 상품2", product_id_catalog=pid))

            # page daily: weekly_views_7d, wish_count, registered_date
            db.query(TrackedProductPageDaily).filter(TrackedProductPageDaily.product_url.in_([product_url, base_url])).delete(
                synchronize_session=False
            )
            db.add(
                TrackedProductPageDaily(
                    date=today,
                    product_url=base_url,
                    title="테스트 상품2",
                    wish_count=11,
                    registered_date=today - timedelta(days=50),
                    recent_purchase_7d_count=5,
                    recent_purchase_status="collected",
                    http_status=200,
                    error=None,
                )
            )

            # purchase keywords 30일치(일 2건씩)
            db.query(NaverSmartstorePurchaseKeywordDaily).filter(NaverSmartstorePurchaseKeywordDaily.product_id == pid).delete(
                synchronize_session=False
            )
            for i in range(30):
                d = today - timedelta(days=i)
                db.add(
                    NaverSmartstorePurchaseKeywordDaily(
                        date=d,
                        product_id=pid,
                        channel_group="C",
                        channel_name="N",
                        keyword="KW",
                        product_name="테스트 상품2",
                        payments=2,
                        amount=0,
                        source="test",
                    )
                )
            db.commit()

            # 광고 데이터 7일치(조회수 proxy = 광고 노출수 합)
            db.query(NaverAdCreativeDaily).filter(NaverAdCreativeDaily.creative_id == "cr-2").delete(synchronize_session=False)
            db.query(CreativeOrganicDerived).filter(CreativeOrganicDerived.creative_id == "cr-2").delete(synchronize_session=False)
            for i in range(7):
                dd = today - timedelta(days=i)
                db.add(
                    NaverAdCreativeDaily(
                        date=dd,
                        campaign_name="CAMP",
                        adgroup_name="GRP",
                        creative_id="cr-2",
                        device="ALL",
                        creative_name="CR",
                        product_title="테스트 상품2",
                        impressions=100,
                        clicks=10,
                        conversions=1,
                        cost=0,
                        revenue=0,
                        ctr=10.0,
                        cpc=0.0,
                        cvr=0.0,
                        roas=0.0,
                        source="test",
                    )
                )
                db.add(
                    CreativeOrganicDerived(
                        date=dd,
                        campaign_name="CAMP",
                        adgroup_name="GRP",
                        creative_id="cr-2",
                        device="ALL",
                        matched_product_url=base_url,
                        matched_product_title="테스트 상품2",
                        organic_keyword="K1",
                        organic_rank=1,
                        organic_rank_source="test",
                        match_status="matched",
                        match_rule="test",
                        ad_type=None,
                        algo_version="test",
                    )
                )
            db.commit()

        res = self.client.get("/search-rank/product-index/suggested-inputs", params={"product_url": product_url, "date_to": str(today)})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["product_url"], base_url)
        # 7일 * 100 = 700 (광고 노출수 proxy)
        self.assertEqual(int(data["weekly_views_7d"]), 700)
        self.assertEqual(int(data["wishes"]), 11)
        self.assertEqual(int(data["sales_7d"]), 5)
        # 30일 * 2 = 60
        self.assertEqual(int(data["sales_30d"]), 60)
        # 50일 경과
        self.assertEqual(int(data["days_since_reg"]), 50)
        self.assertTrue(isinstance((data.get("sources") or {}), dict))


if __name__ == "__main__":
    unittest.main()

