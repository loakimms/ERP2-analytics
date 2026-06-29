from datetime import date


def test_resolve_a1_date_range_uses_custom_range_and_swaps() -> None:
    import main

    df, dt, days = main._resolve_a1_date_range(days=30, date_from="2026-03-10", date_to="2026-03-01", max_days=90)
    assert df == date(2026, 3, 1)
    assert dt == date(2026, 3, 10)
    assert days == 10


def test_a1_compute_rank_summary_respects_custom_date_range() -> None:
    import main
    from db import SessionLocal, TrackedProductRankDaily, init_db

    init_db()
    u = "https://smartstore.naver.com/test/products/999000777888"
    kw = "천연염색약"

    with SessionLocal() as s:
        s.add(TrackedProductRankDaily(date=date(2026, 3, 1), product_url=u, keyword=kw, rank=5, source="openapi"))
        s.add(TrackedProductRankDaily(date=date(2026, 3, 2), product_url=u, keyword=kw, rank=4, source="openapi"))
        s.add(TrackedProductRankDaily(date=date(2026, 3, 3), product_url=u, keyword=kw, rank=3, source="openapi"))
        s.commit()

    with SessionLocal() as s:
        out = main._a1_compute_rank_summary(
            s,
            product_url=u,
            keyword=kw,
            date_from=date(2026, 3, 1),
            date_to=date(2026, 3, 3),
        )

    dr = out.get("date_range") or {}
    assert dr.get("from") == "2026-03-01"
    assert dr.get("to") == "2026-03-03"
    assert int(dr.get("days") or 0) == 3

    series = out.get("rank_series") or []
    assert len(series) == 3
    assert [int(x.get("rank_raw") or 0) for x in series] == [5, 4, 3]

