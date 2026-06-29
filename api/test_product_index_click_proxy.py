import unittest
from datetime import date, timedelta

from fastapi.testclient import TestClient

from db import SessionLocal, TrackedProductKeyword, NaverAdCreativeDaily, CreativeOrganicDerived, TrackedProductMeta
from main import app, _today_kst


class TestProductIndexClickProxy(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_click_score_uses_proxy_formula_no_penalty(self) -> None:
        """
        클릭 점수(Proxy_Click_Score) = min(100, log(C+1)*40 + log(V+1)*40 + (CTR/CTR_cat_avg)*20)
        - 여기서는 category avg CTR이 자기 자신뿐이라 ratio=1이 되도록 구성한다.
        """
        product_url = "https://smartstore.naver.com/testmall/products/999000000030?NaPm=ct%3Dxxx"
        base_url = "https://smartstore.naver.com/testmall/products/999000000030"
        today = _today_kst()
        d0 = today

        with SessionLocal() as db:
            # 상품이 목록에 뜨도록 tracked 등록
            db.query(TrackedProductKeyword).filter(TrackedProductKeyword.product_url.in_([product_url, base_url])).delete(
                synchronize_session=False
            )
            db.add(TrackedProductKeyword(product_url=product_url, keyword="K1", is_active=True))

            # 메타(카테고리) 1개만 존재 => CTR_cat_avg는 이 상품 기반으로 수렴
            db.query(TrackedProductMeta).filter(TrackedProductMeta.product_url.in_([product_url, base_url])).delete(
                synchronize_session=False
            )
            db.add(
                TrackedProductMeta(
                    product_url=base_url,
                    title="테스트 상품",
                    category1="C1",
                    category2="C2",
                    category3="C3",
                    category4=None,
                )
            )

            # 광고 소재 7일치(간단히 하루 1개) + derived 매핑
            db.query(NaverAdCreativeDaily).filter(NaverAdCreativeDaily.creative_id == "cr-1").delete(
                synchronize_session=False
            )
            db.query(CreativeOrganicDerived).filter(CreativeOrganicDerived.creative_id == "cr-1").delete(
                synchronize_session=False
            )
            for i in range(7):
                dd = d0 - timedelta(days=i)
                db.add(
                    NaverAdCreativeDaily(
                        date=dd,
                        campaign_name="CAMP",
                        adgroup_name="GRP",
                        creative_id="cr-1",
                        device="ALL",
                        creative_name="CR",
                        product_title="테스트 상품",
                        impressions=10,
                        clicks=1,
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
                        creative_id="cr-1",
                        device="ALL",
                        matched_product_url=base_url,
                        matched_product_title="테스트 상품",
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

        res = self.client.post("/search-rank/product-index/analyze", json={"product_url": product_url, "date": str(today)})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["product_url"], base_url)  # canonical
        self.assertEqual(int(data["scores"]["penalty"]), 0)
        # C=7, V=7, CTR=0.1, CTR_cat_avg=0.1 => ratio=1
        # score ~= log(8)*40 + log(8)*40 + 1*20 = 2.07944*80 + 20 = 186.35 -> clamp 100
        self.assertEqual(int(data["scores"]["click"]), 100)


if __name__ == "__main__":
    unittest.main()

