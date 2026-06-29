import os
import unittest
from unittest.mock import patch


class _FakePage:
    def __init__(self, url: str, html: str):
        self.url = url
        self._html = html
        self.gotos: list[str] = []
        self.front_calls = 0

    def goto(self, url: str, **_kwargs):
        self.gotos.append(url)
        self.url = url

    def wait_for_load_state(self, *_args, **_kwargs):
        return None

    def bring_to_front(self):
        self.front_calls += 1
        return None

    def content(self):
        return self._html


class _FakeCtx:
    def __init__(self, pages):
        self.pages = pages

    def new_page(self):
        p = _FakePage("about:blank", "")
        self.pages.append(p)
        return p


class ShoppingSearchOpenTest(unittest.TestCase):
    @patch.dict(
        os.environ,
        {
            "USE_HOST_CHROME": "1",
            "PW_CDP_URL": "http://host.docker.internal:9223",
            "SHOPPING_SEED_PRODUCT_URL": "https://smartstore.naver.com/x/products/123456",
        },
        clear=False,
    )
    def test_open_returns_host_cdp_json_list_url_and_seed_fallback_on_block(self):
        from main import app

        # main 모듈의 전역 상태에 영향이 있으니 런타임 패치로 격리
        import main as m

        fake_page = _FakePage(
            # 코드가 about:blank 탭은 재사용 후보에서 제외하므로, HTTP URL로 시작시켜 재사용되게 한다.
            "https://search.shopping.naver.com/search/all?query=%ED%97%A4%EB%82%98",
            "<html><body>쇼핑 서비스 접속이 일시적으로 제한되었습니다.</body></html>",
        )
        ctx = _FakeCtx([fake_page])

        def _direct_call(fn, *args, **kwargs):
            return fn()

        prev_browser = getattr(m, "PW_BROWSER", None)
        prev_err = getattr(m, "PW_LAST_CDP_ERROR", None)
        prev_page = getattr(m, "SHOPPING_SEARCH_PAGE", None)
        try:
            # host_cdp 모드가 "실제 연결 상태" 기준으로 계산되므로, 테스트에서는 CDP 연결이 성공한 상태를 흉내낸다.
            m.PW_BROWSER = object()
            m.PW_LAST_CDP_ERROR = None
            # 전역 탭이 남아있으면 ctx.pages 선택 로직이 우회되므로, 테스트는 명시적으로 주입한다.
            m.SHOPPING_SEARCH_PAGE = fake_page

            with patch.object(m, "_ensure_pw_context", return_value=ctx), patch.object(m, "_pw_call", side_effect=_direct_call):
                # FastAPI 라우트는 이미 등록되어 있어야 함
                from fastapi.testclient import TestClient

                client = TestClient(app)
                res = client.get("/research/shopping-search/open", params={"keyword": "헤나", "new_page": "false"})
                self.assertEqual(res.status_code, 200)
                data = res.json()

                self.assertEqual(data["mode"], "host_cdp")
                # host cdp는 컨테이너 devtools(19222)가 아니라 호스트(9223)를 안내해야 함
                self.assertTrue(str(data["devtools"]["jsonListUrl"]).endswith(":9223/json/list"))
                # 차단 감지 + 시드 페이지로 전환 시도
                self.assertTrue(data.get("blockDetected") is True)
                self.assertEqual(data.get("blockReason"), "access_limited")
                self.assertTrue(data.get("openedSeed") is True)
                self.assertTrue(data.get("forceSearch") is False)
                self.assertEqual(data.get("seedUrl"), os.environ["SHOPPING_SEED_PRODUCT_URL"])
                self.assertIn(data.get("pageType"), ("seed", "smartstore", "other"))
        finally:
            try:
                m.PW_BROWSER = prev_browser
                m.PW_LAST_CDP_ERROR = prev_err
                m.SHOPPING_SEARCH_PAGE = prev_page
            except Exception:
                pass

    @patch.dict(
        os.environ,
        {
            "USE_HOST_CHROME": "1",
            "PW_CDP_URL": "http://host.docker.internal:9223",
            "SHOPPING_SEED_PRODUCT_URL": "https://smartstore.naver.com/x/products/123456",
        },
        clear=False,
    )
    def test_open_does_not_seed_when_force_search_true_even_if_blocked(self):
        from main import app

        import main as m

        # blocked html (access limited)이더라도 force_search=true면 seed로 이동하면 안 된다.
        fake_page = _FakePage(
            "https://search.shopping.naver.com/search/all?query=%ED%97%A4%EB%82%98",
            "<html><body>쇼핑 서비스 접속이 일시적으로 제한되었습니다.</body></html>",
        )
        ctx = _FakeCtx([fake_page])

        def _direct_call(fn, *args, **kwargs):
            return fn()

        prev_browser = getattr(m, "PW_BROWSER", None)
        prev_err = getattr(m, "PW_LAST_CDP_ERROR", None)
        prev_page = getattr(m, "SHOPPING_SEARCH_PAGE", None)
        try:
            m.PW_BROWSER = object()
            m.PW_LAST_CDP_ERROR = None
            m.SHOPPING_SEARCH_PAGE = fake_page

            with patch.object(m, "_ensure_pw_context", return_value=ctx), patch.object(m, "_pw_call", side_effect=_direct_call):
                from fastapi.testclient import TestClient

                client = TestClient(app)
                res = client.get(
                    "/research/shopping-search/open",
                    params={"keyword": "헤나", "new_page": "false", "force_search": "true"},
                )
                self.assertEqual(res.status_code, 200)
                data = res.json()
                self.assertTrue(data.get("forceSearch") is True)
                self.assertTrue(data.get("blockDetected") is True)
                self.assertEqual(data.get("blockReason"), "access_limited")
                # force_search=true면 seed로 이동하지 않는다.
                self.assertTrue(data.get("openedSeed") is False)
        finally:
            try:
                m.PW_BROWSER = prev_browser
                m.PW_LAST_CDP_ERROR = prev_err
                m.SHOPPING_SEARCH_PAGE = prev_page
            except Exception:
                pass


if __name__ == "__main__":
    unittest.main()


