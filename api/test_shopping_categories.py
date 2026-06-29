import unittest


from main import _extract_category_candidates_from_shopping_api


class ShoppingCategoryExtractTest(unittest.TestCase):
    def test_extracts_nested_categories(self):
        # 구조는 실제 쇼핑 API와 정확히 같지 않을 수 있으나,
        # 최소한 name/id/children 패턴을 제대로 처리하는지 검증한다.
        fake = {
            "shoppingResult": {
                "filters": [
                    {
                        "name": "카테고리",
                        "values": [
                            {
                                "id": "50000000",
                                "name": "화장품/미용",
                                "count": 120,
                                "children": [
                                    {
                                        "id": "50000001",
                                        "name": "헤어스타일링",
                                        "count": 40,
                                        "children": [
                                            {"id": "50000002", "name": "염색약", "count": 10},
                                        ],
                                    }
                                ],
                            }
                        ],
                    }
                ]
            }
        }
        rows = _extract_category_candidates_from_shopping_api(fake)
        self.assertTrue(any(r.get("id") == "50000000" and "화장품/미용" in (r.get("path") or "") for r in rows))
        self.assertTrue(any(r.get("id") == "50000002" and "염색약" in (r.get("path") or "") for r in rows))




