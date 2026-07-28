"""Season-semantics tests (audit 2026-07-27).

These guard the exact class of bug that kept NBA out of the projections table:
labels written in the wrong format ('2026' vs '2026-27') and games bucketed by
calendar year across NBA's Oct-Apr season boundary. Stdlib-only, like
test_franchise_edge.py, so projections-test.yml keeps its pytest-only install.
"""
from datetime import date

from season_windows import (
    fallback_window,
    parse_start_year,
    resolve_windows,
    season_label,
)


# ── labels ────────────────────────────────────────────────────────────────────

def test_nba_label_is_cross_year():
    assert season_label("nba", 2026) == "2026-27"


def test_nba_label_zero_pads_the_century_rollover():
    # 1999-00, 2099-00 — the %02d must not emit '1999-0'.
    assert season_label("nba", 1999) == "1999-00"
    assert season_label("nba", 2099) == "2099-00"


def test_single_year_sports_use_bare_year():
    assert season_label("wnba", 2026) == "2026"
    assert season_label("nfl", 2026) == "2026"


def test_parse_start_year_handles_both_formats():
    assert parse_start_year("2026-27") == 2026
    assert parse_start_year("2026") == 2026
    assert parse_start_year(2026) == 2026


def test_label_roundtrip():
    for sport in ("nba", "wnba"):
        for year in (1999, 2025, 2026, 2030):
            assert parse_start_year(season_label(sport, year)) == year


# ── fallback windows ──────────────────────────────────────────────────────────

def test_nba_fallback_spans_the_calendar_boundary():
    start, end = fallback_window("nba", 2026)
    assert start == date(2026, 10, 1)
    assert end == date(2027, 6, 30)


def test_wnba_fallback_is_the_calendar_year():
    start, end = fallback_window("wnba", 2024)
    assert (start, end) == (date(2024, 1, 1), date(2024, 12, 31))


# ── resolve_windows ───────────────────────────────────────────────────────────

CONFIG = [
    ("2025-26", date(2025, 10, 21), date(2026, 4, 12)),
    ("2026-27", date(2026, 10, 20), date(2027, 4, 11)),
]


def test_config_rows_win_over_fallback():
    w = resolve_windows("nba", [2025, 2026], CONFIG)
    assert w[2025] == (date(2025, 10, 21), date(2026, 4, 12))
    assert w[2026] == (date(2026, 10, 20), date(2027, 4, 11))


def test_missing_seasons_fall_back():
    w = resolve_windows("nba", [2021], CONFIG)
    assert w[2021] == (date(2021, 10, 1), date(2022, 6, 30))


def test_null_config_dates_are_ignored():
    rows = CONFIG + [("2027-28", None, None)]
    w = resolve_windows("nba", [2027], rows)
    assert w[2027] == fallback_window("nba", 2027)


def test_january_game_belongs_to_the_prior_start_year():
    """THE bug: a Jan 2026 NBA game is part of the 2025-26 season. Under
    EXTRACT(YEAR) it landed in the '2026' bucket — half a season in the wrong
    year, and the current-season sample stopped growing every Jan 1."""
    w = resolve_windows("nba", [2025, 2026], CONFIG)
    jan_game = date(2026, 1, 15)
    in_2025 = w[2025][0] <= jan_game <= w[2025][1]
    in_2026 = w[2026][0] <= jan_game <= w[2026][1]
    assert in_2025 and not in_2026


def test_wnba_windows_do_not_overlap_year_to_year():
    w = resolve_windows("wnba", [2025, 2026],
                        [("2025", date(2025, 5, 16), date(2025, 9, 11)),
                         ("2026", date(2026, 5, 15), date(2026, 9, 13))])
    assert w[2025][1] < w[2026][0]
