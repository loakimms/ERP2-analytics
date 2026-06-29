import unittest

from fastapi.testclient import TestClient

from main import app, get_db


class RankTextImportApiTest(unittest.TestCase):
    def test_import_text_saves_all_keywords_without_adding_tracked_keywords_and_reports_completion(self) -> None:
        """
        목표:
        - 텍스트 입력은 '추적 키워드'에 없는 키워드가 섞여도 409 없이 저장된다.
        - 저장은 tracked_product_rank_daily에 upsert(source='text')로 들어간다고 가정한다.
        - 입력 텍스트에 '추적 키워드'가 포함되고, 그 추적 키워드가 모두 채워지면 complete=true를 반환한다.
        """

        class FakeQuery:
            def __init__(self, rows):
                self._rows = rows

            def filter(self, *args, **kwargs):
                return self

            def order_by(self, *args, **kwargs):
                return self

            def all(self):
                return self._rows

        class FakeSession:
            def __init__(self):
                # tracked keywords for this product_url
                self.tracked = [
                    type("TK", (), {"keyword": "키워드A"})(),
                    type("TK", (), {"keyword": "키워드B"})(),
                ]
                self.merged = []
                self.commits = 0

            def query(self, model):
                # TrackedProductKeyword 조회만 사용한다고 가정
                return FakeQuery(self.tracked)

            def merge(self, obj):
                self.merged.append(obj)
                return obj

            def add(self, obj):
                # merge 미지원 환경 fallback 대비
                self.merged.append(obj)

            def commit(self):
                self.commits += 1

        def override_get_db():
            yield FakeSession()

        app.dependency_overrides[get_db] = override_get_db
        try:
            client = TestClient(app)
            text = (
                "키워드A / 1위\t키워드B / 10위\t기타키워드 / 51위\n"
                "또다른키워드 / 198위"
            )
            resp = client.post(
                "/search-rank/ranks/import-text",
                json={
                    "product_url": "https://smartstore.naver.com/x/products/1",
                    "date": "2026-01-18",
                    "text": text,
                },
            )
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertEqual(data["saved"], 4)
            self.assertEqual(data["date"], "2026-01-18")
            self.assertEqual(data["tracked_keywords_total"], 2)
            self.assertEqual(data["tracked_keywords_covered"], 2)
            self.assertTrue(data["is_tracked_complete"])
            self.assertEqual(data["missing_tracked_keywords"], [])
        finally:
            app.dependency_overrides.pop(get_db, None)


class TrackedRankHistoryProductUrlMatchingTest(unittest.TestCase):
    def test_history_matches_tracked_daily_by_product_id_even_if_querystring_differs(self) -> None:
        """
        product_url PK가 문자열 완전일치라서 URL 표기 차이로 조회가 깨지는 문제를 방지한다.
        - 저장: https://.../products/110?NaPm=...
        - 조회: https://.../products/110
        => productId(마지막 path 숫자)가 같으면 같은 상품으로 취급하여 history에 포함되어야 한다.
        """
        from datetime import date

        from db import SessionLocal, TrackedProductRankDaily

        client = TestClient(app)
        db = SessionLocal()
        saved_url = "https://smartstore.naver.com/test/products/11043833896?NaPm=ct%3Dxxx"
        query_url = "https://smartstore.naver.com/test/products/11043833896"
        try:
            d = date.today()
            db.merge(
                TrackedProductRankDaily(
                    date=d,
                    product_url=saved_url,
                    keyword="테스트키워드",
                    rank=3,
                    source="text",
                )
            )
            db.commit()

            resp = client.get("/search-rank/history", params={"days": 7, "product_url": query_url})
            self.assertEqual(resp.status_code, 200)
            body = resp.json()
            keywords = [s["keyword"] for s in (body.get("series") or [])]
            self.assertIn("테스트키워드", keywords)
        finally:
            try:
                db.query(TrackedProductRankDaily).filter(TrackedProductRankDaily.product_url == saved_url).delete()
                db.commit()
            except Exception:
                pass
            db.close()


if __name__ == "__main__":
    unittest.main()

