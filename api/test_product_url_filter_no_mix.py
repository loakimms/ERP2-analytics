import unittest
from datetime import date

from fastapi.testclient import TestClient

from db import SessionLocal, TrackedProductRankDaily, TrackedProductManualKeyword
from main import app


class ProductUrlFilterNoMixTest(unittest.TestCase):
    def test_manual_keywords_history_does_not_mix_by_pid_substring_in_query(self) -> None:
        client = TestClient(app)
        db = SessionLocal()
        d = date.today()

        pid_a = "777000111222"
        pid_b = "888000333444"
        url_a = f"https://smartstore.naver.com/test/products/{pid_a}?NaPm=ct%3Daaaa"
        # 다른 상품이지만 query에 pid_a가 포함되어 있어, 과거 '%{pid}%' 매칭이면 섞일 수 있었다.
        url_b = f"https://smartstore.naver.com/test/products/{pid_b}?x={pid_a}"
        try:
            # 두 상품 모두 후보 키워드 1개 활성
            db.merge(TrackedProductManualKeyword(product_url=url_a, keyword="K", monthly_search_volume=10, is_active=True))
            db.merge(TrackedProductManualKeyword(product_url=url_b, keyword="K", monthly_search_volume=10, is_active=True))
            # rank snapshot 저장(openapi)
            db.merge(TrackedProductRankDaily(date=d, product_url=url_a, keyword="K", rank=5, source="openapi"))
            db.merge(TrackedProductRankDaily(date=d, product_url=url_b, keyword="K", rank=99, source="openapi"))
            db.commit()

            resp = client.get("/search-rank/history/manual-keywords", params={"days": 7, "product_url": url_a})
            self.assertEqual(resp.status_code, 200)
            body = resp.json()
            # K 시계열의 가장 최근 값이 url_a의 값(5)이어야 한다.
            series = body.get("series") or []
            s0 = next((s for s in series if s.get("keyword") == "K"), None)
            self.assertIsNotNone(s0)
            pts = s0.get("series") or []
            last = pts[-1]["rank"] if pts else None
            self.assertEqual(last, 5)
        finally:
            try:
                db.query(TrackedProductRankDaily).filter(TrackedProductRankDaily.product_url.in_([url_a, url_b])).delete()
                db.query(TrackedProductManualKeyword).filter(TrackedProductManualKeyword.product_url.in_([url_a, url_b])).delete()
                db.commit()
            except Exception:
                pass
            db.close()


if __name__ == "__main__":
    unittest.main()

