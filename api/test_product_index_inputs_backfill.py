import unittest
from datetime import timedelta

from fastapi.testclient import TestClient

from db import (
    SessionLocal,
    TrackedProductIndexManual,
    TrackedProductPageDaily,
    TrackedProductMeta,
    NaverSmartstorePurchaseKeywordDaily,
    NaverAdCreativeDaily,
    CreativeOrganicDerived,
)
from main import app, _today_kst


class TestProductIndexInputsBackfill(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_suggested_and_analyze_backfill_latest_non_null(self) -> None:
        """
        최신 page-metrics 행이 부분 NULL이더라도, 최근 N일 중 최신 Non-Null 값을 사용해야 한다.
        또한 weekly_views_7d(Proxy)와 sales_30d는 자동 보강되어야 한다.
        """
        product_url = "https://smartstore.naver.com/testmall/products/999000000060?NaPm=ct%3Dxxx"
        base_url = "https://smartstore.naver.com/testmall/products/999000000060"
        today = _today_kst()
        pid = 888888888888

        with SessionLocal() as db:
            # manual 비움(자동 보강 검증)
            db.query(TrackedProductIndexManual).filter(TrackedProductIndexManual.product_url.in_([product_url, base_url])).delete(
                synchronize_session=False
            )

            db.query(TrackedProductMeta).filter(TrackedProductMeta.product_url.in_([product_url, base_url])).delete(synchronize_session=False)
            db.add(TrackedProductMeta(product_url=base_url, title="테스트 상품-백필", product_id_catalog=pid, category1="C1", category2="C2", category3="C3"))

            db.query(TrackedProductPageDaily).filter(TrackedProductPageDaily.product_url.in_([product_url, base_url])).delete(
                synchronize_session=False
            )
            # 최신(오늘): 일부 필드 NULL
            db.add(
                TrackedProductPageDaily(
                    date=today,
                    product_url=base_url,
                    title="테스트 상품-백필",
                    wish_count=None,
                    registered_date=None,
                    recent_purchase_7d_count=None,
                    rating=None,
                    review_count=None,
                    http_status=200,
                    error=None,
                )
            )
            # 어제: 유효값 존재
            db.add(
                TrackedProductPageDaily(
                    date=today - timedelta(days=1),
                    product_url=base_url,
                    title="테스트 상품-백필",
                    wish_count=22,
                    registered_date=today - timedelta(days=100),
                    recent_purchase_7d_count=9,
                    rating=4.5,
                    review_count=123,
                    http_status=200,
                    error=None,
                )
            )

            # purchase keywords 30일치(payments 합=30)
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
                        product_name="테스트 상품-백필",
                        payments=1,
                        amount=0,
                        source="test",
                    )
                )

            # 광고 데이터 7일치(impressions=50/day -> 350)
            db.query(NaverAdCreativeDaily).filter(NaverAdCreativeDaily.creative_id == "cr-bf").delete(synchronize_session=False)
            db.query(CreativeOrganicDerived).filter(CreativeOrganicDerived.creative_id == "cr-bf").delete(synchronize_session=False)
            for i in range(7):
                dd = today - timedelta(days=i)
                db.add(
                    NaverAdCreativeDaily(
                        date=dd,
                        campaign_name="CAMP",
                        adgroup_name="GRP",
                        creative_id="cr-bf",
                        device="ALL",
                        creative_name="CR",
                        product_title="테스트 상품-백필",
                        impressions=50,
                        clicks=5,
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
                        creative_id="cr-bf",
                        device="ALL",
                        matched_product_url=base_url,
                        matched_product_title="테스트 상품-백필",
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

        # suggested-inputs: wishes/sales_7d/days_since_reg가 어제 값으로 채워져야 함
        res = self.client.get("/search-rank/product-index/suggested-inputs", params={"product_url": product_url, "date_to": str(today)})
        self.assertEqual(res.status_code, 200)
        sug = res.json()
        self.assertEqual(sug["product_url"], base_url)
        self.assertEqual(int(sug["weekly_views_7d"]), 350)
        self.assertEqual(int(sug["wishes"]), 22)
        self.assertEqual(int(sug["sales_7d"]), 9)
        self.assertEqual(int(sug["sales_30d"]), 30)
        self.assertEqual(int(sug["days_since_reg"]), 100)

        # analyze: inputs에도 동일하게 들어가야 함(0으로 강제하면 안 됨)
        res2 = self.client.post("/search-rank/product-index/analyze", json={"product_url": product_url, "date": str(today)})
        self.assertEqual(res2.status_code, 200)
        data = res2.json()
        self.assertEqual(data["product_url"], base_url)
        inp = data.get("inputs") or {}
        self.assertEqual(int(inp["weekly_views_7d"]), 350)
        self.assertEqual(int(inp["wishes"]), 22)
        self.assertEqual(int(inp["sales_7d"]), 9)
        self.assertEqual(int(inp["sales_30d"]), 30)
        self.assertEqual(int(inp["days_since_reg"]), 100)

    def test_sales_30d_fallback_from_sales_7d_when_no_purchase_rows(self) -> None:
        """
        purchase_upload(30d) 데이터가 없으면, 최근 7일 판매량을 30일로 환산하여 sales_30d를 채워야 한다.
        """
        product_url = "https://smartstore.naver.com/testmall/products/999000000061?NaPm=ct%3Dxxx"
        base_url = "https://smartstore.naver.com/testmall/products/999000000061"
        today = _today_kst()

        with SessionLocal() as db:
            db.query(TrackedProductMeta).filter(TrackedProductMeta.product_url.in_([product_url, base_url])).delete(synchronize_session=False)
            db.add(TrackedProductMeta(product_url=base_url, title="테스트 상품-30d-fallback", product_id_catalog=777777777777))

            db.query(TrackedProductPageDaily).filter(TrackedProductPageDaily.product_url.in_([product_url, base_url])).delete(
                synchronize_session=False
            )
            db.add(
                TrackedProductPageDaily(
                    date=today,
                    product_url=base_url,
                    title="테스트 상품-30d-fallback",
                    wish_count=1,
                    registered_date=today - timedelta(days=10),
                    recent_purchase_7d_count=7,
                    recent_purchase_status="collected",
                    http_status=200,
                    error=None,
                )
            )
            db.commit()

        # 7일 판매=7 => 30일 환산 round(7*30/7)=30
        res = self.client.get("/search-rank/product-index/suggested-inputs", params={"product_url": product_url, "date_to": str(today)})
        self.assertEqual(res.status_code, 200)
        sug = res.json()
        self.assertEqual(int(sug["sales_7d"]), 7)
        self.assertEqual(int(sug["sales_30d"]), 30)
        self.assertEqual(str((sug.get("sources") or {}).get("sales_30d")), "derived_from_sales_7d")


if __name__ == "__main__":
    unittest.main()

