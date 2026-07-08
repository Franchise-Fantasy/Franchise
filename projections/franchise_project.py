"""
Franchise projection runner.
========================================================================
Generates player projections from LIVE Franchise data and writes them to the
Franchise `player_projections` table. next_game uses the empirical projector
ported in `franchise_edge.py`; the season snapshot reuses `season_project.py`.
All Franchise-specific DB access lives in `franchise_db.py`.

Two horizons:
  next_game — in-season game-by-game projection (run daily). Exact port of the
              original engine's PRODUCTION projector (edge.py): each player's
              in-progress season blended toward their last completed season by
              sample size, scaled by a recent-minutes factor. Self-anchored to
              the player's own logs — no cross-player regression — so stars and
              breakouts stay accurate.
  season    — pre-season / draft snapshot (run on a schedule through the
              offseason so it absorbs injuries & trades). Recency-weighted prior
              seasons + experience curve + games-played model.

USAGE
-----
    python franchise_project.py --sport wnba --season 2026 --horizon next_game
    python franchise_project.py --sport wnba --season 2027 --horizon season
"""
import argparse
import math

import pandas as pd

import franchise_db as fdb
import franchise_edge as fedge
import season_project as sea_model


# ================================================================
# Game-by-game (next_game) horizon — port of edge.py, daily
# ================================================================

# Generic fantasy-points SD for the analytics uncertainty band. The per-league
# fantasy mean is computed client-side, so this is a typical-weights estimate,
# not a league-specific one — variance of a weighted sum of independent stats.
_FANTASY_W = {"pts": 1.0, "reb": 1.2, "ast": 1.5, "stl": 3.0, "blk": 3.0, "tov": 1.0, "fg3m": 0.5}


def _fantasy_sd(d: dict) -> float:
    return float(math.sqrt(sum((w * d[s][1]) ** 2 for s, w in _FANTASY_W.items())))


def run_next_game(sport: str, season: int):
    conn = fdb.get_conn()
    try:
        print(f"[next_game] projecting {sport} {season} "
              f"(current+prior empirical blend — port of edge.py)...")
        dists = fedge.get_player_distributions(conn, sport, season)
        if not dists:
            raise RuntimeError(f"No {sport} game logs to project for {season}")
        unavailable = fdb.get_unavailable_players(conn, sport)   # uuid -> 'Out'
        out_ids = set(unavailable)

        # Absence redistribution (port of the source): an Out player's minutes
        # flow to their active teammates by minute share, scaling every stat
        # (capped +40%). Out players are still in `dists` (they have history) so
        # their minutes can be redistributed before we drop them from the write.
        # Each Out player's contribution is faded by how many team games their
        # absence already spans (games_missed): a long-standing absence is already
        # reflected in teammates' recent minutes, so re-crediting it would
        # double-count and inflate the whole board (see franchise_edge
        # .absence_freshness_weight / ABSENCE_FADE_GAMES).
        player_teams, player_names = fdb.load_player_meta(conn, sport)
        games_missed = fdb.get_absence_games_missed(conn, sport)
        boosts = fedge.compute_absence_boosts(out_ids, dists, player_teams,
                                              player_names, games_missed)
        fedge.apply_absence_boosts(dists, boosts)

        rows = []
        for pid, d in dists.items():
            if pid in out_ids:
                continue   # Out — dropped from the board, same as the source
            row = {"player_id": pid, "proj_min": d["_proj_min"]}
            for s in fedge.STATS:
                row[f"proj_{s}"] = d[s][0]
            row["sd_pts"] = d["pts"][1]
            row["sd_reb"] = d["reb"][1]
            row["sd_ast"] = d["ast"][1]
            row["sd_fantasy_pg"] = _fantasy_sd(d)
            rows.append(row)

        result = pd.DataFrame(rows)
        n = fdb.write_projections(conn, result, sport, season, "next_game")
        n_blend = sum(1 for d in dists.values() if d["_basis"] == "blend")
        print(f"[next_game] wrote {n} projections "
              f"({n_blend} current+prior blends, {len(boosts)} absence-boosted, "
              f"{len(out_ids)} out dropped)")
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