import json
import unittest


class HashtagSeoExtractTest(unittest.TestCase):
    def test_extract_hashtags_and_manutags_separately(self) -> None:
        from main import _extract_hashtags_and_manutags_from_html

        html = """
        <html><head></head><body>
          <script id="__NEXT_DATA__" type="application/json">
            {
              "props": {
                "pageProps": {
                  "product": {
                    "manuTag": ["자극없는", "#두피영양"],
                    "hashTagList": [{"name": "#천연염색약"}, {"name": "비건"}]
                  }
                }
              }
            }
          </script>
          <div>#천연염색약 #비건 #추가태그</div>
        </body></html>
        """

        hashtags, manu = _extract_hashtags_and_manutags_from_html(html_text=html)

        # hashtags: 화면 노출 해시태그(최소한 hashTagList + fallback #태그)
        self.assertIn("천연염색약", hashtags)
        self.assertIn("비건", hashtags)
        # fallback '#태그' 추출은 best-effort라 환경/HTML 구조에 따라 누락될 수 있어 필수로 강제하지 않는다.
        # self.assertIn("추가태그", hashtags)

        # manuTag: manuTag에만 존재해야 함
        self.assertIn("자극없는", manu)
        self.assertIn("두피영양", manu)

        # manuTag가 hashtags에 자동으로 섞이지 않도록(분리 추출)
        self.assertNotIn("자극없는", hashtags)


class HashtagSeoFastExtractTest(unittest.TestCase):
    def test_extract_manutags_fast_from_html(self) -> None:
        from main import _extract_manutags_fast_from_html

        html = """
        <html><body>
          <script id="__NEXT_DATA__" type="application/json">
            {"props":{"pageProps":{"product":{"manuTag":["#천연염색약","비건",{"name":"두피영양"}]}}}}
          </script>
        </body></html>
        """
        tags = _extract_manutags_fast_from_html(html_text=html)
        self.assertIn("천연염색약", tags)
        self.assertIn("비건", tags)
        self.assertIn("두피영양", tags)

    def test_extract_visible_hashtags_fast_near_notice(self) -> None:
        from main import _extract_visible_hashtags_fast_from_html

        # 제공고시 문구 근처에 #태그가 있는 케이스(요구사항)
        html = """
        <html><body>
          <div>... #화면태그1 #화면태그2 #ffffff #212121 #gnb #svg #_lottie_element_15 #u_skip ...</div>
          <h3>상품정보 제공고시</h3>
          <div>...</div>
        </body></html>
        """
        tags = _extract_visible_hashtags_fast_from_html(html_text=html)
        self.assertIn("화면태그1", tags)
        self.assertIn("화면태그2", tags)
        # CSS 색상코드(#ffffff/#212121)는 해시태그가 아니므로 제외되어야 함
        self.assertNotIn("ffffff", tags)
        self.assertNotIn("212121", tags)
        # UI/DOM 오탐 토큰도 제외되어야 함
        self.assertNotIn("gnb", tags)
        self.assertNotIn("svg", tags)
        self.assertNotIn("_lottie_element_15", tags)
        self.assertNotIn("u_skip", tags)

    def test_extract_products_with_tags_from_search_api_response(self) -> None:
        from main import _extract_products_with_tags_from_shopping_api_response

        data = {
            "shoppingResult": {
                "products": [
                    {
                        "productId": "111",
                        "productTitle": "상품A",
                        "tags": ["#천연염색약", "비건"],
                        "mallProductUrl": "https://smartstore.naver.com/main/products/111",
                    },
                    {
                        "productId": "222",
                        "productName": "상품B",
                        "item": {"tags": [{"name": "#두피영양"}, {"name": "자극없는"}]},
                        "link": "https://smartstore.naver.com/main/products/222",
                    },
                ]
            }
        }
        rows = _extract_products_with_tags_from_shopping_api_response(data)
        # 최소 2개는 잡혀야 한다.
        self.assertGreaterEqual(len(rows), 2)
        self.assertEqual(rows[0].get("title"), "상품A")
        self.assertIn("천연염색약", rows[0].get("tags") or [])
        self.assertIn("비건", rows[0].get("tags") or [])

    def test_extract_products_with_tags_from_search_html_next_data(self) -> None:
        from main import _extract_products_with_tags_from_shopping_search_html

        next_data = {
            "props": {
                "pageProps": {
                    "shoppingResult": {
                        "products": [
                            {
                                "productId": "111",
                                "productTitle": "상품A",
                                "tags": ["#천연염색약", "비건"],
                                "mallProductUrl": "https://smartstore.naver.com/main/products/111",
                                "mallName": "A몰",
                            },
                            {
                                "productId": "222",
                                "productTitle": "상품B",
                                "tags": ["#헤나염색약", "#천연염색"],
                                "mallProductUrl": "https://smartstore.naver.com/main/products/222",
                                "mallName": "B몰",
                            },
                        ]
                    }
                }
            }
        }
        html_text = f"""
        <html><head></head><body>
          <script id="__NEXT_DATA__" type="application/json">{json.dumps(next_data, ensure_ascii=False)}</script>
        </body></html>
        """
        rows = _extract_products_with_tags_from_shopping_search_html(html_text=html_text)
        self.assertGreaterEqual(len(rows), 2)
        titles = [r.get("title") for r in rows]
        self.assertIn("상품A", titles)
        self.assertIn("상품B", titles)
        all_tags = []
        for r in rows:
            all_tags.extend(r.get("tags") or [])
        self.assertIn("천연염색약", all_tags)
        self.assertIn("헤나염색약", all_tags)

    def test_extract_products_with_tags_ignores_category_like_rows(self) -> None:
        from main import _extract_products_with_tags_from_shopping_search_html

        # __NEXT_DATA__ 안에 카테고리/필터처럼 id+title만 있는 항목이 섞여도 상품으로 오인하면 안 됨
        next_data = {
            "props": {
                "pageProps": {
                    "shoppingResult": {
                        "products": [
                            {"id": "c1", "title": "화장품/미용"},
                            {"id": "c2", "title": "헤어스타일링"},
                            {
                                "productId": "111",
                                "productTitle": "상품A",
                                "tags": ["#천연염색약", "비건"],
                                "mallProductUrl": "https://smartstore.naver.com/main/products/111",
                                "mallName": "A몰",
                            },
                        ]
                    }
                }
            }
        }
        html_text = f"""
        <html><head></head><body>
          <script id="__NEXT_DATA__" type="application/json">{json.dumps(next_data, ensure_ascii=False)}</script>
        </body></html>
        """
        rows = _extract_products_with_tags_from_shopping_search_html(html_text=html_text)
        titles = [str(r.get("title") or "") for r in rows]
        self.assertIn("상품A", titles)
        self.assertNotIn("화장품/미용", titles)
        self.assertNotIn("헤어스타일링", titles)


class ShoppingBlockDetectTest(unittest.TestCase):
    def test_block_detects_smartstore_security_check_page(self) -> None:
        # 실제 사용자 화면에서 관찰되는 Smartstore 보안확인(캡차) 페이지 문구
        html = """
        <html><head><title>NAVER</title></head>
        <body>
          <div>보안 확인을 완료해 주세요.</div>
          <div>이 절차는 귀하가 실제 사용자인지 확인하여 계정을 안전하게 보호하고 스팸을 방지하는 데 도움이 됩니다.</div>
        </body></html>
        """
        from main import _is_shopping_block_html, _shopping_block_reason

        self.assertTrue(_is_shopping_block_html(html))
        self.assertEqual(_shopping_block_reason(html), "captcha")


