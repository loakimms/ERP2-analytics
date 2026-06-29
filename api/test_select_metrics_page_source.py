import main


def test_select_metrics_page_source_prefers_existing() -> None:
    assert (
        main._select_metrics_page_source(has_existing=True, has_captcha_shared=True, has_shared=True)
        == "existing"
    )


def test_select_metrics_page_source_prefers_shared_over_captcha_shared() -> None:
    assert (
        main._select_metrics_page_source(has_existing=False, has_captcha_shared=True, has_shared=True)
        == "captcha_shared"
    )


def test_select_metrics_page_source_uses_captcha_shared_when_no_shared() -> None:
    assert (
        main._select_metrics_page_source(has_existing=False, has_captcha_shared=True, has_shared=False)
        == "captcha_shared"
    )

