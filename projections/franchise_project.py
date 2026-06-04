"""
Franchise projection runner.
========================================================================
Generates player projections from LIVE Franchise data and writes them to the
Franchise `player_projections` table. Reuses the engine's pure model functions
(`project.py`, `season_project.py`) unchanged by remapping Franchise UUID
player IDs to integer indices for the model run, then mapping back before the
write. All Franchise-specific DB access lives in `franchise_db.py`.

Two horizons:
  next_game — in-season game-by-game Bayesian projection (run daily). Hierarchical
              Negative Binomial on per-36 rates + recency weighting + archetype
              prior + injury-aware minutes, tilted toward each player's ACTUAL
              next opponent + venue + back-to-back.
  season    — pre-season / draft snapshot (run on a schedule through the
              offseason so it absorbs injuries & trades). Recency-weighted prior
              seasons + experience curve + games-played model.

USAGE
-----
    python franchise_project.py --sport wnba --season 2026 --horizon next_game
    python franchise_project.py --sport wnba --season 2027 --horizon season
"""
import argparse

import numpy as np
import pandas as pd

import franchise_db as fdb
import project as ros_model
import season_project as sea_model


# ================================================================
# UUID <-> integer remap (so engine int-keyed functions can be reused)
# ================================================================

def _to_int_ids(df: pd.DataFrame):
    """Replace the UUID player_id column with integer indices. Returns the
    rewritten frame and the int->uuid lookup for mapping results back."""
    uuids = df["player_id"].astype(str).unique().tolist()
    to_int = {u: i for i, u in enumerate(uuids)}
    to_uuid = {i: u for u, i in to_int.items()}
    df = df.copy()
    df["player_id"] = df["player_id"].astype(str).map(to_int)
    return df, to_int, to_uuid


# Vegas market blend (next_game). Lines exist for these stats; the rest keep the
# model value. The weight leans heavily on the market because the line is
# matchup-priced and the raw model under-projects. NB: the model's threes column
# is `proj_fg3m` (mapped to proj_3pm on write).
VEGAS_BLEND = 0.85
_PROP_STAT_COL = {"pts": "proj_pts", "reb": "proj_reb", "ast": "proj_ast", "3pm": "proj_fg3m"}


def _apply_vegas_blend(result: pd.DataFrame, vegas: dict) -> int:
    """In place: blend the market line into pts/reb/ast/3pm where one is posted
    for the player's next game. Returns the number of cells blended."""
    blended = 0
    for stat, col in _PROP_STAT_COL.items():
        new_vals = []
        for _, r in result.iterrows():
            line = vegas.get(r["player_id"], {}).get(stat)
            cur = r[col]
            if line is None:
                new_vals.append(cur)
            elif pd.isna(cur):
                new_vals.append(line)
                blended += 1
            else:
                new_vals.append(VEGAS_BLEND * line + (1 - VEGAS_BLEND) * float(cur))
                blended += 1
        result[col] = new_vals
    return blended


# ================================================================
# Game-by-game (next_game) horizon — Bayesian + market blend, daily
# ================================================================

def run_next_game(sport: str, season: int):
    conn = fdb.get_conn()
    try:
        print(f"[next_game] loading box scores for {sport} (season<= {season})...")
        df = fdb.load_box_scores(conn, sport, season)
        if df.empty:
            raise RuntimeError(f"No box scores for {sport} {season}")

        unavailable = fdb.get_unavailable_players(conn, sport)   # uuid -> 'Out'
        upcoming = fdb.load_upcoming_context(conn, sport)        # uuid -> {opp_team_id, is_home, is_b2b}

        df, to_int, to_uuid = _to_int_ids(df)
        injuries = {to_int[u]: s for u, s in unavailable.items() if u in to_int}
        upcoming_ctx = {to_int[u]: ctx for u, ctx in upcoming.items() if u in to_int}

        df = ros_model.add_b2b_flag(df)
        df = ros_model.add_recency_weights(df)

        # Opponent-defense factors (keyed by opponent tricode + season), used both
        # to de-bias each training observation for schedule strength (opp_log_offset
        # below) AND — via upcoming_ctx — to tilt each player's projection toward
        # their ACTUAL next opponent + venue + back-to-back. is_home/is_b2b effects
        # are learned from the training rows. int() guards numpy int64 in ANY(%s).
        opp_factors = fdb.compute_opp_factors(conn, sport, sorted(int(s) for s in df["season"].unique()))

        print("[next_game] estimating projected minutes...")
        projected_min = ros_model.estimate_projected_minutes(df, injuries)
        print(f"[next_game] projecting {len(projected_min)} players; "
              f"{len(upcoming_ctx)} have a scheduled next game")

        summaries = []
        for stat in ros_model.COUNT_STATS:
            print(f"[next_game] fitting {stat}...")
            df_stat = df.copy()
            df_stat["opp_log_offset"] = df_stat.apply(
                lambda r: float(np.log(max(
                    opp_factors.get((r["opp_team_id"], int(r["season"])), {}).get(stat, 1.0),
                    0.5,
                ))),
                axis=1,
            )
            fit = ros_model.fit_count_stat(df_stat, stat)
            summaries.append(
                ros_model.summarize_posterior(fit, projected_min, upcoming_ctx, opp_factors, season)
            )

        result = summaries[0]
        for s in summaries[1:]:
            result = result.merge(s, on="player_id", how="outer")
        result["proj_min"] = result["player_id"].map(projected_min)
        result["player_id"] = result["player_id"].map(to_uuid)

        # Vegas blend — market lines for pts/reb/ast/3pm are matchup-priced and
        # accurate; the raw model under-projects, so lean heavily on the line for
        # those stats. Unlined stats (stl/blk/tov/min) keep the model value.
        vegas = fdb.load_vegas_props(conn, sport)
        n_blended = _apply_vegas_blend(result, vegas)
        print(f"[next_game] blended market lines into {n_blended} stat cells "
              f"({len(vegas)} players with posted props)")

        result = ros_model.compute_fantasy_score(result)   # fpts from the blended line

        n = fdb.write_projections(conn, result, sport, season, "next_game")
        print(f"[next_game] wrote {n} projections.")
    finally:
        conn.close()


# ================================================================
# Season snapshot horizon (pre-season, scheduled through offseason)
# ================================================================

def _recency_weights(prior_seasons: list) -> dict:
    """Halving recency weights by offset from the most recent prior season
    (most recent -> 1.0, one before -> 0.5, ...). Normalized downstream."""
    newest = max(prior_seasons)
    return {s: 0.5 ** (newest - s) for s in prior_seasons}


def run_season(sport: str, season: int, lookback_seasons: int = 5):
    conn = fdb.get_conn()
    try:
        recent_season = season - 1   # most recently completed season
        prior_seasons = list(range(season - lookback_seasons, season))  # < target

        print(f"[season] loading prior-season aggregates {prior_seasons}...")
        hist = fdb.fetch_player_seasons(conn, sport, prior_seasons)
        if hist.empty:
            raise RuntimeError(f"No historical data for {sport} {prior_seasons}")
        active = fdb.fetch_active_players(conn, sport, recent_season)

        # Dynamic games-per-season + project target length (replaces the
        # engine's hardcoded year maps). Fall back to the most recent prior
        # season's length if the target schedule isn't loaded yet.
        team_games = fdb.team_games_per_season(conn, sport, prior_seasons + [season])
        default_len = team_games.get(recent_season, 40)
        project_games = team_games.get(season, default_len)

        # Monkeypatch the season model's global constants for this run.
        sea_model.SEASON_WEIGHTS = _recency_weights(prior_seasons)
        sea_model.MAX_TEAM_GAMES = {s: team_games.get(s, default_len)
                                    for s in prior_seasons + [season]}
        sea_model.PROJECT_GAMES = project_games

        print(f"[season] {hist['player_id'].nunique()} players w/ history, "
              f"{len(active)} candidates, projecting {project_games} games")

        rows = []
        for pid in active:
            phist = hist[hist["player_id"] == pid].sort_values("season")
            if phist.empty:
                continue
            proj = sea_model.weighted_projection(phist)
            if proj is None:
                continue
            proj = sea_model.experience_curve(proj, len(phist))
            pg = sea_model.to_per_game(proj)
            proj_games, _ = sea_model.project_games_played(phist, proj["gp_pct"])
            rows.append({"player_id": pid, "projected_games": proj_games, **pg})

        result = pd.DataFrame(rows)
        n = fdb.write_projections(conn, result, sport, season, "season")
        print(f"[season] wrote {n} projections.")
    finally:
        conn.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--sport", choices=["nba", "wnba"], default="wnba")
    ap.add_argument("--season", type=int, required=True)
    ap.add_argument("--horizon", choices=["next_game", "season"], default="next_game")
    args = ap.parse_args()
    if args.horizon == "next_game":
        run_next_game(args.sport, args.season)
    else:
        run_season(args.sport, args.season)