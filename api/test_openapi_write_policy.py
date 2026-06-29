from unittest.mock import MagicMock, patch
from datetime import date


def _mock_session_local():
    s = MagicMock(name="session")
    # context manager support: with SessionLocal() as s
    cm = MagicMock(name="cm")
    cm.__enter__.return_value = s
    cm.__exit__.return_value = False
    return cm, s


def test_write_keyword_result_skips_zero_when_openapi_error() -> None:
    import main

    cm, s = _mock_session_local()
    with patch.object(main, "SessionLocal", return_value=cm):
        n = main._write_keyword_result_impl(
            "kw",
            found_rank_by_url={"u1": 0, "u2": 7},
            had_openapi_error=True,
            product_urls=["u1", "u2"],
            target_date=date(2026, 3, 17),
        )

    # u1(rank=0) should be skipped; u2(rank=7) should be upserted
    assert s.execute.call_count == 1
    assert n == 1


def test_write_keyword_result_writes_zero_when_success() -> None:
    import main

    cm, s = _mock_session_local()
    with patch.object(main, "SessionLocal", return_value=cm):
        n = main._write_keyword_result_impl(
            "kw",
            found_rank_by_url={"u1": 0},
            had_openapi_error=False,
            product_urls=["u1"],
            target_date=date(2026, 3, 17),
        )

    assert s.execute.call_count == 1
    assert n == 1


def test_openapi_fetch_rank_returns_last_status() -> None:
    import main

    # simulate one page returning 500
    with patch.object(main, "_openapi_fetch_shop_items", return_value=(500, [])):
        kw, found, had_err, st = main._openapi_fetch_rank_for_one_keyword(
            "k",
            product_urls=["u"],
            smart_to_urls={},
            catalog_to_urls={},
            max_rank=40,
            client_id="x",
            client_secret="y",
        )
    assert kw == "k"
    assert had_err is True
    assert st == 500
    assert found.get("u") == 0

