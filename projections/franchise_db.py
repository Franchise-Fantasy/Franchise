"""
Franchise Supabase data adapter for the projections engine.
========================================================================
Lets the pure model functions in `project.py` / `season_project.py` run
against the LIVE Franchise tables (player_games, game_schedule, players)
instead of the engine's own BDL-ingested schema. This is the "reuse
Franchise data — single source of truth" path: the app already syncs WNBA
box scores via poll-live-stats, so the engine never ingests BDL itself.

Key differences from the engine's native schema, handled here:
  - player_id is a Franchise UUID (text), not a BDL integer. The orchestrator
    (`franchise_project.py`) remaps UUIDs <-> integer indices so the engine's
    integer-keyed model functions can be reused unchanged.
  - seasons are keyed by INTEGER START YEAR (2026 = WNBA '2026' = NBA
    '2026-27') and games are matched by season_config date windows, not
    EXTRACT(YEAR FROM game_date) — see get_season_windows / season_windows.py
    (audit 2026-07-27: the year filter split NBA's Oct–Apr seasons in half).
    The app-facing label is only materialized at the write boundary
    (write_projections) via season_label().
  - Franchise box scores carry no per-game team / opponent / home flag, so
    the opponent-defense and home-court adjustments degrade to neutral. The
    b2b flag, recency weighting, minutes model and hierarchical Negative
    Binomial core all run on box scores alone.
  - injuries come from players.status ('OUT' / 'SUSP') rather than a separate
    injuries table; an unavailable player is dropped from the projection.

Output is written to the Franchise `player_projections` table (NOT the
engine's `projections` table). Fantasy points are intentionally NOT written:
they are league-specific and computed client-side in the app.

DORMANT loaders — `load_archetypes_by_season`, `load_box_scores`,
`compute_opp_factors`, `load_upcoming_context`, `load_vegas_props` — are no
longer on the active path. They fed the experimental hierarchical model
(`project.py`) and the Vegas-props blend (`franchise_props.py`). `next_game` now
uses `franchise_edge.py` (an exact port of the engine's production `edge.py`);
the `season` snapshot uses `fetch_player_seasons` / `fetch_active_players` /
`team_games_per_season`. The dormant loaders are kept for the documented
`project.py` "future swap-in" and are individually marked `# DORMANT` below.
"""
import os
from datetime import date

import numpy as np
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

from season_windows import fallback_window, parse_start_year, season_label

load_dotenv()
# .strip() — hand-pasted secrets (GitHub Actions secret box, .env.local) often
# carry a trailing newline; psycopg2 folds it into the last DSN value and fails
# (e.g. invalid sslmode value: "require\n").
PG_DSN = os.environ["PG_DSN"].strip()

# Bumped independently of the engine's MODEL_VERSION — this is the
# Franchise-data flavor of the model. POLICY (audit 2026-07-13): bump on ANY
# change that alters output values, so model eras stay segmentable in backtests.
# The ~+16% absence-bias era (2026-06-04..07-08) shipped unversioned and is only
# separable by projection_date; don't repeat that.
#   franchise-v1   — original edge.py port (+ absence freshness fade, 2026-07-08)
#   franchise-v1.1 — 2026-07-13: recent-minutes min>0 conditioning, minutes/stat
#                    level calibration, phantom gate, OUT-player zero-row
#                    retraction, stale-OUT guard
#   franchise-v1.2 — 2026-07-28: season_config date windows replace calendar-year
#                    bucketing (prior seasons now exclude playoff games); season
#                    horizon: in-progress-prior gp_pct uses completed-game
#                    denominators, per-sport GP constants (NBA enabled), and the
#                    experience curve keys on true career length (draft_year)
#                    instead of history depth — kills the uniform +10% that put
#                    every first-snapshot NBA projection above last year's line
#   franchise-v1.3 — 2026-08-01: season horizon only. (a) fg3a added to
#                    RATE_STATS — it was missing while franchise_edge (next_game)
#                    had it, so proj_3pa was NULL on all 13,803 season rows ever
#                    written and any league weighting 3PA lost the penalty
#                    entirely (Curry: 52.8 projected vs 41.5 actual fpts on an
#                    identical stat line); (b) small-sample shrinkage
#                    on per-36 rates + MPG (previously ONLY games-played was
#                    shrunk, so a 12-game cameo projected as a full-season role);
#                    (c) player_historical_stats now backfills seasons the game
#                    logs don't retain, which for NBA restores 2024-25 as a
#                    second prior — without it (b) alone buried injured stars
#                    (Tatum's 16-game year shrank him to 13.1 ppg)
#   franchise-v1.4 — 2026-08-02: season horizon only, both changes measured on a
#                    5-pair held-out backtest (WNBA 2022-2025 + NBA 2025-26; the
#                    audit lab's harness). (a) the experience curve is now
#                    sport-gated and OFF for WNBA — its only reachable branch is
#                    the +10% ≤2-seasons boost, which is NBA-shaped and cost
#                    WNBA per-game fantasy RMSE on 4/4 pairs (mean -0.175 when
#                    removed, paired Wilcoxon p=0.004); NBA keeps it (removing it
#                    there was worse, +0.127). (b) games played now regresses the
#                    player's recency-weighted GP% 50/50 toward the league mean
#                    instead of the three-component shrink+injury+trend model,
#                    which lost to that plain blend on season-TOTAL error — the
#                    draft board's view and the biggest term in it: totals
#                    improved on 5/5 pairs (WNBA -18.9, NBA -8.9) and total rank
#                    correlation on 5/5. Per-game output is unchanged by (b).
#                    (c) 2026-08-03: `lookback_seasons` moved into
#                    SPORT_SEASON_PARAMS — WNBA 5, NBA 2. Backfilling NBA
#                    2019-2024 game logs (backend/backfill_nba_game_logs.py)
#                    took NBA from 1 prior season to 5, which made the old
#                    blanket lookback of 5 LIVE for the first time — and
#                    measurement says deep history helps WNBA (-0.34 RMSE at
#                    depth 2, better on 3/3 test seasons) but hurts NBA (+0.17
#                    at depth 4). Capping NBA at 2 is worth -0.045/-0.130 RMSE
#                    and +0.020/+0.043 top-100 rank correlation vs leaving it
#                    at 5 on the two NBA test seasons that support the check.
#   franchise-v1.5 — 2026-08-03, NBA season horizon only (WNBA numerically
#                    unchanged). Three changes validated as a STACK on 5 native
#                    NBA backtest pairs (tuning on tests 2021-2023, holdout
#                    2024/2025 untouched; every component improved 5/5 pairs
#                    individually AND the stack measured holdout per-game
#                    chewers RMSE -0.312, pooled Wilcoxon p<1e-4 on both
#                    splits): (a) recency_decay 0.5 -> 0.3 — one-year-old NBA
#                    data over-describes a player's current role; (b) shrink
#                    ramps 0.40/0.25 -> 0.55/0.35 (thin samples shrink harder;
#                    the old constants were tuned on the then-only, now-tainted
#                    2024->2025 pair); (c) minutes_model.py — ridge over native
#                    season->season+1 transitions with depth-chart features
#                    (min_rank, team_min_share, usg_pct), blended 50/50 into
#                    engine minutes; rates untouched, only opportunity moves.
#                    Rejected on evidence in the same round (see
#                    SPORT_SEASON_PARAMS comment): Marcel ensemble, per-stat
#                    EB shrinkage, always-on residual regression, games-blend
#                    changes, usage as a direct rate feature.
#   franchise-v1.6 — 2026-08-03: rookie slot priors (rookie_priors.py), NBA
#                    season horizon. Incoming rookies — previously absent from
#                    the projection table entirely — are projected from their
#                    draft-slot bucket's median rookie line across our own
#                    2019+ classes (players.draft_number, seeded from BDL).
#                    Leave-future-out backtest: 5.1-6.5 MAE per class vs ~16
#                    for the old project-nothing behavior; within-class
#                    ordering is deliberately modest (slot can't see breakouts).
#                    Veteran rows are byte-identical to v1.5 — this only ADDS
#                    rows.
MODEL_VERSION = "franchise-v1.6"

# Per-36 rate stats projected by the season snapshot (mirrors
# season_project.RATE_STATS).
SEASON_RATE_STATS = ["pts", "reb", "ast", "stl", "blk", "tov",
                     "fg3m", "fg3a", "fgm", "fga", "ftm", "fta"]


def get_conn():
    return psycopg2.connect(PG_DSN)


# ================================================================
# Season windows (audit 2026-07-27)
# ================================================================
# The engine keys seasons by INTEGER START YEAR internally; games are matched
# to a season by date window, never by EXTRACT(YEAR FROM game_date) — that
# split NBA's Oct–Apr seasons across two calendar years. Windows come from
# season_config (regular-season bounds — also excludes playoff games, restoring
# the source engine's postseason filter), with a per-sport calendar fallback
# for historical seasons that predate season_config rows. See season_windows.py.

def get_season_windows(conn, sport: str, start_years: list) -> dict:
    """{start_year: (start_date, end_date)} for each requested season."""
    df = pd.read_sql(
        "SELECT season, start_date, end_date FROM season_config WHERE sport = %s",
        conn, params=(sport,))
    by_year = {}
    for _, r in df.iterrows():
        if r["start_date"] is not None and r["end_date"] is not None:
            by_year[parse_start_year(r["season"])] = (r["start_date"], r["end_date"])
    return {y: by_year.get(y, fallback_window(sport, y)) for y in start_years}


def _window_values_sql(windows: dict):
    """(sql_fragment, params) for a VALUES join mapping game_date -> season.
    Usage: JOIN (VALUES (%s,%s::date,%s::date), ...) sw(season, sd, ed)
             ON t.game_date BETWEEN sw.sd AND sw.ed"""
    frag = ", ".join(["(%s, %s::date, %s::date)"] * len(windows))
    params = []
    for year, (sd, ed) in sorted(windows.items()):
        params.extend([year, sd, ed])
    return frag, params


# ================================================================
# Loaders (shape matches what the engine model functions expect)
# ================================================================

# DORMANT — fed project.py's per-game-season archetype prior (see module header).
def load_archetypes_by_season(conn, sport: str) -> dict:
    """(player_id uuid str, season int) -> archetype, across all seasons. Mirrors
    the original engine's per-game-season archetype join (project.py:
    pa.season = g.season): each game uses its OWN season's stable role rather than
    a single current-season label, so a noisy in-progress season can't drag a
    player's prior. Written by franchise_archetype.py."""
    q = "SELECT player_id, season, archetype FROM player_archetypes WHERE sport = %s"
    df = pd.read_sql(q, conn, params=(sport,))
    return {(str(r["player_id"]), int(r["season"])): r["archetype"] for _, r in df.iterrows()}


# DORMANT — built project.py's hierarchical training set (see module header).
# NOTE: still calendar-year keyed (EXTRACT(YEAR)) — WRONG for NBA. If ever
# revived, port to get_season_windows first (audit 2026-07-27).
def load_box_scores(conn, sport: str, current_season: int,
                    lookback_seasons: int = 3) -> pd.DataFrame:
    """Per-game box scores for the last N seasons, shaped for `project.py`.

    Columns: player_id (uuid text), game_id, season (int), game_date,
    min_played, pts, reb, ast, stl, blk, tov, fg3m, fg3a, fgm, fga, ftm, fta,
    is_home, opp_team_id (opponent tricode).

    Per-game home/away and opponent ARE recoverable in Franchise: the
    player_games.matchup string ('vs XXX' = home, '@XXX' = away) is written
    immutably at game-final and survives trades, and game_schedule carries the
    two team tricodes. We derive is_home from the matchup prefix and opp_team by
    joining game_schedule on (game_id, sport) — never from players.pro_team
    (which is mutated to the player's CURRENT team and is wrong for past games).
    archetype is the player's role tier for each game's own season (see
    load_archetypes_by_season; written by franchise_archetype.py).
    """
    first = current_season - lookback_seasons + 1
    # NB: '%%' escapes the literal % for psycopg2's paramstyle.
    q = """
        SELECT pg.player_id,
               pg.game_id,
               EXTRACT(YEAR FROM pg.game_date)::int        AS season,
               pg.game_date,
               pg.min::float                               AS min_played,
               COALESCE(pg.pts,  0)::int                   AS pts,
               COALESCE(pg.reb,  0)::int                   AS reb,
               COALESCE(pg.ast,  0)::int                   AS ast,
               COALESCE(pg.stl,  0)::int                   AS stl,
               COALESCE(pg.blk,  0)::int                   AS blk,
               COALESCE(pg.tov,  0)::int                   AS tov,
               COALESCE(pg."3pm", 0)::int                  AS fg3m,
               COALESCE(pg."3pa", 0)::int                  AS fg3a,
               COALESCE(pg.fgm,  0)::int                   AS fgm,
               COALESCE(pg.fga,  0)::int                   AS fga,
               COALESCE(pg.ftm,  0)::int                   AS ftm,
               COALESCE(pg.fta,  0)::int                   AS fta,
               CASE WHEN pg.matchup LIKE 'vs%%' THEN 1 ELSE 0 END AS is_home,
               CASE WHEN pg.matchup LIKE 'vs%%' THEN gs.away_team
                    ELSE gs.home_team END                  AS opp_team_id
        FROM player_games pg
        LEFT JOIN game_schedule gs
          ON gs.game_id = pg.game_id AND gs.sport = pg.sport
        WHERE pg.sport = %s
          AND pg.min IS NOT NULL
          AND pg.min > 0
          AND EXTRACT(YEAR FROM pg.game_date) BETWEEN %s AND %s
        ORDER BY pg.player_id, pg.game_date
    """
    df = pd.read_sql(q, conn, params=(sport, first, current_season))
    df["game_date"] = pd.to_datetime(df["game_date"])
    # Archetype per (player, game-season) — mirrors the original per-game-season
    # join, so a player's prior reflects their stable historical role rather than
    # a noisy in-progress-season label. Unclustered (player, season) pairs fall
    # back to "unclassified"; the model takes each player's MODE archetype across
    # their games, which an established player's prior seasons dominate.
    arch = load_archetypes_by_season(conn, sport)
    df["archetype"] = df.apply(
        lambda r: arch.get((str(r["player_id"]), int(r["season"])), "unclassified"),
        axis=1,
    )
    df["is_home"] = df["is_home"].astype(float)
    return df


# Counting stats the opponent-defense factor is computed for (matches
# project.py COUNT_STATS).
_OPP_COUNT_STATS = ["pts", "reb", "ast", "stl", "blk", "tov", "fg3m"]


# DORMANT — opponent-defense de-bias for project.py (see module header).
# NOTE: still calendar-year keyed (EXTRACT(YEAR)) — WRONG for NBA. If ever
# revived, port to get_season_windows first (audit 2026-07-27).
def compute_opp_factors(conn, sport: str, seasons: list) -> dict:
    """{(opponent_tricode, season): {stat: factor}} where factor > 1 means that
    team allows more than league-average of `stat` (an easier matchup) and 1.0
    is league-average defense.

    Franchise has no team box-score table, so 'stats allowed by team X' is
    reconstructed by summing the box scores of the players who FACED X each game
    (opponent derived from the immutable matchup prefix + game_schedule), then
    averaging per game and normalizing by the league average for that season.
    Mirrors project.py.compute_opp_factors but keyed by tricode, not an integer
    team_id. Used to de-bias each training observation for schedule strength.
    """
    q = """
        WITH derived AS (
            SELECT EXTRACT(YEAR FROM pg.game_date)::int AS season,
                   pg.game_id,
                   CASE WHEN pg.matchup LIKE 'vs%%' THEN gs.away_team
                        ELSE gs.home_team END            AS opp_team,
                   COALESCE(pg.pts,  0) AS pts, COALESCE(pg.reb,  0) AS reb,
                   COALESCE(pg.ast,  0) AS ast, COALESCE(pg.stl,  0) AS stl,
                   COALESCE(pg.blk,  0) AS blk, COALESCE(pg.tov,  0) AS tov,
                   COALESCE(pg."3pm", 0) AS fg3m
            FROM player_games pg
            JOIN game_schedule gs
              ON gs.game_id = pg.game_id AND gs.sport = pg.sport
            WHERE pg.sport = %s
              AND EXTRACT(YEAR FROM pg.game_date) = ANY(%s)
              AND pg.min > 0
              AND pg.matchup IS NOT NULL
        ),
        per_game AS (
            SELECT opp_team, season, game_id,
                   SUM(pts) AS pts, SUM(reb) AS reb, SUM(ast) AS ast,
                   SUM(stl) AS stl, SUM(blk) AS blk, SUM(tov) AS tov,
                   SUM(fg3m) AS fg3m
            FROM derived
            WHERE opp_team IS NOT NULL
            GROUP BY opp_team, season, game_id
        )
        SELECT opp_team AS team, season,
               AVG(pts) AS avg_pts, AVG(reb) AS avg_reb, AVG(ast) AS avg_ast,
               AVG(stl) AS avg_stl, AVG(blk) AS avg_blk, AVG(tov) AS avg_tov,
               AVG(fg3m) AS avg_fg3m
        FROM per_game
        GROUP BY opp_team, season
    """
    df = pd.read_sql(q, conn, params=(sport, list(seasons)))
    if df.empty:
        return {}
    factors: dict = {}
    for season in df["season"].unique():
        sdf = df[df["season"] == season]
        league = {s: sdf[f"avg_{s}"].mean() for s in _OPP_COUNT_STATS}
        for _, row in sdf.iterrows():
            f = {}
            for s in _OPP_COUNT_STATS:
                lv = league[s]
                f[s] = float(row[f"avg_{s}"] / lv) if lv and lv > 0 else 1.0
            factors[(row["team"], int(season))] = f
    return factors


def get_unavailable_players(conn, sport: str) -> dict:
    """player_id (uuid) -> 'Out' for players currently OUT/SUSP.

    Returns the engine's "Out" status string so `estimate_projected_minutes`
    drops them. (Franchise doesn't track a distinct 'Day-To-Day' status.)

    Stale-OUT guard (audit 2026-07-13): a player who logged real minutes on/after
    their team's most recent completed game-day is playing, whatever the status
    column says — a stale OUT flag would both drop them from the board AND
    redistribute their full minutes to teammates at freshness weight 1.0, the
    exact double-count the absence fade exists to prevent (2 of 38 OUT-flagged
    players were in this state on 2026-07-12). Teamless OUT players stay flagged
    (conservative: they can't poison redistribution — load_player_meta skips
    NULL pro_team — and shouldn't be on the board).
    """
    q = """
        SELECT p.id, p.status
        FROM players p
        WHERE p.sport = %s
          AND p.status IN ('OUT', 'SUSP')
          AND NOT (
              p.pro_team IS NOT NULL
              AND EXISTS (
                  SELECT 1 FROM player_games pg
                  WHERE pg.player_id = p.id
                    AND pg.sport = p.sport
                    AND pg.min > 0
                    AND pg.game_date >= (
                        SELECT MAX(gs.game_date) FROM game_schedule gs
                        WHERE gs.sport = p.sport
                          AND gs.game_date < CURRENT_DATE
                          AND (gs.home_team = p.pro_team
                               OR gs.away_team = p.pro_team))
              )
          )
    """
    df = pd.read_sql(q, conn, params=(sport,))
    return {str(r["id"]): "Out" for _, r in df.iterrows()}


def get_team_games_played(conn, sport: str, window: tuple) -> dict:
    """tricode -> completed games in the season `window` (start_date, end_date).
    Feeds franchise_edge.is_phantom. Deliberately not score-based: WNBA schedule
    scores don't persist (audit 2026-07-13 — only the latest day's games carry
    them), so `game_date < CURRENT_DATE` is the reliable completed-game test.
    DISTINCT game_date for the same reason as team_games_per_season: duplicate
    schedule rows (two id-namespace sync passes over 2025-26) double-counted
    every team's games, and here that inflates the phantom gate's denominator."""
    sd, ed = window
    q = """
        SELECT team, COUNT(DISTINCT game_date) AS games FROM (
            SELECT home_team AS team, game_date FROM game_schedule
            WHERE sport = %s AND game_date BETWEEN %s AND %s
              AND game_date < CURRENT_DATE
            UNION ALL
            SELECT away_team, game_date FROM game_schedule
            WHERE sport = %s AND game_date BETWEEN %s AND %s
              AND game_date < CURRENT_DATE
        ) t GROUP BY team
    """
    df = pd.read_sql(q, conn, params=(sport, sd, ed, sport, sd, ed))
    return {r["team"]: int(r["games"]) for _, r in df.iterrows()}


def get_absence_games_missed(conn, sport: str) -> dict:
    """player_id (uuid str) -> number of team games already played since each
    OUT/SUSP player last appeared. Feeds franchise_edge.absence_freshness_weight
    so a long-absent teammate — whose lost minutes the active players' recent
    baseline has already absorbed — isn't re-credited and double-count-inflates
    every teammate's projection. A player with no game this season returns a large
    count (→ zero weight). 'Team' is the live pro_team, matching load_player_meta
    (absences are evaluated as of now). The 5-minute floor mirrors
    franchise_edge.MIN_MINUTES (_season_distributions' "meaningful appearance"
    threshold) so a 2-minute cameo doesn't reset an absence."""
    q = """
        WITH outp AS (
            SELECT id, pro_team FROM players
            WHERE sport = %s AND status IN ('OUT', 'SUSP') AND pro_team IS NOT NULL
        ),
        last_app AS (
            SELECT o.id, o.pro_team,
                   (SELECT MAX(pg.game_date) FROM player_games pg
                    WHERE pg.player_id = o.id AND pg.sport = %s AND pg.min >= 5) AS last_game
            FROM outp o
        )
        SELECT la.id,
               CASE WHEN la.last_game IS NULL THEN 999
                    ELSE (SELECT COUNT(DISTINCT tg.game_date)
                          FROM player_games tg
                          JOIN players tp ON tp.id = tg.player_id
                          WHERE tp.pro_team = la.pro_team AND tg.sport = %s
                            AND tg.min >= 5 AND tg.game_date > la.last_game)
               END AS games_missed
        FROM last_app la
    """
    df = pd.read_sql(q, conn, params=(sport, sport, sport))
    return {str(r["id"]): int(r["games_missed"]) for _, r in df.iterrows()}


def load_player_meta(conn, sport: str):
    """(player_teams, player_names): uuid str -> pro_team, uuid str -> name.
    Used by the absence-boost redistribution. pro_team is the LIVE roster team —
    correct here because absences are evaluated as of now (unlike historical
    box-score opponents, which must come from the immutable matchup)."""
    df = pd.read_sql("SELECT id, pro_team, name FROM players WHERE sport = %s",
                     conn, params=(sport,))
    teams = {str(r["id"]): r["pro_team"] for _, r in df.iterrows() if r["pro_team"]}
    names = {str(r["id"]): r["name"] for _, r in df.iterrows()}
    return teams, names


# DORMANT — next-opponent/venue/b2b tilt for project.py (see module header).
def load_upcoming_context(conn, sport: str) -> dict:
    """player_id (uuid str) -> {opp_team_id (tricode), is_home, is_b2b} for each
    player's NEXT unplayed game.

    Current team is derived from the player's most recent game (matchup prefix +
    game_schedule), never the mutable players.pro_team. Powers the game-by-game
    (next_game) horizon: each player is projected against their actual next
    opponent + venue + rest rather than a neutral average game.
    """
    team_df = pd.read_sql("""
        SELECT DISTINCT ON (pg.player_id) pg.player_id,
               CASE WHEN pg.matchup LIKE 'vs%%' THEN gs.home_team ELSE gs.away_team END AS team
        FROM player_games pg
        JOIN game_schedule gs ON gs.game_id = pg.game_id AND gs.sport = pg.sport
        WHERE pg.sport = %s
        ORDER BY pg.player_id, pg.game_date DESC
    """, conn, params=(sport,))
    player_team = {str(r["player_id"]): r["team"] for _, r in team_df.iterrows()}

    # Next unplayed game per team (no score yet = not played), earliest first.
    games_df = pd.read_sql("""
        SELECT game_date, home_team, away_team
        FROM game_schedule
        WHERE sport = %s AND game_date >= CURRENT_DATE
          AND (home_score IS NULL OR away_score IS NULL)
        ORDER BY game_date
    """, conn, params=(sport,))

    # Teams that played yesterday → on a back-to-back for their next game.
    yest_df = pd.read_sql("""
        SELECT home_team AS team FROM game_schedule
        WHERE sport = %s AND game_date = CURRENT_DATE - 1
        UNION
        SELECT away_team FROM game_schedule
        WHERE sport = %s AND game_date = CURRENT_DATE - 1
    """, conn, params=(sport, sport))
    played_yesterday = {r["team"] for _, r in yest_df.iterrows()}

    team_next: dict = {}
    for _, g in games_df.iterrows():
        for team, is_home in ((g["home_team"], 1), (g["away_team"], 0)):
            if team not in team_next:
                team_next[team] = {
                    "opp_team_id": g["away_team"] if is_home else g["home_team"],
                    "is_home": is_home,
                    "is_b2b": 1 if team in played_yesterday else 0,
                }

    return {pid: team_next[t] for pid, t in player_team.items() if t in team_next}


# DORMANT — Vegas-props blend, franchise_props.py path (see module header).
def load_vegas_props(conn, sport: str) -> dict:
    """player_id (uuid str) -> {stat: median line} for each player's NEXT game
    with posted props (pts/reb/ast/3pm). Powers the next_game market blend —
    written by franchise_props.py from BDL's odds endpoint."""
    df = pd.read_sql("""
        SELECT player_id, game_date, stat, line_value
        FROM player_props
        WHERE sport = %s AND game_date >= CURRENT_DATE
        ORDER BY player_id, game_date
    """, conn, params=(sport,))
    out: dict = {}
    for pid, grp in df.groupby("player_id"):
        nearest = grp["game_date"].min()
        lines = grp[grp["game_date"] == nearest]
        out[str(pid)] = {r["stat"]: float(r["line_value"]) for _, r in lines.iterrows()}
    return out


def fetch_player_seasons(conn, sport: str, windows: dict) -> pd.DataFrame:
    """Per-player per-season per-36 aggregates for the season snapshot.

    Mirrors season_project.fetch_player_seasons but reads Franchise
    player_games. `windows` is {start_year: (start_date, end_date)} from
    get_season_windows; each game is bucketed into the window it falls in.
    Returns one row per (player_id, season) with games_played, mpg and
    <stat>_per36 columns for SEASON_RATE_STATS.
    """
    frag, wparams = _window_values_sql(windows)
    q = f"""
        WITH filtered AS (
            SELECT pg.player_id,
                   sw.season,
                   pg.game_id,
                   pg.min::float                          AS min_played,
                   COALESCE(pg.pts,  0)::float            AS pts,
                   COALESCE(pg.reb,  0)::float            AS reb,
                   COALESCE(pg.ast,  0)::float            AS ast,
                   COALESCE(pg.stl,  0)::float            AS stl,
                   COALESCE(pg.blk,  0)::float            AS blk,
                   COALESCE(pg.tov,  0)::float            AS tov,
                   COALESCE(pg."3pm", 0)::float           AS fg3m,
                   COALESCE(pg."3pa", 0)::float           AS fg3a,
                   COALESCE(pg.fgm,  0)::float            AS fgm,
                   COALESCE(pg.fga,  0)::float            AS fga,
                   COALESCE(pg.ftm,  0)::float            AS ftm,
                   COALESCE(pg.fta,  0)::float            AS fta
            FROM player_games pg
            JOIN (VALUES {frag}) AS sw(season, sd, ed)
              ON pg.game_date BETWEEN sw.sd AND sw.ed
            WHERE pg.sport = %s
              AND pg.min >= %s
        )
        SELECT player_id, season,
               COUNT(DISTINCT game_id)                       AS games_played,
               SUM(min_played) / COUNT(DISTINCT game_id)     AS mpg,
               SUM(pts)  / NULLIF(SUM(min_played), 0) * 36   AS pts_per36,
               SUM(reb)  / NULLIF(SUM(min_played), 0) * 36   AS reb_per36,
               SUM(ast)  / NULLIF(SUM(min_played), 0) * 36   AS ast_per36,
               SUM(stl)  / NULLIF(SUM(min_played), 0) * 36   AS stl_per36,
               SUM(blk)  / NULLIF(SUM(min_played), 0) * 36   AS blk_per36,
               SUM(tov)  / NULLIF(SUM(min_played), 0) * 36   AS tov_per36,
               SUM(fg3m) / NULLIF(SUM(min_played), 0) * 36   AS fg3m_per36,
               SUM(fg3a) / NULLIF(SUM(min_played), 0) * 36   AS fg3a_per36,
               SUM(fgm)  / NULLIF(SUM(min_played), 0) * 36   AS fgm_per36,
               SUM(fga)  / NULLIF(SUM(min_played), 0) * 36   AS fga_per36,
               SUM(ftm)  / NULLIF(SUM(min_played), 0) * 36   AS ftm_per36,
               SUM(fta)  / NULLIF(SUM(min_played), 0) * 36   AS fta_per36
        FROM filtered
        GROUP BY player_id, season
        HAVING COUNT(DISTINCT game_id) >= %s
        ORDER BY player_id, season
    """
    min_minutes, min_games = 3.0, 5
    logs = pd.read_sql(q, conn, params=(*wparams, sport, min_minutes, min_games))

    # Fill seasons the game logs don't cover from player_historical_stats.
    # player_games retention is one season for NBA, but player_historical_stats
    # keeps 2024-25 — without this the season model sees a single prior year and
    # treats a returning starter's thin current sample as if he had no career
    # (33 of the 114 thin-sample 2026-27 candidates have a 40+ game 2024-25).
    # Game logs win wherever both exist (WNBA has logs for every prior season,
    # so this path is NBA-only today).
    hist = fetch_historical_season_rates(conn, sport, list(windows), min_games)
    if hist.empty:
        return logs
    covered = set(zip(logs["player_id"], logs["season"])) if not logs.empty else set()
    gap = hist[[(p, s) not in covered
                for p, s in zip(hist["player_id"], hist["season"])]]
    if gap.empty:
        return logs
    return pd.concat([logs, gap], ignore_index=True).sort_values(
        ["player_id", "season"]).reset_index(drop=True)


def fetch_historical_season_rates(conn, sport: str, start_years: list,
                                  min_games: int = 5) -> pd.DataFrame:
    """Season aggregates from player_historical_stats, in fetch_player_seasons'
    shape (player_id, season, games_played, mpg, <stat>_per36).

    Two deliberate approximations vs the game-log path, both acceptable because
    this only ever supplies a recency-DOWNWEIGHTED prior season:
      - per-36 rates are derived from 1-dp per-game averages (avg_x / avg_min ×
        36), so low-volume stats (blk, stl) carry a few percent of rounding
        noise that the raw-minute path doesn't have;
      - the per-game `min >= 3` garbage-time filter can't be applied to an
        already-aggregated row, so a player's DNP-adjacent cameos are included
        in their average where the log path would drop them.
    """
    labels = [season_label(sport, y) for y in start_years]
    q = """
        SELECT player_id, season, games_played,
               avg_min AS mpg,
               avg_pts  / NULLIF(avg_min, 0) * 36 AS pts_per36,
               avg_reb  / NULLIF(avg_min, 0) * 36 AS reb_per36,
               avg_ast  / NULLIF(avg_min, 0) * 36 AS ast_per36,
               avg_stl  / NULLIF(avg_min, 0) * 36 AS stl_per36,
               avg_blk  / NULLIF(avg_min, 0) * 36 AS blk_per36,
               avg_tov  / NULLIF(avg_min, 0) * 36 AS tov_per36,
               avg_3pm  / NULLIF(avg_min, 0) * 36 AS fg3m_per36,
               avg_3pa  / NULLIF(avg_min, 0) * 36 AS fg3a_per36,
               avg_fgm  / NULLIF(avg_min, 0) * 36 AS fgm_per36,
               avg_fga  / NULLIF(avg_min, 0) * 36 AS fga_per36,
               avg_ftm  / NULLIF(avg_min, 0) * 36 AS ftm_per36,
               avg_fta  / NULLIF(avg_min, 0) * 36 AS fta_per36
        FROM player_historical_stats
        WHERE sport = %s AND season = ANY(%s)
          AND games_played >= %s AND avg_min > 0
    """
    df = pd.read_sql(q, conn, params=(sport, labels, min_games))
    if df.empty:
        return df
    # Back to the engine's integer start-year key.
    df["season"] = df["season"].map(parse_start_year)
    df["player_id"] = df["player_id"].astype(str)
    for col in df.columns:
        if col not in ("player_id", "season"):
            df[col] = pd.to_numeric(df[col], errors="coerce").astype(float)
    return df


def fetch_minutes_frame(conn, sport: str, first_season: int,
                        last_season: int) -> pd.DataFrame:
    """Per-player-season rows for the minutes model (minutes_model.py):
    modal own team, mpg, games, the per-36 rates its features need, plus each
    (team, season)'s minute/possession totals merged on (tmin/tfga/tfta/ttov).

    Seasons are keyed by game_schedule.season LABELS (parsed to start-year
    ints), NOT date windows — the 2019-20 bubble restart falls outside every
    calendar window, and the backfill wrote schedule rows for all historical
    games, so the label join is both simpler and more complete here. Own team
    comes from the immutable matchup prefix + the game's two tricodes (never
    players.pro_team, which is mutated to the current team).
    """
    labels = [season_label(sport, y) for y in range(first_season, last_season + 1)]
    q = """
        WITH own AS (
            SELECT pg.player_id,
                   gs.season                             AS season_label,
                   pg.game_id,
                   pg.min::float                         AS m,
                   CASE WHEN pg.matchup LIKE 'vs%%' THEN gs.home_team
                        ELSE gs.away_team END            AS team,
                   COALESCE(pg.pts, 0)::float            AS pts,
                   COALESCE(pg.reb, 0)::float            AS reb,
                   COALESCE(pg.ast, 0)::float            AS ast,
                   COALESCE(pg.stl, 0)::float            AS stl,
                   COALESCE(pg.blk, 0)::float            AS blk,
                   COALESCE(pg.tov, 0)::float            AS tov,
                   COALESCE(pg."3pm", 0)::float          AS fg3m,
                   COALESCE(pg."3pa", 0)::float          AS fg3a,
                   COALESCE(pg.fgm, 0)::float            AS fgm,
                   COALESCE(pg.fga, 0)::float            AS fga,
                   COALESCE(pg.ftm, 0)::float            AS ftm,
                   COALESCE(pg.fta, 0)::float            AS fta
            FROM player_games pg
            JOIN game_schedule gs
              ON gs.game_id = pg.game_id AND gs.sport = pg.sport
            WHERE pg.sport = %s AND pg.min >= 3 AND gs.season = ANY(%s)
        ),
        per_player AS (
            SELECT player_id, season_label,
                   COUNT(DISTINCT game_id)                     AS games_played,
                   MODE() WITHIN GROUP (ORDER BY team)         AS team,
                   SUM(m) / COUNT(DISTINCT game_id)            AS mpg,
                   SUM(pts) / NULLIF(SUM(m), 0) * 36           AS pts_per36,
                   SUM(reb) / NULLIF(SUM(m), 0) * 36           AS reb_per36,
                   SUM(ast) / NULLIF(SUM(m), 0) * 36           AS ast_per36,
                   SUM(stl) / NULLIF(SUM(m), 0) * 36           AS stl_per36,
                   SUM(blk) / NULLIF(SUM(m), 0) * 36           AS blk_per36,
                   SUM(tov) / NULLIF(SUM(m), 0) * 36           AS tov_per36,
                   SUM(fg3m) / NULLIF(SUM(m), 0) * 36          AS fg3m_per36,
                   SUM(fg3a) / NULLIF(SUM(m), 0) * 36          AS fg3a_per36,
                   SUM(fgm) / NULLIF(SUM(m), 0) * 36           AS fgm_per36,
                   SUM(fga) / NULLIF(SUM(m), 0) * 36           AS fga_per36,
                   SUM(ftm) / NULLIF(SUM(m), 0) * 36           AS ftm_per36,
                   SUM(fta) / NULLIF(SUM(m), 0) * 36           AS fta_per36
            FROM own GROUP BY 1, 2
            HAVING COUNT(DISTINCT game_id) >= 5 AND SUM(m) > 0
        ),
        per_team AS (
            SELECT team, season_label,
                   SUM(m) AS tmin, SUM(fga) AS tfga,
                   SUM(fta) AS tfta, SUM(tov) AS ttov
            FROM own WHERE team IS NOT NULL GROUP BY 1, 2
        )
        SELECT pp.*, pt.tmin, pt.tfga, pt.tfta, pt.ttov
        FROM per_player pp
        LEFT JOIN per_team pt
          ON pt.team = pp.team AND pt.season_label = pp.season_label
    """
    df = pd.read_sql(q, conn, params=(sport, labels))
    if df.empty:
        return df
    df["season"] = df["season_label"].map(parse_start_year)
    df = df.drop(columns=["season_label"])
    df["player_id"] = df["player_id"].astype(str)
    for col in df.columns:
        if col not in ("player_id", "team", "season"):
            df[col] = pd.to_numeric(df[col], errors="coerce").astype(float)
    return df


def get_birth_years(conn, sport: str) -> dict:
    """player_id (uuid str) -> birth YEAR, for players with a birthdate.
    Age feature for the minutes model (draft_year+22 is the fallback)."""
    df = pd.read_sql(
        "SELECT id, EXTRACT(YEAR FROM birthdate)::int AS by FROM players "
        "WHERE sport = %s AND birthdate IS NOT NULL",
        conn, params=(sport,))
    return {str(r["id"]): int(r["by"]) for _, r in df.iterrows()}


def get_draft_slots(conn, sport: str) -> dict:
    """player_id (uuid str) -> overall draft pick, where known. Feeds the
    rookie slot-prior buckets; NULL (absent) means undrafted-or-unseeded."""
    df = pd.read_sql(
        "SELECT id, draft_number FROM players "
        "WHERE sport = %s AND draft_number IS NOT NULL",
        conn, params=(sport,))
    return {str(r["id"]): int(r["draft_number"]) for _, r in df.iterrows()}


def get_rookie_candidates(conn, sport: str, target_season: int) -> pd.DataFrame:
    """Incoming rookies for the target season: draft_year == target season's
    start year AND signed to a real roster — being rostered is what makes the
    slot prior's appearance base rate applicable; a drafted player who never
    signs stays unprojected.

    "Signed" = pro_team set AND external_id_bdl set (present on BDL's active
    roster list, which is what stamps both via sync-players). Deliberately NOT
    gated on is_prospect/status='prospect': the Contentful prospect pipeline
    creates the class's rows pre-draft with is_prospect=true and nothing
    graduates the flag when they sign — 63 of the 65 signed 2026 rookies still
    carried it on ship day. The app's own prospect surfaces learned the same
    lesson (see useProspects.ts: keying on the flag "silently dropped the
    playerId" for drafted players); the flag means "in the prospect news
    pool", not "not yet a pro". Returns id, draft_number, name."""
    q = """
        SELECT id AS player_id, draft_number, name
        FROM players
        WHERE sport = %s
          AND draft_year = %s
          AND pro_team IS NOT NULL
          AND external_id_bdl IS NOT NULL
    """
    df = pd.read_sql(q, conn, params=(sport, target_season))
    df["player_id"] = df["player_id"].astype(str)
    return df


def get_draft_years(conn, sport: str) -> dict:
    """player_id (uuid str) -> draft_year, for players where it's known.
    Feeds season_windows.experience_seasons: true career length for the season
    snapshot's experience curve, instead of Franchise game-log depth (which is
    capped by our own data retention — one season for NBA — and misread every
    veteran as a still-developing sophomore)."""
    df = pd.read_sql(
        "SELECT id, draft_year FROM players WHERE sport = %s AND draft_year IS NOT NULL",
        conn, params=(sport,))
    return {str(r["id"]): int(r["draft_year"]) for _, r in df.iterrows()}


def fetch_active_players(conn, sport: str, window: tuple) -> list:
    """Players who saw meaningful minutes in the season `window` — the
    snapshot's projection candidates."""
    sd, ed = window
    q = """
        SELECT DISTINCT player_id
        FROM player_games
        WHERE sport = %s
          AND game_date BETWEEN %s AND %s
          AND min >= %s
    """
    df = pd.read_sql(q, conn, params=(sport, sd, ed, 3.0))
    return df["player_id"].tolist()


def team_games_per_season(conn, sport: str, windows: dict,
                          completed_before: date = None) -> dict:
    """{start_year: max games any single team is scheduled for} — replaces the
    engine's hardcoded MAX_TEAM_GAMES, derived live from game_schedule.

    `completed_before` (usually date.today()) additionally restricts to games
    already played — the denominator an IN-PROGRESS season's gp_pct needs.
    Feeding the full scheduled count for a season that's only part-played made
    every player look injured (gp_pct ≈ fraction-of-season-elapsed) and
    systematically deflated projected_games (audit 2026-07-27)."""
    frag, wparams = _window_values_sql(windows)
    completed = "AND a.game_date < %s" if completed_before is not None else ""
    q = f"""
        WITH appearances AS (
            SELECT game_date, home_team AS team
            FROM game_schedule WHERE sport = %s
            UNION ALL
            SELECT game_date, away_team AS team
            FROM game_schedule WHERE sport = %s
        ),
        per_team AS (
            -- DISTINCT game_date, not COUNT(*): game_schedule holds the same
            -- real game under TWO id namespaces for stretches of 2025-26 (an
            -- NBA.com-id sync pass 2026-02-22 and a BDL-id pass 2026-04-28,
            -- 1,232 duplicated games), and both copies are load-bearing for
            -- player_games joins so they can't simply be deleted. A team
            -- plays at most one game per date, so date-counting is immune —
            -- COUNT(*) made every 2025-26 team look like it played ~166 games,
            -- which became PROJECT_GAMES for the 2026-27 snapshot (no target
            -- schedule yet -> recent-season fallback) and shipped players
            -- projected for 98-109 games (2026-08-03).
            SELECT sw.season, a.team, COUNT(DISTINCT a.game_date) AS games
            FROM appearances a
            JOIN (VALUES {frag}) AS sw(season, sd, ed)
              ON a.game_date BETWEEN sw.sd AND sw.ed
            WHERE TRUE {completed}
            GROUP BY sw.season, a.team
        )
        SELECT season, MAX(games) AS team_games
        FROM per_team GROUP BY season
    """
    params = [sport, sport, *wparams]
    if completed_before is not None:
        params.append(completed_before)
    df = pd.read_sql(q, conn, params=params)
    return {int(r["season"]): int(r["team_games"]) for _, r in df.iterrows()}


# ================================================================
# Writer (Franchise player_projections table)
# ================================================================

def _f(row, key):
    """Float or None for an optional projected column."""
    v = row.get(key)
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return None
    return float(v)


def write_projections(conn, df: pd.DataFrame, sport: str, season: int,
                      horizon: str, model_version: str = MODEL_VERSION) -> int:
    """Upsert one projection row per player into Franchise player_projections.

    `df` rows must carry a Franchise UUID `player_id` plus whatever proj_*
    columns the horizon produced (missing columns become NULL via _f). Maps
    the engine's `proj_fg3m` -> `proj_3pm`. Does NOT write fantasy points.

    `season` is the engine's integer start year; the ROW stores the sport's
    canonical label (season_label: '2026-27' for NBA, '2026' for WNBA) because
    the app pins `.eq('season', getCurrentSeason(sport))` — a bare-int label
    for NBA would make every row invisible (audit 2026-07-27). The label is
    part of the upsert conflict key, so it must never change format again.
    """
    today = date.today()
    label = season_label(sport, int(season))
    rows = []
    for _, r in df.iterrows():
        pid = r["player_id"]
        if pid is None:
            continue
        fgm, fga = _f(r, "proj_fgm"), _f(r, "proj_fga")
        ftm, fta = _f(r, "proj_ftm"), _f(r, "proj_fta")
        fg_pct = round(fgm / fga, 3) if fgm is not None and fga else None
        ft_pct = round(ftm / fta, 3) if ftm is not None and fta else None
        rows.append((
            str(pid), sport, label, horizon, today,
            _f(r, "proj_min"), _f(r, "proj_pts"), _f(r, "proj_reb"),
            _f(r, "proj_ast"), _f(r, "proj_stl"), _f(r, "proj_blk"),
            _f(r, "proj_tov"), _f(r, "proj_fg3m"), _f(r, "proj_fg3a"),
            fgm, fga, ftm, fta, fg_pct, ft_pct,
            _f(r, "sd_pts"), _f(r, "sd_reb"), _f(r, "sd_ast"), _f(r, "sd_fantasy_pg"),
            _f(r, "games_remaining"), _f(r, "projected_games"),
            model_version,
        ))
    if not rows:
        return 0
    with conn.cursor() as cur:
        execute_values(cur, """
            INSERT INTO player_projections (
                player_id, sport, season, horizon, projection_date,
                proj_min, proj_pts, proj_reb, proj_ast, proj_stl, proj_blk,
                proj_tov, proj_3pm, proj_3pa, proj_fgm, proj_fga, proj_ftm,
                proj_fta, proj_fg_pct, proj_ft_pct,
                sd_pts, sd_reb, sd_ast, sd_fantasy_pg,
                games_remaining, projected_games, model_version
            ) VALUES %s
            ON CONFLICT (player_id, sport, season, horizon, projection_date)
            DO UPDATE SET
                proj_min        = EXCLUDED.proj_min,
                proj_pts        = EXCLUDED.proj_pts,
                proj_reb        = EXCLUDED.proj_reb,
                proj_ast        = EXCLUDED.proj_ast,
                proj_stl        = EXCLUDED.proj_stl,
                proj_blk        = EXCLUDED.proj_blk,
                proj_tov        = EXCLUDED.proj_tov,
                proj_3pm        = EXCLUDED.proj_3pm,
                proj_3pa        = EXCLUDED.proj_3pa,
                proj_fgm        = EXCLUDED.proj_fgm,
                proj_fga        = EXCLUDED.proj_fga,
                proj_ftm        = EXCLUDED.proj_ftm,
                proj_fta        = EXCLUDED.proj_fta,
                proj_fg_pct     = EXCLUDED.proj_fg_pct,
                proj_ft_pct     = EXCLUDED.proj_ft_pct,
                sd_pts          = EXCLUDED.sd_pts,
                sd_reb          = EXCLUDED.sd_reb,
                sd_ast          = EXCLUDED.sd_ast,
                sd_fantasy_pg   = EXCLUDED.sd_fantasy_pg,
                games_remaining = EXCLUDED.games_remaining,
                projected_games = EXCLUDED.projected_games,
                model_version   = EXCLUDED.model_version,
                updated_at      = now()
        """, rows)
    conn.commit()
    return len(rows)