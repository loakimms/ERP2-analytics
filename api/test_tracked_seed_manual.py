import unittest
import time

from fastapi.testclient import TestClient

from main import app
from db import SessionLocal, TrackedProductKeyword, TrackedProductManualKeyword, TrackedProductRankDaily


class TestTrackedKeywordSeedsManual(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_post_tracked_also_upserts_manual_keywords(self):
        product_url = "https://smartstore.naver.com/testmall/products/999000000010"

        # clean
        with SessionLocal() as db:
            db.query(TrackedProductKeyword).filter(TrackedProductKeyword.product_url == product_url).delete(synchronize_session=False)
            db.query(TrackedProductManualKeyword).filter(TrackedProductManualKeyword.product_url == product_url).delete(synchronize_session=False)
            db.commit()

        res = self.client.post("/search-rank/tracked", json={"product_url": product_url, "keywords": ["키워드A", "키워드B"]})
        self.assertEqual(res.status_code, 200)

        # manual keywords should exist without excel upload
        res2 = self.client.get("/search-rank/manual-keywords", params={"product_url": product_url})
        self.assertEqual(res2.status_code, 200)
        rows = res2.json()
        kws = sorted([str(r.get("keyword") or "").strip() for r in rows if str(r.get("keyword") or "").strip()])
        self.assertEqual(kws, ["키워드A", "키워드B"])

    def test_today_status_seeds_from_tracked_when_manual_empty(self):
        # 운영 DB/다른 테스트와 충돌하지 않도록 매번 고유 URL을 사용한다.
        pid = f"991{int(time.time())}000111"
        product_url = f"https://smartstore.naver.com/testmall/products/{pid}"

        # clean and add tracked only
        with SessionLocal() as db:
            db.query(TrackedProductKeyword).filter(TrackedProductKeyword.product_url == product_url).delete(synchronize_session=False)
            db.query(TrackedProductManualKeyword).filter(TrackedProductManualKeyword.product_url == product_url).delete(synchronize_session=False)
            db.query(TrackedProductRankDaily).filter(TrackedProductRankDaily.product_url == product_url).delete(synchronize_session=False)
            db.commit()

        res = self.client.post("/search-rank/tracked", json={"product_url": product_url, "keywords": ["키워드A", "키워드B"]})
        self.assertEqual(res.status_code, 200)

        # remove manual keywords to simulate "manual empty" (seed should re-create)
        with SessionLocal() as db:
            db.query(TrackedProductManualKeyword).filter(TrackedProductManualKeyword.product_url == product_url).delete(synchronize_session=False)
            db.commit()

        st = self.client.post("/search-rank/crawl/today-status", json={"product_urls": [product_url]})
        self.assertEqual(st.status_code, 200)
        rows = st.json()
        self.assertEqual(len(rows), 1)
        self.assertEqual(int(rows[0]["total_keywords"]), 2)
        self.assertEqual(bool(rows[0]["is_complete"]), False)

    def test_get_tracked_can_include_today_rank_and_delta(self):
        """
        리스트 화면은 "페이지 진입 시 자동 동기화 없이" 저장된 값만 즉시 표시해야 한다.
        따라서 /search-rank/tracked?include_today_rank=1 은 DB에 저장된 오늘/어제 rank로 today_rank/today_delta를 채운다.
        """
        pid = f"992{int(time.time())}000222"
        product_url = f"https://smartstore.naver.com/testmall/products/{pid}"

        with SessionLocal() as db:
            db.query(TrackedProductKeyword).filter(TrackedProductKeyword.product_url == product_url).delete(synchronize_session=False)
            db.query(TrackedProductManualKeyword).filter(TrackedProductManualKeyword.product_url == product_url).delete(synchronize_session=False)
            db.query(TrackedProductRankDaily).filter(TrackedProductRankDaily.product_url == product_url).delete(synchronize_session=False)
            db.commit()

        # tracked 등록(핵심 관리 키워드)
        res = self.client.post("/search-rank/tracked", json={"product_url": product_url, "keywords": ["키워드A"]})
        self.assertEqual(res.status_code, 200)

        # 오늘/어제 rank 저장값 주입 (같은 source 안에서는 유효한 최상위 순위를 대표값으로 계산한다.)
        from main import _today_kst
        from datetime import timedelta

        today = _today_kst()
        prev = today - timedelta(days=1)
        with SessionLocal() as db:
            db.add(TrackedProductRankDaily(product_url=product_url, keyword="키워드A", date=prev, rank=10, source="text"))
            # 같은 날짜에 URL 정규화 차이(쿼리스트링 포함)로 row가 여러 개 존재할 수 있다.
            # - base URL에는 rank==0(미노출)이 저장되고
            # - query 포함 URL에는 실제 순위(rank>0)가 저장될 수 있다.
            # include_today_rank는 이 경우에도 "유효 순위"를 대표값으로 선택해야 한다.
            db.add(TrackedProductRankDaily(product_url=product_url, keyword="키워드A", date=today, rank=0, source="openapi"))
            db.add(TrackedProductRankDaily(product_url=product_url + "?NaPm=ct%3Dtest", keyword="키워드A", date=today, rank=8, source="openapi"))
            db.commit()

        # include_today_rank=1 로 조회
        res2 = self.client.get("/search-rank/tracked", params={"include_today_rank": 1})
        self.assertEqual(res2.status_code, 200)
        rows = res2.json()
        # 해당 product_url/keyword row를 찾는다.
        one = None
        for r in rows:
            if str(r.get("product_url") or "").strip() == product_url and str(r.get("keyword") or "").strip() == "키워드A":
                one = r
                break
        self.assertTrue(one is not None)
        self.assertEqual(int(one.get("today_rank")), 8)
        # delta = 어제(10) - 오늘(8) = +2 (순위 상승)
        self.assertEqual(int(one.get("today_delta")), 2)

    def test_get_tracked_prefers_excel_over_openapi_for_today_rank(self):
        """
        공식 엑셀 업로드는 사용자가 확인한 원본 순위이므로,
        같은 상품/키워드/날짜의 OpenAPI 스냅샷보다 우선 표시해야 한다.
        """
        pid = f"993{int(time.time())}000333"
        product_url = f"https://smartstore.naver.com/testmall/products/{pid}"

        with SessionLocal() as db:
            db.query(TrackedProductKeyword).filter(TrackedProductKeyword.product_url == product_url).delete(synchronize_session=False)
            db.query(TrackedProductManualKeyword).filter(TrackedProductManualKeyword.product_url == product_url).delete(synchronize_session=False)
            db.query(TrackedProductRankDaily).filter(TrackedProductRankDaily.product_url.like(f"%{pid}%")).delete(synchronize_session=False)
            db.commit()

        res = self.client.post("/search-rank/tracked", json={"product_url": product_url, "keywords": ["키워드B"]})
        self.assertEqual(res.status_code, 200)

        from main import _today_kst
        from datetime import timedelta

        today = _today_kst()
        prev = today - timedelta(days=1)
        with SessionLocal() as db:
            db.add(TrackedProductRankDaily(product_url=product_url, keyword="키워드B", date=prev, rank=20, source="excel"))
            db.add(TrackedProductRankDaily(product_url=product_url, keyword="키워드B", date=today, rank=3, source="openapi"))
            db.add(TrackedProductRankDaily(product_url=product_url + "?NaPm=ct%3Dtest", keyword="키워드B", date=today, rank=12, source="excel"))
            db.commit()

        res2 = self.client.get("/search-rank/tracked", params={"include_today_rank": 1})
        self.assertEqual(res2.status_code, 200)
        rows = res2.json()
        one = None
        for r in rows:
            if str(r.get("product_url") or "").strip() == product_url and str(r.get("keyword") or "").strip() == "키워드B":
                one = r
                break
        self.assertTrue(one is not None)
        self.assertEqual(int(one.get("today_rank")), 12)
        self.assertEqual(int(one.get("today_delta")), 8)


if __name__ == "__main__":
    unittest.main()

