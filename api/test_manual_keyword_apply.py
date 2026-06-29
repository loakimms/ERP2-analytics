import unittest

from fastapi.testclient import TestClient

from main import app


class TestManualKeywordApply(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_apply_manual_keywords_copies_list_to_targets(self):
        src = "https://smartstore.naver.com/testmall/products/999999999991"
        tgt = "https://smartstore.naver.com/testmall/products/999999999992"

        # 1) source에 수기 키워드(월검색량) 저장
        res0 = self.client.post(
            "/search-rank/manual-keywords/import",
            json={
                "product_url": src,
                "mode": "replace",
                "items": [
                    {"keyword": "키워드A", "monthly_search_volume": 123},
                    {"keyword": "키워드B", "monthly_search_volume": 456},
                ],
            },
        )
        self.assertEqual(res0.status_code, 200)

        # 2) apply
        res = self.client.post(
            "/search-rank/manual-keywords/apply",
            json={"source_product_url": src, "target_product_urls": [tgt]},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(int(data.get("applied_products") or 0), 1)
        self.assertEqual(int(data.get("keywords") or 0), 2)

        # 3) target 목록 조회
        res2 = self.client.get("/search-rank/manual-keywords", params={"product_url": tgt})
        self.assertEqual(res2.status_code, 200)
        rows = res2.json()
        kws = sorted([str(r.get("keyword") or "").strip() for r in rows if str(r.get("keyword") or "").strip()])
        self.assertEqual(kws, ["키워드A", "키워드B"])

