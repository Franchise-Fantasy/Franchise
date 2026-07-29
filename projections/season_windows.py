"""
Season semantics for the projections engine — pure, stdlib-only.
========================================================================
The engine's internal season key is an INTEGER START YEAR for every sport
(2026 = WNBA "2026" = NBA "2026-27"). That keeps all existing arithmetic
(`season - 1`, `range(...)`) valid across sports. This module owns the two
boundary conversions that used to be implicit (and WNBA-shaped):

  - LABEL: what the season is called in season_config / player_projections /
    the app. WNBA/NFL use the bare year ('2026'); NBA uses 'YYYY-YY'
    ('2026-27'). write_projections MUST store the label — the app pins
    `.eq('season', getCurrentSeason(sport))`, so a row written under '2026'
    for NBA would be invisible to every consumer (audit 2026-07-27).

  - DATE WINDOW: which game_dates belong to the season. The old
    `EXTRACT(YEAR FROM game_date) = <year>` filter only works for sports whose
    season sits inside one calendar year; an NBA season spans Oct–Apr, so the
    year filter split it in half and mixed halves of DIFFERENT seasons into
    one bucket (audit 2026-07-27). Windows now come from season_config
    (start_date..end_date — which also excludes playoff games, restoring the
    source engine's postseason filter), with a per-sport calendar fallback for
    historical seasons that predate season_config rows (WNBA history back to
    2020). Fallback windows can't exclude playoffs — acceptable for old
    seasons, and no worse than the EXTRACT(YEAR) behavior they replace.

Kept stdlib-only (datetime) on purpose: projections-test.yml installs only
pytest, and the season-boundary math is exactly what unit tests must cover
(the Jan-1 NBA boundary, the label formats).
"""
from datetime import date


def season_label(sport: str, start_year: int) -> str:
    """The canonical app-facing label for a season. Must match season_config
    and getCurrentSeason(sport) in the app ('2026-27' for NBA, '2026' else)."""
    if sport == "nba":
        return f"{start_year}-{(start_year + 1) % 100:02d}"
    return str(start_year)


def parse_start_year(label) -> int:
    """Start year from any season label ('2026-27' -> 2026, '2026' -> 2026).
    The first four characters are the start year in every format we store."""
    return int(str(label)[:4])


def fallback_window(sport: str, start_year: int) -> tuple:
    """Approximate (start_date, end_date) for a season with no season_config
    row — historical seasons only. WNBA plays inside one calendar year; NBA
    runs Oct–Jun (June covers the Finals; harmless for WNBA-style bounds
    checks because no NBA games occur Jul–Sep)."""
    if sport == "nba":
        return (date(start_year, 10, 1), date(start_year + 1, 6, 30))
    return (date(start_year, 1, 1), date(start_year, 12, 31))


def experience_seasons(target_start_year: int, draft_year, history_seasons: int) -> int:
    """Career seasons entering the target season, for season_project's
    experience_curve. Prefers players.draft_year (true career length); falls
    back to the player's Franchise game-log history depth when unknown.

    Without this, history depth stood in for career length — and Franchise has
    only ONE season of NBA game logs, so the curve read every NBA player as a
    "1-2 seasons, still developing" +10% and the entire first NBA season
    snapshot projected above last year's averages (532/532 players, median
    ratio 1.104 — user-reported 2026-07-28).

    Clamped to the curve's validated plateau (5): the 6+ age-decline branches
    have never been calibrated — they were unreachable in the source engine
    too (its training window was also 5 seasons) — so a 20-year vet gets 1.00,
    not an untested −35%. Unclamping is a deliberate future calibration pass,
    not a data fix."""
    if draft_year is None:
        seasons = history_seasons
    else:
        # Drafted 2024 → entering 2026-27 they have 2 pro seasons behind them.
        seasons = target_start_year - int(draft_year)
    return min(max(seasons, 1), 5)


def resolve_windows(sport: str, start_years, config_rows) -> dict:
    """{start_year: (start_date, end_date)} for each requested season.

    `config_rows` is [(season_label, start_date, end_date), ...] from
    season_config for this sport. A season present there uses its real window
    (regular-season bounds — playoffs excluded); anything else falls back to
    the per-sport calendar window."""
    by_year = {}
    for label, start, end in config_rows:
        if start is not None and end is not None:
            by_year[parse_start_year(label)] = (start, end)
    return {y: by_year.get(y, fallback_window(sport, y)) for y in start_years}
