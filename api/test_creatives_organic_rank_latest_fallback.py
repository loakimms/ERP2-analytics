import unittest
from datetime import date, timedelta

from fastapi.testclient import TestClient

import main
from db import SessionLocal, NaverAdCreativeDaily, TrackedProductKeyword, TrackedProductMeta, TrackedProductRankDaily


class CreativesOrganicRankLatestFallbackTest(unittest.TestCase):
    def test_creatives_daily_uses_exact_date_tracked_rank(self) -> None:
        """
        요구사항:
        - 내 상품추적(tracked_product_rank_daily)에 저장된 오가닉 순위를 소재 분석(/creatives/daily)에서 재사용한다.
        - 해당 날짜(오늘)에 데이터가 없으면 최근 N일 내 최신값으로 폴백해 표시한다.
        - 실제 적용일을 organic_rank_date로 반환한다.
        """
        client = TestClient(main.app)

        today = date(2026, 1, 26)
        yesterday = today - timedelta(days=1)

        product_url = "https://smartstore.naver.com/example/products/123"
        kw = "천연염색약"
        img = "https://example.test/img.png"

        campaign = "#SS01_통합검색지면_MO"
        adgroup = "#MO_천연염색약"
        creative_id = "nad-a001-02-test-creative"  # -02- => SHOPPING_PRODUCT_AD

        db = SessionLocal()
        try:
            # 1) 내 상품추적 등록(키워드/상품 메타)
            db.merge(TrackedProductKeyword(product_url=product_url, keyword=kw, is_active=True))
            db.merge(TrackedProductMeta(product_url=product_url, title="테스트 상품", image_url=img))

            # 2) 소재 일간 스냅샷(오늘)
            db.merge(
                NaverAdCreativeDaily(
                    date=today,
                    campaign_name=campaign,
                    adgroup_name=adgroup,
                    creative_id=creative_id,
                    device="ALL",
                    creative_name="TEST_CREATIVE",
                    product_title="테스트 상품",
                    image_url=img,
                    current_bid=100,
                    quality_index=5.0,
                    avg_rank=1.0,
                    impressions=10,
                    clicks=1,
                    cost=100,
                    conversions=0,
                    revenue=0,
                    ctr=0.1,
                    cpc=100.0,
                    cvr=0.0,
                    roas=0.0,
                    source="creative_upload",
                )
            )

            # 3) 오가닉 순위는 "조회 날짜"에 맞게 존재해야 한다.
            # - 전일: 7위
            # - 오늘: 5위
            db.merge(TrackedProductRankDaily(date=yesterday, product_url=product_url, keyword=kw, rank=7, source="excel"))
            db.merge(TrackedProductRankDaily(date=today, product_url=product_url, keyword=kw, rank=5, source="excel"))
            db.commit()
        finally:
            db.close()

        # 4) 조회: date_from=today로 호출하면 "오늘"의 오가닉 순위를 반환해야 한다.
        res = client.get(f"/creatives/daily?date_from={today.isoformat()}&date_to={today.isoformat()}&limit=50")
        self.assertEqual(res.status_code, 200, msg=res.text)
        rows = res.json() or []
        self.assertTrue(isinstance(rows, list) and len(rows) >= 1)

        found = None
        for r in rows:
            if str(r.get("creative_id")) == creative_id:
                found = r
                break
        self.assertIsNotNone(found, msg=f"creative_id={creative_id} not found")

        # 정확 일자 매칭
        self.assertEqual(found.get("organic_keyword"), kw)
        self.assertEqual(found.get("organic_rank"), 5)
        self.assertEqual(found.get("organic_rank_source"), "tracked_excel")
        self.assertEqual(found.get("organic_rank_date"), today.isoformat())

    def test_creatives_daily_falls_back_for_quality_avg_and_organic(self) -> None:
        """
        요구사항(정책):
        - 품질지수/평균노출순위/오가닉순위는 선택 날짜에 값이 없으면 "마지막(최근) 날짜" 값을 보여준다.
        - 그 외 지표(노출/클릭/비용 등)는 해당 날짜 기준 그대로(없으면 0/없음)로 유지한다.
        """
        client = TestClient(main.app)

        today = date(2026, 1, 27)
        yesterday = today - timedelta(days=1)

        product_url = "https://smartstore.naver.com/example/products/999"
        kw = "천연염색약"
        img = "https://example.test/img2.png"

        campaign = "#SS01_통합검색지면_MO"
        adgroup = "#MO_천연염색약"
        creative_id = "nad-a001-02-test-creative-2"

        db = SessionLocal()
        try:
            db.merge(TrackedProductKeyword(product_url=product_url, keyword=kw, is_active=True))
            db.merge(TrackedProductMeta(product_url=product_url, title="테스트 상품2", image_url=img))

            # 어제: 품질/평균노출순위/오가닉 존재
            db.merge(
                NaverAdCreativeDaily(
                    date=yesterday,
                    campaign_name=campaign,
                    adgroup_name=adgroup,
                    creative_id=creative_id,
                    device="ALL",
                    creative_name="TEST_CREATIVE_2",
                    product_title="테스트 상품2",
                    image_url=img,
                    current_bid=100,
                    quality_index=4.0,
                    avg_rank=3.0,
                    impressions=10,
                    clicks=1,
                    cost=100,
                    conversions=0,
                    revenue=0,
                    ctr=0.1,
                    cpc=100.0,
                    cvr=0.0,
                    roas=0.0,
                    source="creative_upload",
                )
            )
            db.merge(TrackedProductRankDaily(date=yesterday, product_url=product_url, keyword=kw, rank=9, source="excel"))

            # 오늘: 광고 성과는 없고(=meta_only 성격), 오가닉은 오늘 기준으로 존재할 수 있음.
            # - 요구사항: 오늘 화면에서는 오가닉은 오늘 데이터, 품질/평균은 전일(최근값)로 폴백해야 한다.
            db.merge(
                NaverAdCreativeDaily(
                    date=today,
                    campaign_name=campaign,
                    adgroup_name=adgroup,
                    creative_id=creative_id,
                    device="ALL",
                    creative_name="TEST_CREATIVE_2",
                    product_title="테스트 상품2",
                    image_url=img,
                    current_bid=100,
                    # meta_only로 들어오면 quality가 채워져도 신뢰 소스로 보지 않고 폴백해야 한다.
                    quality_index=5.0,
                    avg_rank=None,
                    impressions=0,
                    clicks=0,
                    cost=0,
                    conversions=0,
                    revenue=0,
                    ctr=0.0,
                    cpc=0.0,
                    cvr=0.0,
                    roas=0.0,
                    source="meta_only",
                )
            )

            db.commit()
        finally:
            db.close()

        res = client.get(f"/creatives/daily?date_from={today.isoformat()}&date_to={today.isoformat()}&limit=50")
        self.assertEqual(res.status_code, 200, msg=res.text)
        rows = res.json() or []
        self.assertTrue(isinstance(rows, list) and len(rows) >= 1)

        found = None
        for r in rows:
            if str(r.get("creative_id")) == creative_id:
                found = r
                break
        self.assertIsNotNone(found, msg=f"creative_id={creative_id} not found")

        # 품질/평균노출순위는 최근값(어제)로 폴백
        self.assertEqual(found.get("quality_index"), 4.0)
        self.assertEqual(found.get("avg_rank"), 3.0)

        # 오가닉은 오늘 값이 없으므로 최근값(어제)로 폴백되어야 한다.
        self.assertEqual(found.get("organic_keyword"), kw)
        self.assertEqual(found.get("organic_rank"), 9)
        self.assertEqual(found.get("organic_rank_source"), "tracked_excel_latest")
        self.assertEqual(found.get("organic_rank_date"), yesterday.isoformat())

    def test_creatives_daily_matches_rank_even_if_db_keyword_has_spaces(self) -> None:
        """
        실데이터에서 흔한 케이스:
        - 내 상품추적(저장) 키워드: '천연 염색약'
        - 소재 분석에서 추출된 키워드: '천연염색약' (공백 없음)
        → 정규화 매칭으로 동일 키워드로 취급되어야 한다.
        """
        client = TestClient(main.app)

        today = date(2026, 1, 27)
        yesterday = today - timedelta(days=1)

        product_url = "https://smartstore.naver.com/example/products/777"
        kw_db = "천연 염색약"
        kw_ui = "천연염색약"
        img = "https://example.test/img3.png"

        campaign = "#SS01_통합검색지면_MO"
        adgroup = f"#MO_{kw_ui}"
        creative_id = "nad-a001-02-test-creative-3"

        db = SessionLocal()
        try:
            db.merge(TrackedProductKeyword(product_url=product_url, keyword=kw_ui, is_active=True))
            db.merge(TrackedProductMeta(product_url=product_url, title="테스트 상품3", image_url=img))
            db.merge(
                NaverAdCreativeDaily(
                    date=today,
                    campaign_name=campaign,
                    adgroup_name=adgroup,
                    creative_id=creative_id,
                    device="ALL",
                    creative_name="TEST_CREATIVE_3",
                    product_title="테스트 상품3",
                    image_url=img,
                    current_bid=100,
                    quality_index=None,
                    avg_rank=None,
                    impressions=0,
                    clicks=0,
                    cost=0,
                    conversions=0,
                    revenue=0,
                    ctr=0.0,
                    cpc=0.0,
                    cvr=0.0,
                    roas=0.0,
                    source="meta_only",
                )
            )
            # DB에는 공백 포함 키워드로 저장
            db.merge(TrackedProductRankDaily(date=yesterday, product_url=product_url, keyword=kw_db, rank=5, source="excel"))
            db.merge(TrackedProductRankDaily(date=today, product_url=product_url, keyword=kw_db, rank=16, source="excel"))
            db.commit()
        finally:
            db.close()

        res = client.get(f"/creatives/daily?date_from={today.isoformat()}&date_to={today.isoformat()}&limit=50")
        self.assertEqual(res.status_code, 200, msg=res.text)
        rows = res.json() or []
        self.assertTrue(isinstance(rows, list) and len(rows) >= 1)

        found = None
        for r in rows:
            if str(r.get("creative_id")) == creative_id:
                found = r
                break
        self.assertIsNotNone(found)

        # 오늘(16위)로 매칭되어야 한다.
        self.assertEqual(found.get("organic_rank"), 16)
        self.assertEqual(found.get("organic_rank_date"), today.isoformat())


if __name__ == "__main__":
    unittest.main()

