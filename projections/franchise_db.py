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
  - season is derived from EXTRACT(YEAR FROM game_date); WNBA seasons are
    single calendar years (2024, 2025, 2026 ...).
  - Franchise box scores carry no per-game team / opponent / home flag, so
    the opponent-defense and home-court adjustments degrade to neutral. The
    b2b flag, recency weighting, minutes model and hierarchical Negative
    Binomial core all run on box scores alone.
  - injuries come from players.status ('OUT' / 'SUSP') rather than a separate
    injuries table; an unavailable player is dropped from the projection.

Output is written to the Franchise `player_projections` table (NOT the
engine's `projections` table). Fantasy points are intentionally NOT written:
they are league-specific and computed client-side in the app.
"""
import os
from datetime import date

import numpy as np
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

load_dotenv()
# .strip() — hand-pasted secrets (GitHub Actions secret box, .env.local) often
# carry a trailing newline; psycopg2 folds it into the last DSN value and fails
# (e.g. invalid sslmode value: "require\n").
PG_DSN = os.environ["PG_DSN"].strip()

# Bumped independently of the engine's MODEL_VERSION — this is the
# Franchise-data flavor of the model.
MODEL_VERSION = "franchise-v1"

# Per-36 rate stats projected by the season snapshot (mirrors
# season_project.RATE_STATS).
SEASON_RATE_STATS = ["pts", "reb", "ast", "stl", "blk", "tov",
                     "fg3m", "fgm", "fga", "ftm", "fta"]


def get_conn():
    return psycopg2.connect(PG_DSN)


# ================================================================
# Loaders (shape matches what the engine model functions expect)
# ================================================================

def load_archetypes_by_season(conn, sport: str) -> dict:
    """(player_id uuid str, season int) -> archetype, across all seasons. Mirrors
    the original engine's per-game-season archetype join (project.py:
    pa.season = g.season): each game uses its OWN season's stable role rather than
    a single current-season label, so a noisy in-progress season can't drag a
    player's prior. Written by franchise_archetype.py."""
    q = "SELECT player_id, season, archetype FROM player_archetypes WHERE sport = %s"
    df = pd.read_sql(q, conn, params=(sport,))
    return {(str(r["player_id"]), int(r["season"])): r["archetype"] for _, r in df.iterrows()}


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
    """
    q = "SELECT id, status FROM players WHERE sport = %s AND status IN ('OUT', 'SUSP')"
    df = pd.read_sql(q, conn, params=(sport,))
    return {r["id"]: "Out" for _, r in df.iterrows()}


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


def fetch_player_seasons(conn, sport: str, seasons: list) -> pd.DataFrame:
    """Per-player per-season per-36 aggregates for the season snapshot.

    Mirrors season_project.fetch_player_seasons but reads Franchise
    player_games. Returns one row per (player_id, season) with games_played,
    mpg and <stat>_per36 columns for SEASON_RATE_STATS.
    """
    q = """
        WITH filtered AS (
            SELECT player_id,
                   EXTRACT(YEAR FROM game_date)::int   AS season,
                   game_id,
                   min::float                          AS min_played,
                   COALESCE(pts,  0)::float            AS pts,
                   COALESCE(reb,  0)::float            AS reb,
                   COALESCE(ast,  0)::float            AS ast,
                   COALESCE(stl,  0)::float            AS stl,
                   COALESCE(blk,  0)::float            AS blk,
                   COALESCE(tov,  0)::float            AS tov,
                   COALESCE("3pm", 0)::float           AS fg3m,
                   COALESCE(fgm,  0)::float            AS fgm,
                   COALESCE(fga,  0)::float            AS fga,
                   COALESCE(ftm,  0)::float            AS ftm,
                   COALESCE(fta,  0)::float            AS fta
            FROM player_games
            WHERE sport = %s
              AND EXTRACT(YEAR FROM game_date) = ANY(%s)
              AND min >= %s
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
    return pd.read_sql(q, conn, params=(sport, list(seasons), min_minutes, min_games))


def fetch_active_players(conn, sport: str, recent_season: int) -> list:
    """Players who saw meaningful minutes in `recent_season` — the snapshot's
    projection candidates."""
    q = """
        SELECT DISTINCT player_id
        FROM player_games
        WHERE sport = %s
          AND EXTRACT(YEAR FROM game_date) = %s
          AND min >= %s
    """
    df = pd.read_sql(q, conn, params=(sport, recent_season, 3.0))
    return df["player_id"].tolist()


def team_games_per_season(conn, sport: str, seasons: list) -> dict:
    """{season: max games any single team is scheduled for} — replaces the
    engine's hardcoded MAX_TEAM_GAMES, derived live from game_schedule."""
    q = """
        WITH appearances AS (
            SELECT EXTRACT(YEAR FROM game_date)::int AS season, home_team AS team
            FROM game_schedule WHERE sport = %s
            UNION ALL
            SELECT EXTRACT(YEAR FROM game_date)::int AS season, away_team AS team
            FROM game_schedule WHERE sport = %s
        ),
        per_team AS (
            SELECT season, team, COUNT(*) AS games
            FROM appearances WHERE season = ANY(%s)
            GROUP BY season, team
        )
        SELECT season, MAX(games) AS team_games
        FROM per_team GROUP BY season
    """
    df = pd.read_sql(q, conn, params=(sport, sport, list(seasons)))
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
    """
    today = date.today()
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
            str(pid), sport, str(season), horizon, today,
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