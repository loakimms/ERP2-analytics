import unittest

from main import _extract_ranked_product_ids_from_shopping_api_response


class ExtractRankedProductIdsTest(unittest.TestCase):
    def test_prefers_mallProductId_over_catalog_link(self) -> None:
        data = {
            "shoppingResult": {
                "products": [
                    {
                        "productTitle": "A",
                        "mallProductId": "11043833896",
                        # catalog 링크가 섞여 있어도 mallProductId를 우선해야 한다.
                        "link": "https://search.shopping.naver.com/catalog/99999999999",
                    },
                    {
                        "productTitle": "B",
                        "productId": 4743750201,
                        "link": "https://smartstore.naver.com/x/products/4743750201?NaPm=ct%3Dxxxx",
                    },
                ]
            }
        }
        ids = _extract_ranked_product_ids_from_shopping_api_response(data)
        self.assertEqual(ids[:2], ["11043833896", "4743750201"])

    def test_link_fallback_only_accepts_products_path(self) -> None:
        data = {
            "shoppingResult": {
                "products": [
                    {"productTitle": "A", "link": "https://search.shopping.naver.com/catalog/1234567890"},
                    {"productTitle": "B", "link": "https://smartstore.naver.com/m/products/3334445556"},
                ]
            }
        }
        ids = _extract_ranked_product_ids_from_shopping_api_response(data)
        # catalog 링크는 id로 쓰면 오매칭 위험이 있어 제외되어야 한다.
        self.assertEqual(ids, ["3334445556"])


if __name__ == "__main__":
    unittest.main()

