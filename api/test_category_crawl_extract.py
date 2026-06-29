import unittest

from main import _extract_ranked_links_from_shopping_api_response


class TestCategoryCrawlExtract(unittest.TestCase):
    def test_extract_ranked_links_prefers_product_list_order(self):
        data = {
            "dummy": {"x": 1},
            "shoppingResult": {
                "products": [
                    {"productTitle": "A", "link": "https://smartstore.naver.com/m/products/111"},
                    {"productTitle": "B", "link": "https://smartstore.naver.com/m/products/222"},
                    {"productTitle": "C", "link": "https://smartstore.naver.com/m/products/333"},
                ]
            },
        }
        links = _extract_ranked_links_from_shopping_api_response(data)
        self.assertEqual(
            links[:3],
            [
                "https://smartstore.naver.com/m/products/111",
                "https://smartstore.naver.com/m/products/222",
                "https://smartstore.naver.com/m/products/333",
            ],
        )

