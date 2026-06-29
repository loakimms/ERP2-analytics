import time
import unittest
from datetime import timedelta

from fastapi.testclient import TestClient

from db import SessionLocal, TrackedProductKeyword, NaverProductRankDaily
from main import app, _today_kst


class ManualKeywordsHistoryIncludesTrackedOpenApiTest(unittest.TestCase):
    def test_manual_keywords_history_includes_tracked_keywords_from_openapi_snapshot(self) -> None:
        """
        수기 입력 키워드 표(= /search-rank/history/manual-keywords)는
        '수기 키워드(월검색량) 목록'뿐 아니라,
        '내 상품 추적(TrackedProductKeyword)'의 키워드도 함께 보여야 한다.

        - 추적키워드의 과거 데이터는 fetch-today(OpenAPI) 스냅샷인 naver_product_rank_daily에 쌓이므로,
          이 테이블의 데이터를 manual-keywords 히스토리에서 함께 머지해서 내려줘야 한다.
        """
        client = TestClient(app)
        db = SessionLocal()

        today = _today_kst()
        yesterday = today - timedelta(days=1)

        pid = str(int(time.time() * 1000))  # unique-ish per run
        saved_url = f"https://smartstore.naver.com/test/products/{pid}?NaPm=ct%3Dxxx"
        query_url = f"https://smartstore.naver.com/test/products/{pid}"

        try:
            # 1) 추적키워드 1개 등록 (수기 키워드 목록은 비어 있어도 됨)
            db.merge(
                TrackedProductKeyword(
                    product_url=saved_url,
                    keyword="TK",
                    monthly_search_volume=123,
                    is_active=True,
                )
            )
            db.commit()

            # 2) OpenAPI(fetch-today) 스냅샷에 해당 상품이 포함된 것처럼 1건 심기
            db.merge(
                NaverProductRankDaily(
                    date=yesterday,
                    keyword="TK",
                    rank=12,
                    product_id=int(pid),
                    product_title="TEST",
                    mall_name="MALL",
                    price=0,
                    purchase_cnt=0,
                    is_our_brand=True,
                )
            )
            db.commit()

            resp = client.get("/search-rank/history/manual-keywords", params={"days": 7, "product_url": query_url})
            self.assertEqual(resp.status_code, 200)
            body = resp.json()
            series = body.get("series") or []
            s0 = next((s for s in series if s.get("keyword") == "TK"), None)
            self.assertIsNotNone(s0)
            pts = s0.get("series") or []
            ranks_by_date = {p.get("date"): p.get("rank") for p in pts}
            self.assertEqual(ranks_by_date.get(str(yesterday)), 12)
        finally:
            try:
                db.query(NaverProductRankDaily).filter(
                    NaverProductRankDaily.keyword == "TK",
                    NaverProductRankDaily.date == yesterday,
                    NaverProductRankDaily.product_id == int(pid),
                ).delete()
                db.query(TrackedProductKeyword).filter(TrackedProductKeyword.product_url == saved_url).delete()
                db.commit()
            except Exception:
                pass
            db.close()


if __name__ == "__main__":
    unittest.main()

