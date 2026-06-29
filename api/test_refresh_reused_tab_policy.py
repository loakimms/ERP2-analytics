def test_should_refresh_reused_tab_when_blocked_captcha_shared_false() -> None:
    import main

    assert main._should_refresh_reused_tab_when_blocked("captcha_shared") is False
    assert main._should_refresh_reused_tab_when_blocked(" CAPTCHA_SHARED ") is False


def test_should_refresh_reused_tab_when_blocked_other_true() -> None:
    import main

    assert main._should_refresh_reused_tab_when_blocked(None) is True
    assert main._should_refresh_reused_tab_when_blocked("") is True
    assert main._should_refresh_reused_tab_when_blocked("shared") is True
    assert main._should_refresh_reused_tab_when_blocked("existing") is True

