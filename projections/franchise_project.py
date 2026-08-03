"""
Franchise projection runner.
========================================================================
Generates player projections from LIVE Franchise data and writes them to the
Franchise `player_projections` table. next_game uses the empirical projector
ported in `franchise_edge.py`; the season snapshot reuses `season_project.py`.
All Franchise-specific DB access lives in `franchise_db.py`.

Two horizons:
  next_game — in-season game-by-game projection (run daily). Port of the
              original engine's PRODUCTION projector (edge.py; deliberate
              divergences listed in franchise_edge.py): each player's
              in-progress season blended toward their last completed season by
              sample size, scaled by a recent-minutes factor. Self-anchored to
              the player's own logs — no cross-player regression — so stars and
              breakouts stay accurate.
  season    — pre-season / draft snapshot (run on a schedule through the
              offseason so it absorbs injuries & trades). Recency-weighted prior
              seasons + small-sample shrinkage + a sport-gated experience curve
              + a league-blended games-played model. Prior seasons come from
              player_games where we still retain them and from
              player_historical_stats where we don't (NBA keeps one season of
              logs), so a returning starter's injury year isn't mistaken for a
              player with no career. The two sport-dependent pieces are set in
              SPORT_SEASON_PARAMS below and both were fixed by backtest, not by
              symmetry — see that block and season_project.GAMES_LEAGUE_BLEND.

USAGE
-----
    python franchise_project.py --sport wnba --season 2026 --horizon next_game
    python franchise_project.py --sport wnba --season 2027 --horizon season
    python franchise_project.py --sport nba  --season 2026 --horizon season

`--season` is always the INTEGER START YEAR (2026 = WNBA '2026' = NBA
'2026-27'). Games are matched to seasons by season_config date windows and the
row's `season` column gets the sport's canonical label at write time — see
season_windows.py (audit 2026-07-27).
"""
import argparse
import math
from datetime import date

import pandas as pd

import franchise_db as fdb
import franchise_edge as fedge
import minutes_model as mmodel
import rookie_priors as rprior
import season_project as sea_model
from season_windows import experience_seasons

# Sport-specific season-model parameters. The season_project constants shipped
# WNBA-fit; running NBA against them silently mis-calibrates the games-played
# model (an 82-game season has a materially lower league GP% than a 44-game
# one). LEAGUE_AVG_GP_PCT derivation matches season_project.py's: league-wide
# avg of games/schedule-length for qualifying players (NBA 2025-26: 532 players,
# computed 2026-07-27). `default_len` is the fallback schedule length when
# game_schedule has no rows for a season.
#
# `experience_curve` (2026-08-02) gates season_project.experience_curve per
# sport. Because experience_seasons clamps career length to 5, that curve has
# exactly two reachable outcomes — +10% for a player with ≤2 seasons, and 1.00
# for everyone else — so this flag is really "apply the young-player boost".
# Backtesting on 4 held-out WNBA seasons says the boost is NBA-shaped and costs
# WNBA accuracy: turning it off improved per-game fantasy RMSE on 4/4 pairs
# (mean -0.175, pooled paired Wilcoxon p=0.004 over 418 players) and season
# totals on 4/4. The same change on NBA 2025-26 was WORSE (+0.127), which is
# consistent with its origin — NBA rookies arrive on a steeper development
# curve than WNBA rookies, who enter a smaller league at an older draft age.
# Enable per sport only with backtest evidence, not by symmetry.
# `lookback_seasons` (2026-08-03) is ALSO sport-specific, and the asymmetry is
# the surprise of the NBA history backfill. Deeper history helps WNBA a lot and
# HURTS NBA. Measured on the same code path, per-game fantasy RMSE vs training
# on last season alone:
#     depth   WNBA (3 test seasons)      NBA (3 test seasons)
#       2       -0.340 (better 3/3)        +0.015 (worse 2/3)
#       3       -0.433 (better 3/3)        +0.053 (worse 2/2)
#       4       -0.377 (better 2/2)        +0.166 (worse 1/1)
# The likely cause is roster churn: a WNBA player's role three years ago still
# describes them (12-woman rosters, stable careers), while an NBA role from
# three years ago is stale and dilutes last season's signal through the 0.5^age
# recency weights. NBA depth 1 vs 2 is a wash (well inside the ±0.4 noise bar),
# so 2 is kept for the extra sample_games evidence the shrinkage uses; 3+ is
# monotonically worse and must not be re-enabled without a fresh backtest.
# This mattered immediately: before the backfill NBA simply HAD no prior
# seasons, so the old blanket lookback of 5 was inert. Backfilling 2019-2024
# made it live, and leaving it at 5 would have silently degraded every NBA
# projection by ~+0.17 RMSE — the backfill paying for itself in reverse.
# 2026-08-03 accuracy round (5 native NBA backtest pairs, tests 2021-2023 for
# tuning, 2024/2025 strictly held out; lab: stack_final.py). Three more NBA
# settings became sport-specific, all improving 5/5 pairs with holdout-
# significant pooled tests; the shipped stack measured -0.31 holdout per-game
# RMSE (~5% of baseline) as a unit:
#   recency_decay    weight of season t-1-k is decay^k. NBA 0.3 (was the
#                    generic 0.5): even one-year-old NBA data over-describes a
#                    player's current role. WNBA keeps 0.5.
#   mpg/rate_conf_frac  small-sample shrinkage ramps (season_project). NBA
#                    0.55/0.35 — thin samples shrink HARDER than the 0.40/0.25
#                    the earlier (in-sample-tainted) tune chose; WNBA keeps
#                    0.40/0.25 untouched since the refit was NBA-only.
#   minutes_model    dedicated ridge next-season-MPG model (minutes_model.py),
#                    blended 50/50 with engine minutes. NBA-only: it trains on
#                    native season->season+1 transitions (the 2026-08-03
#                    backfill created ~2k), and the WNBA pairs never validated
#                    it. The biggest single win of the round (-0.27 holdout).
# Rejected with evidence, do not re-add casually: Marcel ensemble (tune-era
# gain was decaying calibration bias; holdout WORSE than this stack), per-stat
# EB shrinkage (the linear ramp already equals the EB weight to within noise),
# always-on residual regression, games-blend weight changes, usage as a direct
# rate feature (its information lives in the minutes model).
SPORT_SEASON_PARAMS = {
    "wnba": {"league_avg_gp_pct": 0.727, "default_len": 40,
             "experience_curve": False, "lookback_seasons": 5,
             "recency_decay": 0.5, "mpg_conf_frac": 0.40,
             "rate_conf_frac": 0.25, "minutes_model": False,
             "rookie_priors": False},
    "nba":  {"league_avg_gp_pct": 0.587, "default_len": 82,
             "experience_curve": True, "lookback_seasons": 2,
             "recency_decay": 0.3, "mpg_conf_frac": 0.55,
             "rate_conf_frac": 0.35, "minutes_model": True,
             "rookie_priors": True},
}
# `rookie_priors` (2026-08-03, franchise-v1.6): incoming rookies — previously
# ABSENT from the projection table entirely, since candidates = played-last-
# season — are projected from draft-slot bucket medians of our own past rookie
# classes (rookie_priors.py). WNBA stays off only because BDL carries no WNBA
# draft fields; seed players.draft_number for WNBA and flip the flag.

# How far back fetch_minutes_frame reaches for transition training data. NOT
# the projection lookback: stale seasons are bad PRIORS but fine TRAINING
# EXAMPLES (a 2019->2020 transition teaches how minutes move year-over-year
# regardless of who the players were). Bounded by our own retention.
MINUTES_MODEL_HISTORY = 7

# Liveness floor: a healthy run writes hundreds of rows for either sport. A
# tiny write means a broken loader/filter, and a green Action with 5 rows is
# how a dead pipeline hides for 14 days until the view's freshness window
# silently empties every surface (audit 2026-07-27).
MIN_ROWS_WRITTEN = 50


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
        windows = fdb.get_season_windows(conn, sport, [season - 1, season])
        dists = fedge.get_player_distributions(conn, sport, season, windows)
        if not dists:
            raise RuntimeError(f"No {sport} game logs to project for {season}")
        unavailable = fdb.get_unavailable_players(conn, sport)   # uuid -> 'Out'
        out_ids = set(unavailable)
        player_teams, player_names = fdb.load_player_meta(conn, sport)

        # Phantom gate: drop prior_only players once their team (league max if
        # teamless) is far enough into the season that never appearing means
        # they're out of the league, not merely unprojected yet. Removing them
        # BEFORE the boosts also keeps them out of team_active, so absence
        # minutes redistribute only to players who have actually appeared.
        team_games = fdb.get_team_games_played(conn, sport, windows[season])
        league_max_games = max(team_games.values(), default=0)
        phantoms = set()
        for pid, d in dists.items():
            tid = player_teams.get(pid)
            tgp = team_games.get(tid, league_max_games) if tid else league_max_games
            if fedge.is_phantom(d["_basis"], tgp):
                phantoms.add(pid)
        for pid in phantoms:
            del dists[pid]

        # Absence redistribution (port of the source): an Out player's minutes
        # flow to their active teammates by minute share, scaling every stat
        # (capped +40%). Out players are still in `dists` (they have history) so
        # their minutes can be redistributed before we zero them on the board.
        # Each Out player's contribution is faded by how many team games their
        # absence already spans (games_missed): a long-standing absence is already
        # reflected in teammates' recent minutes, so re-crediting it would
        # double-count and inflate the whole board (see franchise_edge
        # .absence_freshness_weight / ABSENCE_FADE_GAMES).
        games_missed = fdb.get_absence_games_missed(conn, sport)
        boosts = fedge.compute_absence_boosts(out_ids, dists, player_teams,
                                              player_names, games_missed)
        fedge.apply_absence_boosts(dists, boosts)

        rows = []
        n_zeroed = 0
        for pid, d in dists.items():
            if pid in out_ids:
                # Retraction: write an explicit zero line instead of skipping.
                # Skipping (the source behavior) left yesterday's full-strength
                # row live in current_player_projections for up to 14 days after
                # a player was ruled out. sd_* keys are omitted -> NULL.
                row = {"player_id": pid, "proj_min": 0.0}
                for s in fedge.STATS:
                    row[f"proj_{s}"] = 0.0
                rows.append(row)
                n_zeroed += 1
                continue
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
              f"{n_zeroed} out zeroed, {len(phantoms)} phantoms gated)")
        if n < MIN_ROWS_WRITTEN:
            raise RuntimeError(
                f"Only {n} rows written (< {MIN_ROWS_WRITTEN}) — treating as a "
                f"broken run so the Action goes red instead of green-and-empty")
    finally:
        conn.close()


# ================================================================
# Season snapshot horizon (pre-season, scheduled through offseason)
# ================================================================

def _recency_weights(prior_seasons: list, decay: float = 0.5) -> dict:
    """Geometric recency weights by offset from the most recent prior season
    (most recent -> 1.0, one before -> decay, ...). Normalized downstream.
    Decay is per-sport (SPORT_SEASON_PARAMS.recency_decay): NBA roles go stale
    fast, so its older season carries 0.3, not the generic 0.5."""
    newest = max(prior_seasons)
    return {s: decay ** (newest - s) for s in prior_seasons}


def run_season(sport: str, season: int, lookback_seasons: int = None):
    conn = fdb.get_conn()
    try:
        params = SPORT_SEASON_PARAMS[sport]
        if lookback_seasons is None:
            lookback_seasons = params["lookback_seasons"]
        recent_season = season - 1   # most recent prior season (may be in progress)
        prior_seasons = list(range(season - lookback_seasons, season))  # < target
        windows = fdb.get_season_windows(conn, sport, prior_seasons + [season])

        print(f"[season] loading prior-season aggregates {prior_seasons}...")
        hist = fdb.fetch_player_seasons(
            conn, sport, {s: windows[s] for s in prior_seasons})
        if hist.empty:
            raise RuntimeError(f"No historical data for {sport} {prior_seasons}")
        active = fdb.fetch_active_players(conn, sport, windows[recent_season])

        # Dynamic games-per-season + project target length (replaces the
        # engine's hardcoded year maps). Fall back to the most recent prior
        # season's length if the target schedule isn't loaded yet.
        team_games = fdb.team_games_per_season(conn, sport, windows)
        default_len = team_games.get(recent_season, params["default_len"])
        project_games = team_games.get(season, default_len)

        # GP-denominator fix (audit 2026-07-27): the offseason snapshot targets
        # the NEXT season, so the season currently being PLAYED lands in the
        # priors at top recency weight. Its gp_pct denominator must be the
        # games COMPLETED so far, not the full scheduled length — otherwise
        # gp_pct ≈ fraction-of-season-elapsed, the injury penalty fires for
        # essentially every player, and projected_games deflates league-wide
        # (measured on wnba/season/2027: avg 15.79 on 06-04 climbing to 24.08
        # by 07-27, tracking the elapsed season). Once a season completes,
        # completed == scheduled, so this is a no-op for the explicit-season
        # PvE baseline path (all its priors are finished seasons).
        today = date.today()
        in_progress = [s for s in prior_seasons
                       if windows[s][0] <= today <= windows[s][1]]
        if in_progress:
            completed = fdb.team_games_per_season(
                conn, sport, {s: windows[s] for s in in_progress},
                completed_before=today)
            for s in in_progress:
                if completed.get(s):
                    team_games[s] = completed[s]
            print(f"[season] in-progress prior {in_progress} -> completed-game "
                  f"denominators {[completed.get(s) for s in in_progress]}")

        # Monkeypatch the season model's global constants for this run.
        sea_model.SEASON_WEIGHTS = _recency_weights(prior_seasons,
                                                    params["recency_decay"])
        sea_model.MAX_TEAM_GAMES = {s: team_games.get(s, default_len)
                                    for s in prior_seasons + [season]}
        sea_model.PROJECT_GAMES = project_games
        sea_model.LEAGUE_AVG_GP_PCT = params["league_avg_gp_pct"]
        sea_model.MPG_FULL_CONF_FRAC = params["mpg_conf_frac"]
        sea_model.RATE_FULL_CONF_FRAC = params["rate_conf_frac"]

        print(f"[season] {hist['player_id'].nunique()} players w/ history, "
              f"{len(active)} candidates, projecting {project_games} games")

        # True career length for the experience curve (2026-07-28): Franchise
        # game-log depth is capped by our own retention — one NBA season — so
        # keying the curve on len(phist) gave EVERY NBA player the ≤2-seasons
        # "+10%" youth boost and the whole first snapshot projected above last
        # year (532/532, median ratio 1.104). draft_year is the career source;
        # players without one fall back to history depth.
        draft_years = fdb.get_draft_years(conn, sport)

        # League priors for the small-sample shrinkage: minute-weighted per-36
        # rates + mean MPG over the same training frame the players are
        # projected from. Computed once — identical for every player in the run.
        priors = sea_model.league_rate_priors(hist)

        # Dedicated minutes model (minutes_model.py): ridge over native
        # season->season+1 transitions, predictions blended 50/50 with the
        # engine's own minutes. Trains on deeper history than the projection
        # lookback (stale seasons are bad priors but fine training examples).
        # Falls back to engine minutes wherever a prediction is missing —
        # a candidate with no team, thin features, or too few transitions.
        min_preds = {}
        mframe = pd.DataFrame()
        if params["minutes_model"] or params["rookie_priors"]:
            mframe = fdb.fetch_minutes_frame(
                conn, sport, recent_season - MINUTES_MODEL_HISTORY + 1,
                recent_season)
        if params["minutes_model"]:
            if not mframe.empty:
                feats = mmodel.build_features(
                    mframe, fdb.get_birth_years(conn, sport), draft_years)
                fitted = mmodel.fit(feats, recent_season)
                if fitted is not None:
                    preds = mmodel.predict(
                        fitted, feats[feats.season == recent_season])
                    min_preds = dict(zip(preds.player_id, preds.pred_mpg))
                    print(f"[season] minutes model: "
                          f"{fitted['n_transitions']} transitions, "
                          f"{len(min_preds)} predictions")
                else:
                    print("[season] minutes model: too few transitions — "
                          "falling back to engine minutes")

        rows = []
        n_shrunk = 0
        n_blended = 0
        for pid in active:
            phist = hist[hist["player_id"] == pid].sort_values("season")
            if phist.empty:
                continue
            proj = sea_model.weighted_projection(phist)
            if proj is None:
                continue
            # Shrink BEFORE the experience curve: the priors live on the raw
            # per-36 scale, so applying the curve first would compare a
            # curve-boosted rate against an unboosted prior.
            if proj.get("sample_games", 0) < project_games * sea_model.MPG_FULL_CONF_FRAC:
                n_shrunk += 1
            proj = sea_model.shrink_to_priors(proj, priors, project_games)
            if params["experience_curve"]:
                proj = sea_model.experience_curve(
                    proj, experience_seasons(season, draft_years.get(str(pid)),
                                             len(phist)))
            pg = sea_model.to_per_game(proj)
            pred = min_preds.get(str(pid))
            if pred is not None:
                pg = mmodel.blend_into_projection(pg, pred)
                n_blended += 1
            proj_games, _ = sea_model.project_games_blended(proj["gp_pct"])
            rows.append({"player_id": pid, "projected_games": proj_games, **pg})
        print(f"[season] small-sample shrinkage applied to {n_shrunk} players "
              f"(< {project_games * sea_model.MPG_FULL_CONF_FRAC:.0f} evidence games); "
              f"experience curve {'on' if params['experience_curve'] else 'off'}; "
              f"minutes blended for {n_blended}")

        # Rookie slot priors (rookie_priors.py): the incoming class has no
        # game logs, so it can't come from `active` — append rookies projected
        # from their draft-slot bucket's historical median. Anyone already
        # projected above (edge case: a "rookie" with real prior-season games)
        # keeps the evidence-based row.
        if params["rookie_priors"] and not mframe.empty:
            priors = rprior.fit_priors(mframe, fdb.get_draft_years(conn, sport),
                                       fdb.get_draft_slots(conn, sport))
            candidates = fdb.get_rookie_candidates(conn, sport, season)
            projected = {str(r["player_id"]) for r in rows}
            n_rookies = 0
            for r in candidates.itertuples():
                if r.player_id in projected:
                    continue
                row = rprior.project_rookie(priors, r.draft_number,
                                            project_games)
                if row is None:
                    continue
                rows.append({"player_id": r.player_id, **row})
                n_rookies += 1
            print(f"[season] rookie slot priors: {len(candidates)} candidates, "
                  f"{n_rookies} projected "
                  f"(buckets: {list(priors.index) if not priors.empty else '—'})")

        result = pd.DataFrame(rows)
        n = fdb.write_projections(conn, result, sport, season, "season")
        print(f"[season] wrote {n} projections.")
        if n < MIN_ROWS_WRITTEN:
            raise RuntimeError(
                f"Only {n} rows written (< {MIN_ROWS_WRITTEN}) — treating as a "
                f"broken run so the Action goes red instead of green-and-empty")
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