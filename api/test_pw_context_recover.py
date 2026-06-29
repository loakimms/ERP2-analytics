import unittest
from unittest.mock import MagicMock, patch


class PlaywrightContextRecoverTest(unittest.TestCase):
    def test_pw_new_page_recovers_when_context_closed(self) -> None:
        import main

        class Ctx:
            def __init__(self, should_fail: bool):
                self.should_fail = should_fail
                self.calls = 0

            def new_page(self):
                self.calls += 1
                if self.should_fail:
                    raise RuntimeError("BrowserContext.new_page: Target page, context or browser has been closed")
                return "PAGE_OK"

        bad = Ctx(should_fail=True)
        good = Ctx(should_fail=False)

        with patch("main._close_pw_context") as mock_close, patch("main._ensure_pw_context") as mock_ensure:
            mock_ensure.return_value = good
            page = main._pw_new_page(bad)
            self.assertEqual(page, "PAGE_OK")
            mock_close.assert_called()
            mock_ensure.assert_called()

    def test_pw_new_page_does_not_retry_for_other_errors(self) -> None:
        import main

        class Ctx:
            def new_page(self):
                raise RuntimeError("some other error")

        with patch("main._close_pw_context") as mock_close, patch("main._ensure_pw_context") as mock_ensure:
            with self.assertRaises(RuntimeError):
                main._pw_new_page(Ctx())
            mock_close.assert_not_called()
            mock_ensure.assert_not_called()


if __name__ == "__main__":
    unittest.main()

