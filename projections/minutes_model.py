"""
minutes_model.py — dedicated next-season minutes model (season horizon).
========================================================================
Minutes are the season model's dominant error source: giving the engine the
test season's ACTUAL minutes cuts per-game fantasy RMSE roughly in half
(62-68% of squared error, measured on 5 held-out NBA season pairs, 2026-08-03).
The engine's own minutes are barely better than carrying last season forward
(MPG RMSE 5.605 vs naive 5.666 on the 2025-26 pair). This module predicts
next-season MPG from features the carry-forward can't see — most importantly
the DEPTH-CHART context (rank within own team's minutes, share of team
minutes) that permutation importance ranks right after last season's mpg.

Validated (lab: proto_nba_minutes.py + stack_final.py): ridge alpha=10 on
native season->season+1 transitions, predictions blended 50/50 with the
engine's minutes, improved per-game chewers RMSE on 5/5 NBA backtest pairs
(holdout 2024/2025 untouched during tuning: -0.274 RMSE, paired Wilcoxon
p<1e-4 on both splits). An HistGradientBoosting variant was UNSTABLE on tune
pairs (worse 3/3) — don't swap ridge for boosting without re-validating.
Honesty note: this recovers only ~8% of the oracle minutes gap — the rest is
in-season information (injuries, trades, rotations) box-score history can't
see. NBA-only today: the WNBA path is gated off in SPORT_SEASON_PARAMS until
someone re-runs the same validation on WNBA pairs.

Kept free of DB access so tests can run on constructed frames: the loader
lives in franchise_db.fetch_minutes_frame; this module is pure
pandas/numpy/sklearn.
"""
import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge

# Tuned on backtest pairs 2021-2023 ONLY (2024/2025 were holdout — see
# stack_final.py). alpha from {1,10,30}; lambda from {0.25,0.5,0.75}.
RIDGE_ALPHA = 10.0
BLEND_LAMBDA = 0.5          # model share; (1-lambda) stays on engine minutes
MPG_CLIP = (1.0, 40.0)
MIN_TRANSITIONS = 300       # below this, skip the model (fall back to engine)

FEATURES = ["mpg", "games_played", "pts_per36", "ast_per36", "reb_per36",
            "usg_pct", "min_rank", "team_min_share", "age", "seasons_hist"]


def build_features(frame: pd.DataFrame, birth_years: dict,
                   draft_years: dict) -> pd.DataFrame:
    """Attach the model's derived features to a per-player-season frame.

    `frame` needs: player_id, season (int), team, games_played, mpg,
    pts/ast/reb/fga/fta/tov per-36 columns, and team totals tmin/tfga/tfta/ttov
    (the loader merges those on). Rows with a NULL team keep NaN depth features
    and are dropped from training / skipped at prediction (engine fallback).
    """
    df = frame.sort_values(["player_id", "season"]).copy()
    df["seasons_hist"] = df.groupby("player_id").cumcount() + 1.0

    # Age AT the season being projected (season s row is evidence for s+1).
    target = df.season + 1
    by = df.player_id.map(birth_years)
    dy = df.player_id.map(draft_years)
    age = target - by
    age = age.fillna(22 + (target - dy))          # drafted ~age 22
    df["age"] = age.fillna(21.0 + df.seasons_hist)  # panel-censored fallback

    # Box-score USG%: share of team scoring possessions used while on floor.
    ev36 = df.fga_per36 + 0.44 * df.fta_per36 + df.tov_per36
    team_ev_per_min = (df.tfga + 0.44 * df.tfta + df.ttov) / df.tmin
    df["usg_pct"] = (ev36 / 36.0) / (5.0 * team_ev_per_min) * 100.0

    # Depth-chart context within (team, season).
    df["min_rank"] = df.groupby(["team", "season"]).mpg.rank(ascending=False)
    df["team_min_share"] = (df.mpg * df.games_played) / df.tmin
    return df


def fit(features: pd.DataFrame, newest_train_season: int):
    """Fit the ridge on every season->season+1 transition available in
    `features` (both sides <= newest_train_season). Returns None when there
    aren't enough transitions to trust a fit — callers must fall back to
    engine minutes."""
    a = features[features.season < newest_train_season]
    nxt = features[features.season <= newest_train_season]
    nxt = nxt[["player_id", "season", "mpg"]].rename(
        columns={"season": "next_season", "mpg": "next_mpg"})
    tr = a.merge(nxt, on="player_id")
    tr = tr[tr.next_season == tr.season + 1].dropna(subset=FEATURES + ["next_mpg"])
    if len(tr) < MIN_TRANSITIONS:
        return None
    X = tr[FEATURES]
    mu, sd = X.mean(), X.std().replace(0.0, 1.0)
    est = Ridge(alpha=RIDGE_ALPHA, solver="svd")
    est.fit((X - mu) / sd, tr.next_mpg)
    return {"est": est, "mu": mu, "sd": sd, "n_transitions": len(tr)}


def predict(model, features: pd.DataFrame) -> pd.DataFrame:
    """player_id -> pred_mpg for rows with complete features."""
    rows = features.dropna(subset=FEATURES)
    if model is None or rows.empty:
        return pd.DataFrame(columns=["player_id", "pred_mpg"])
    X = (rows[FEATURES] - model["mu"]) / model["sd"]
    pred = np.clip(model["est"].predict(X), *MPG_CLIP)
    return pd.DataFrame({"player_id": rows.player_id.values, "pred_mpg": pred})


def blend_into_projection(pg: dict, pred_mpg: float) -> dict:
    """Blend the model's minutes into one player's per-game projection dict
    (season_project.to_per_game output) and rescale every counting stat by the
    minutes ratio — per-36 rates are untouched, only opportunity moves."""
    old = pg.get("proj_min") or 0.0
    if old <= 0 or pred_mpg is None or np.isnan(pred_mpg):
        return pg
    new = BLEND_LAMBDA * float(pred_mpg) + (1.0 - BLEND_LAMBDA) * old
    ratio = new / old
    out = dict(pg)
    for k, v in pg.items():
        if k.startswith("proj_") and k != "proj_min" and v is not None:
            out[k] = round(v * ratio, 2)
    out["proj_min"] = round(new, 1)
    return out
