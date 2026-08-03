"""Tests for minutes_model.py (franchise-v1.5) and the per-sport config that
gates it. The accuracy claims live in the lab (stack_final.py / validate_v15
reproduced holdout -0.312 RMSE); what a unit test can pin is the CONTRACT:
feature math, the fit/fallback boundary, the blend preserving per-36 rates,
and the config staying what was validated.

Run: `cd projections && python -m pytest`.
"""
import os
import sys

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import minutes_model as mm  # noqa: E402


def toy_frame():
    """Two seasons, one team of three players + one teamless row."""
    rows = []
    for season in (2023, 2024):
        for pid, mpg, gp in (("a", 30.0, 70), ("b", 20.0, 60), ("c", 10.0, 40)):
            rows.append({
                "player_id": pid, "season": season, "team": "LAL",
                "games_played": gp, "mpg": mpg,
                "pts_per36": 18.0, "reb_per36": 6.0, "ast_per36": 4.0,
                "tov_per36": 2.0, "fga_per36": 14.0, "fta_per36": 4.0,
                # team totals: 3 players, per-game team minutes = 60 here
                # (a toy — the math only needs internal consistency)
                "tmin": sum(m * g for _, m, g in
                            (("a", 30.0, 70), ("b", 20.0, 60), ("c", 10.0, 40))),
                "tfga": 5000.0, "tfta": 1200.0, "ttov": 800.0,
            })
    rows.append({**rows[0], "player_id": "d", "team": None,
                 "tmin": np.nan, "tfga": np.nan, "tfta": np.nan, "ttov": np.nan})
    return pd.DataFrame(rows)


# ── build_features ───────────────────────────────────────────────────────────

def test_depth_chart_features():
    f = mm.build_features(toy_frame(), {}, {})
    s24 = f[(f.season == 2024) & (f.team == "LAL")].set_index("player_id")
    assert s24.loc["a", "min_rank"] == 1.0
    assert s24.loc["c", "min_rank"] == 3.0
    # team_min_share = player minutes / team minutes, so the roster's shares
    # can't exceed 1 in total
    assert s24.team_min_share.sum() <= 1.0 + 1e-9
    assert s24.loc["a", "team_min_share"] > s24.loc["c", "team_min_share"]


def test_usage_is_a_share_of_team_events():
    f = mm.build_features(toy_frame(), {}, {})
    row = f[(f.player_id == "a") & (f.season == 2024)].iloc[0]
    ev36 = row.fga_per36 + 0.44 * row.fta_per36 + row.tov_per36
    expected = (ev36 / 36.0) / (5.0 * (row.tfga + 0.44 * row.tfta + row.ttov)
                                / row.tmin) * 100.0
    assert row.usg_pct == pytest.approx(expected)


def test_age_fallback_chain():
    f = mm.build_features(toy_frame(), {"a": 1998}, {"b": 2020})
    s24 = f[f.season == 2024].set_index("player_id")
    assert s24.loc["a", "age"] == 2025 - 1998          # birth year wins
    assert s24.loc["b", "age"] == 22 + (2025 - 2020)   # draft-year proxy
    # no info at all -> panel-censored fallback, monotone in history depth
    assert s24.loc["c", "age"] == pytest.approx(21.0 + s24.loc["c", "seasons_hist"])


def test_teamless_rows_have_nan_depth_features():
    f = mm.build_features(toy_frame(), {}, {})
    d = f[f.player_id == "d"].iloc[0]
    assert np.isnan(d.usg_pct) and np.isnan(d.team_min_share)


# ── fit / predict ────────────────────────────────────────────────────────────

def test_fit_returns_none_below_min_transitions():
    f = mm.build_features(toy_frame(), {}, {})
    assert mm.fit(f, 2024) is None   # 3 transitions << MIN_TRANSITIONS


def test_fit_predict_roundtrip_and_clip():
    rng = np.random.default_rng(0)
    n = mm.MIN_TRANSITIONS + 50
    rows = []
    for i in range(n):
        mpg = float(rng.uniform(5, 38))
        for season in (2023, 2024):
            rows.append({
                "player_id": f"p{i}", "season": season, "team": "T",
                "games_played": 60, "mpg": mpg + (2 if season == 2024 else 0),
                "pts_per36": 15.0, "reb_per36": 6.0, "ast_per36": 3.0,
                "tov_per36": 2.0, "fga_per36": 12.0, "fta_per36": 3.0,
                "tmin": 19680.0, "tfga": 7000.0, "tfta": 1800.0, "ttov": 1100.0,
            })
    f = mm.build_features(pd.DataFrame(rows), {}, {})
    model = mm.fit(f, 2024)
    assert model is not None and model["n_transitions"] == n
    preds = mm.predict(model, f[f.season == 2024])
    assert len(preds) == n
    assert preds.pred_mpg.between(*mm.MPG_CLIP).all()


# ── blend_into_projection ────────────────────────────────────────────────────

def test_blend_moves_minutes_halfway_and_preserves_per36():
    pg = {"proj_min": 20.0, "proj_pts": 10.0, "proj_reb": 4.0,
          "proj_fg3a": 3.0}
    out = mm.blend_into_projection(pg, 30.0)
    assert out["proj_min"] == pytest.approx(25.0)      # 0.5*30 + 0.5*20
    # per-36 rate unchanged: counting stats scale exactly with minutes
    assert out["proj_pts"] / out["proj_min"] == pytest.approx(10.0 / 20.0)
    assert out["proj_fg3a"] / out["proj_min"] == pytest.approx(3.0 / 20.0)
    assert pg["proj_min"] == 20.0                      # input not mutated


def test_blend_guards():
    pg = {"proj_min": 0.0, "proj_pts": 0.0}
    assert mm.blend_into_projection(pg, 25.0) == pg    # zero-minute passthrough
    pg2 = {"proj_min": 20.0, "proj_pts": 10.0}
    assert mm.blend_into_projection(pg2, float("nan")) == pg2


# ── the validated per-sport config ───────────────────────────────────────────

def test_v15_sport_params():
    """Read via ast (franchise_project imports franchise_db -> needs PG_DSN)."""
    import ast

    src = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "franchise_project.py")
    params = next(
        ast.literal_eval(n.value) for n in ast.parse(open(src).read()).body
        if isinstance(n, ast.Assign)
        and any(getattr(t, "id", None) == "SPORT_SEASON_PARAMS"
                for t in n.targets))

    nba, wnba = params["nba"], params["wnba"]
    # The validated NBA stack (stack_final.py D): recency 0.3, shrink
    # 0.55/0.35, minutes model on. Changing any of these requires a re-run of
    # the backtest, not a hunch.
    assert nba["recency_decay"] == 0.3
    assert nba["mpg_conf_frac"] == 0.55 and nba["rate_conf_frac"] == 0.35
    assert nba["minutes_model"] is True
    # WNBA is numerically UNCHANGED by v1.5 — none of the NBA wins were
    # validated on WNBA pairs.
    assert wnba["recency_decay"] == 0.5
    assert wnba["mpg_conf_frac"] == 0.40 and wnba["rate_conf_frac"] == 0.25
    assert wnba["minutes_model"] is False
    assert mm.BLEND_LAMBDA == 0.5 and mm.RIDGE_ALPHA == 10.0
