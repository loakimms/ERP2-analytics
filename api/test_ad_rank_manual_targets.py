import time
import unittest

from fastapi.testclient import TestClient

import main
from db import AdRankDiagnosisDaily, AdTrackedKeyword, AdTrackedProduct, SessionLocal, TrackedProductAutoKeyword


class AdRankManualTargetsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(main.app)

    def test_ad_tracking_keywords_are_candidates_and_active_targets(self) -> None:
        pid = f"998{int(time.time())}123456"
        product_url = f"https://smartstore.naver.com/testmall/products/{pid}"
        canonical_url = main._canonicalize_smartstore_base_url(product_url) or product_url

        with SessionLocal() as db:
            db.query(AdTrackedKeyword).filter(AdTrackedKeyword.product_url == canonical_url).delete(synchronize_session=False)
            db.query(AdTrackedProduct).filter(AdTrackedProduct.product_url == canonical_url).delete(synchronize_session=False)
            db.query(TrackedProductAutoKeyword).filter(TrackedProductAutoKeyword.product_url == canonical_url).delete(synchronize_session=False)
            db.commit()

            db.add(
                TrackedProductAutoKeyword(
                    product_url=canonical_url,
                    keyword="내상품그룹1키워드",
                    group_type="core",
                    is_active=True,
                )
            )
            db.commit()

        response = self.client.post(
            "/ad-rank/tracked",
            json={
                "product_url": product_url,
                "name": "광고 테스트 상품",
                "keywords": [
                    {"keyword": "후보키워드", "is_active": False},
                    {"keyword": "수집키워드", "is_active": True},
                ],
            },
        )
        self.assertEqual(response.status_code, 200)

        listed = self.client.get("/ad-rank/tracked")
        self.assertEqual(listed.status_code, 200)
        product = next(row for row in listed.json() if row["product_url"] == canonical_url)
        keywords = {row["keyword"]: bool(row["is_active"]) for row in product["keywords"]}
        self.assertEqual(keywords, {"수집키워드": True, "후보키워드": False})
        self.assertNotIn("내상품그룹1키워드", keywords)

        with SessionLocal() as db:
            self.assertEqual(main._ad_rank_product_keywords(db, canonical_url), ["수집키워드"])

        self.client.put(
            "/ad-rank/tracked",
            json={
                "product_url": product_url,
                "keywords": [
                    {"keyword": "후보키워드", "is_active": True},
                    {"keyword": "수집키워드", "is_active": False},
                ],
            },
        )

        with SessionLocal() as db:
            self.assertEqual(main._ad_rank_product_keywords(db, canonical_url), ["후보키워드"])

    def test_ad_keyword_rank_lookup_uses_ad_diagnosis_daily(self) -> None:
        pid = f"999{int(time.time())}654321"
        product_url = f"https://smartstore.naver.com/testmall/products/{pid}"
        canonical_url = main._canonicalize_smartstore_base_url(product_url) or product_url
        keyword = "광고키워드"
        today = main._today_kst()

        with SessionLocal() as db:
            db.query(AdRankDiagnosisDaily).filter(AdRankDiagnosisDaily.product_url == canonical_url).delete(synchronize_session=False)
            db.query(AdTrackedKeyword).filter(AdTrackedKeyword.product_url == canonical_url).delete(synchronize_session=False)
            db.query(AdTrackedProduct).filter(AdTrackedProduct.product_url == canonical_url).delete(synchronize_session=False)
            db.commit()
            db.add(
                AdTrackedProduct(
                    product_url=canonical_url,
                    name="광고 순위 테스트 상품",
                    campaign_label="검색광고 노출 진단",
                    is_active=True,
                )
            )
            db.add(
                AdRankDiagnosisDaily(
                    date=today,
                    time_slot="daily",
                    product_url=canonical_url,
                    keyword=keyword,
                    gender="female",
                    age_band="40-44",
                    placement="mobile-search",
                    visible=True,
                    rank=7,
                    ad_type="SEARCH_AD",
                    status="success",
                )
            )
            db.add(
                AdRankDiagnosisDaily(
                    date=today,
                    time_slot="daily",
                    product_url=canonical_url,
                    keyword=keyword,
                    gender="male",
                    age_band="40-44",
                    placement="pc-search",
                    visible=True,
                    rank=3,
                    ad_type="ADVOOST",
                    status="success",
                )
            )
            db.commit()

        res = self.client.get(
            "/ad-rank/tracked/keyword-ranks",
            params={
                "keyword": keyword,
                "genders": "female",
                "age_bands": "40-44",
                "placements": "mobile-search",
                "days": 7,
            },
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        by_url = {row["product_url"]: row for row in data["items"]}
        self.assertIn(canonical_url, by_url)
        ranks = {row["date"]: row["rank"] for row in by_url[canonical_url]["ranks"]}
        self.assertEqual(ranks[today.isoformat()], 7)
        ad_types = {row["date"]: row["ad_type"] for row in by_url[canonical_url]["ranks"]}
        self.assertEqual(ad_types[today.isoformat()], "SEARCH_AD")

        res = self.client.get(
            "/ad-rank/tracked/keyword-ranks",
            params={
                "keyword": keyword,
                "genders": "male",
                "age_bands": "40-44",
                "placements": "pc-search",
                "days": 7,
            },
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        by_url = {row["product_url"]: row for row in data["items"]}
        ranks = {row["date"]: row["rank"] for row in by_url[canonical_url]["ranks"]}
        self.assertEqual(ranks[today.isoformat()], 3)
        ad_types = {row["date"]: row["ad_type"] for row in by_url[canonical_url]["ranks"]}
        self.assertEqual(ad_types[today.isoformat()], "ADVOOST")

