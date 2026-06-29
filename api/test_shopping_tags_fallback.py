import unittest
from unittest.mock import patch


class ShoppingTagsFallbackTest(unittest.TestCase):
    def test_shopping_tags_fallback_extracts_tags_from_search_html_when_api_418(self) -> None:
        from main import app

        import main as m
        from fastapi.testclient import TestClient

        # /api/search/all 이 막혀도 페이지 HTML(__NEXT_DATA__)에서 tags를 복구할 수 있어야 한다.
        next_data_html = """
        <html><head></head><body>
          <script id="__NEXT_DATA__" type="application/json">
            {"props":{"pageProps":{"shoppingResult":{"products":[
              {"productId":"111","productTitle":"상품A","tags":["#천연염색약","비건"],"mallProductUrl":"https://smartstore.naver.com/main/products/111","mallName":"몰A"},
              {"productId":"222","productTitle":"상품B","tags":["#헤나염색약","#천연염색"],"mallProductUrl":"https://smartstore.naver.com/main/products/222","mallName":"몰B"}
            ]}}}}
          </script>
        </body></html>
        """

        class _FakePage:
            def __init__(self):
                self.url = "https://search.shopping.naver.com/search/all?query=헤나염색약"

            def goto(self, *_args, **_kwargs):
                return None

            def wait_for_load_state(self, *_args, **_kwargs):
                return None

            def content(self):
                return next_data_html

            def close(self):
                return None

        class _FakeCtx:
            def __init__(self):
                self.pages = []

            def new_page(self):
                p = _FakePage()
                self.pages.append(p)
                return p

        # search/all API는 418로 막힌 상태를 가정
        def fake_fetch_via_page(_page, _kw):
            return (418, '{"error":"blocked"}')

        fake_ctx = _FakeCtx()

        with patch.object(m, "_playwright_enabled", return_value=True), patch.object(
            m, "_pw_in_worker_thread", return_value=True
        ), patch.object(m, "_ensure_pw_context", return_value=fake_ctx), patch.object(
            m, "_shopping_api_fetch_via_page", side_effect=fake_fetch_via_page
        ):
            # 다른 테스트에서 재사용 탭이 남아 있으면 이 테스트의 FakePage가 사용되지 않을 수 있어 초기화한다.
            m.SHOPPING_SEARCH_PAGE = None
            client = TestClient(app)
            res = client.get(
                "/research/seo/shopping-tags",
                params={"keyword": "헤나염색약", "limit": 5, "scrape_products": 2},
            )
            self.assertEqual(res.status_code, 200)
            data = res.json()
            # productCount는 "전체 결과 수" 성격(또는 상위 추정치)이라 케이스에 따라 달라질 수 있다.
            # 여기서는 HTML(__NEXT_DATA__)에 있던 상품(111/222)의 tags가 복구되는지만 검증한다.
            products = data.get("products") or []
            self.assertGreaterEqual(len(products), 2)
            self.assertGreaterEqual(int(data.get("productCount") or 0), 2)

            # 응답의 제품 구조는 내부 정규화로 "title/tags/link" 형태로 내려온다.
            by_title = {str(p.get("title") or ""): p for p in products if isinstance(p, dict) and p.get("title")}
            self.assertIn("상품A", by_title)
            self.assertIn("상품B", by_title)

            self.assertIn("천연염색약", by_title["상품A"]["tags"])
            self.assertIn("비건", by_title["상품A"]["tags"])
            self.assertIn("헤나염색약", by_title["상품B"]["tags"])
            # 디버그: HTML fallback 경로 표시
            dbg = data.get("debug") or {}
            self.assertEqual(dbg.get("apiStatus"), 418)
            self.assertEqual(dbg.get("tagsVia"), "search_html_next_data")

    def test_shopping_tags_uses_ctx_request_when_page_fetch_is_blocked(self) -> None:
        from main import app

        import main as m
        from fastapi.testclient import TestClient

        class _FakePage:
            def __init__(self):
                self.url = "https://search.shopping.naver.com/search/all?query=헤나"

            def goto(self, *_args, **_kwargs):
                return None

            def wait_for_load_state(self, *_args, **_kwargs):
                return None

            def content(self):
                return "<html><body><script id=\"__NEXT_DATA__\">{}</script></body></html>"

            def close(self):
                return None

        class _FakeCtx:
            def __init__(self):
                self.pages = []
                # ctx.request.get을 흉내내기 위한 dummy
                self.request = self

            def new_page(self):
                p = _FakePage()
                self.pages.append(p)
                return p

            def get(self, *_args, **_kwargs):
                class _Resp:
                    status = 200

                    def text(self):
                        return '{"shoppingResult":{"products":[{"productId":"111","productTitle":"상품A","tags":["#천연염색약","비건"],"mallProductUrl":"https://smartstore.naver.com/main/products/111"}]}}'

                return _Resp()

        fake_ctx = _FakeCtx()

        def fake_fetch_via_page(_page, _kw):
            return (418, '{"error":"blocked"}')

        with patch.object(m, "_playwright_enabled", return_value=True), patch.object(
            m, "_pw_in_worker_thread", return_value=True
        ), patch.object(m, "_ensure_pw_context", return_value=fake_ctx), patch.object(
            m, "_shopping_api_fetch_via_page", side_effect=fake_fetch_via_page
        ):
            client = TestClient(app)
            res = client.get("/research/seo/shopping-tags", params={"keyword": "헤나", "limit": 5, "scrape_products": 2})
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertEqual(data["productCount"], 1)
            self.assertIn("천연염색약", data["products"][0]["tags"])
            dbg = data.get("debug") or {}
            self.assertEqual(dbg.get("apiVia"), "ctx_request")

    def test_shopping_tags_does_not_navigate_away_when_captcha_pending(self) -> None:
        from main import app

        import main as m
        from fastapi.testclient import TestClient

        captcha_html = "<html><body>보안 확인을 완료해 주세요.</body></html>"

        class _FakePage:
            def __init__(self):
                self.url = "https://search.shopping.naver.com/search/all?query=헤나"
                self.gotos: list[str] = []

            def goto(self, url: str, **_kwargs):
                self.gotos.append(url)
                self.url = url

            def wait_for_load_state(self, *_args, **_kwargs):
                return None

            def content(self):
                return captcha_html

            def close(self):
                return None

        class _FakeCtx:
            def __init__(self, pages):
                self.pages = pages

            def new_page(self):
                p = _FakePage()
                self.pages.append(p)
                return p

        page = _FakePage()
        ctx = _FakeCtx([page])

        # 재사용 탭으로 인식되게 전역 SHOPPING_SEARCH_PAGE를 세팅
        prev = getattr(m, "SHOPPING_SEARCH_PAGE", None)
        try:
            m.SHOPPING_SEARCH_PAGE = page
            with patch.object(m, "_playwright_enabled", return_value=True), patch.object(
                m, "_pw_in_worker_thread", return_value=True
            ), patch.object(m, "_ensure_pw_context", return_value=ctx):
                client = TestClient(app)
                res = client.get("/research/seo/shopping-tags", params={"keyword": "헤나", "limit": 5, "scrape_products": 2})
                self.assertEqual(res.status_code, 200)
                data = res.json()
                dbg = data.get("debug") or {}
                # 캡차 대기 상태로 판단되어야 함
                self.assertEqual(dbg.get("blockReason"), "captcha")
                self.assertEqual(dbg.get("error"), "captcha_pending")
                # 캡차 화면을 덮어쓰는 goto가 호출되면 안 됨
                self.assertEqual(page.gotos, [])
        finally:
            m.SHOPPING_SEARCH_PAGE = prev


if __name__ == "__main__":
    unittest.main()


