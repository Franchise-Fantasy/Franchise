"""
Franchise projection runner.
========================================================================
Generates player projections from LIVE Franchise data and writes them to the
Franchise `player_projections` table. Reuses the engine's pure model functions
(`project.py`, `season_project.py`) unchanged by remapping Franchise UUID
player IDs to integer indices for the model run, then mapping back before the
write. All Franchise-specific DB access lives in `franchise_db.py`.

Two horizons:
  ros    — in-season rest-of-season Bayesian projection (run daily during the
           season). Hierarchical Negative Binomial on per-36 rates + recency
           weighting + b2b + injury-aware minutes. Opponent/home adjustments
           are neutral (Franchise box scores carry no per-game team context).
  season — pre-season / draft snapshot (run on a schedule through the
           offseason so it absorbs injuries & trades). Recency-weighted prior
           seasons + experience curve + games-played model.

USAGE
-----
    python franchise_project.py --sport wnba --season 2026 --horizon ros
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


# ================================================================
# ROS horizon (Bayesian, daily)
# ================================================================

def run_ros(sport: str, season: int):
    conn = fdb.get_conn()
    try:
        print(f"[ros] loading box scores for {sport} (season<= {season})...")
        df = fdb.load_box_scores(conn, sport, season)
        if df.empty:
            raise RuntimeError(f"No box scores for {sport} {season}")

        unavailable = fdb.get_unavailable_players(conn, sport)  # uuid -> 'Out'

        df, to_int, to_uuid = _to_int_ids(df)
        injuries = {to_int[u]: s for u, s in unavailable.items() if u in to_int}

        df = ros_model.add_b2b_flag(df)
        df = ros_model.add_recency_weights(df)

        # Opponent-defense factors (keyed by opponent tricode + season). Used to
        # de-bias each training observation for schedule strength via
        # opp_log_offset. is_home + is_b2b are already on df (load_box_scores /
        # add_b2b_flag), so the home-court and back-to-back effects are learned
        # too. We still PROJECT at a neutral opponent (opp_f=1.0) and half-home
        # (is_home=0.5) because a rest-of-season line faces an average slate —
        # summarize_posterior does this automatically when upcoming_ctx is {}.
        # int() guards against psycopg2 failing to adapt numpy int64 in ANY(%s).
        opp_factors = fdb.compute_opp_factors(conn, sport, sorted(int(s) for s in df["season"].unique()))

        print("[ros] estimating projected minutes...")
        projected_min = ros_model.estimate_projected_minutes(df, injuries)
        print(f"[ros] projecting {len(projected_min)} players")

        summaries = []
        for stat in ros_model.COUNT_STATS:
            print(f"[ros] fitting {stat}...")
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
                ros_model.summarize_posterior(fit, projected_min, {}, opp_factors, season)
            )

        result = summaries[0]
        for s in summaries[1:]:
            result = result.merge(s, on="player_id", how="outer")
        result["proj_min"] = result["player_id"].map(projected_min)
        result = ros_model.compute_fantasy_score(result)   # provides sd_fantasy_pg

        result["player_id"] = result["player_id"].map(to_uuid)
        n = fdb.write_projections(conn, result, sport, season, "ros")
        print(f"[ros] wrote {n} projections.")
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
    ap.add_argument("--horizon", choices=["ros", "season"], default="ros")
    args = ap.parse_args()
    if args.horizon == "ros":
        run_ros(args.sport, args.season)
    else:
        run_season(args.sport, args.season)