"""Unit tests for the season model's small-sample shrinkage
(season_project.league_rate_priors / shrink_to_priors, and the sample_games
evidence weighted_projection now carries).

Pure-function tests — no DB. They pin the property the 2026-08 fix exists for:
a 12-game late-season run must NOT project as a full-season role (Cormac Ryan:
12 GP @ 24.1 mpg / 14.2 pts → was projected 24.1 min), while a full-sample
starter's projection passes through byte-identical.
Run: `cd projections && python -m pytest`.
"""
import os
import sys

import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import season_project as sp  # noqa: E402

NBA_GAMES = 82


def hist_row(season, games, mpg, pts36=15.0, **rates):
    row = {"season": season, "games_played": games, "mpg": mpg,
           "pts_per36": pts36}
    for s in sp.RATE_STATS:
        row.setdefault(f"{s}_per36", rates.get(f"{s}_per36", 5.0))
    return row


def priors_frame():
    # Two archetypes: a heavy-minutes starter pool and a bench pool. The
    # minute-weighted rate prior should sit closer to the starters.
    return pd.DataFrame([
        hist_row(2025, 75, 32.0, pts36=20.0),
        hist_row(2025, 75, 30.0, pts36=18.0),
        hist_row(2025, 20, 12.0, pts36=10.0),
        hist_row(2025, 20, 10.0, pts36=8.0),
    ])


# ── league_rate_priors ───────────────────────────────────────────────────────

def test_priors_rates_are_minute_weighted():
    p = sp.league_rate_priors(priors_frame())
    plain_mean = (20.0 + 18.0 + 10.0 + 8.0) / 4
    assert p["pts_per36"] > plain_mean  # starters carry more minutes
    assert p["mpg"] == pytest.approx((32 + 30 + 12 + 10) / 4)  # MPG is plain mean


# ── weighted_projection: sample_games evidence ───────────────────────────────

def test_sample_games_is_recency_weighted_sum():
    sp.SEASON_WEIGHTS = {2024: 0.5, 2025: 1.0}
    sp.MAX_TEAM_GAMES = {2024: 82, 2025: 82}
    hist = pd.DataFrame([hist_row(2024, 60, 30.0), hist_row(2025, 60, 30.0)])
    proj = sp.weighted_projection(hist)
    # Weighted SUM (not mean): 0.5·60 + 1.0·60 = 90. The mean (60) would say
    # two 60-game seasons are no more evidence than one — the sum accumulates.
    assert proj["sample_games"] == pytest.approx(90.0)
    assert proj["sample_games"] > 60.0


# ── shrink_to_priors ─────────────────────────────────────────────────────────

def test_full_sample_player_is_untouched():
    priors = sp.league_rate_priors(priors_frame())
    proj = {"mpg": 34.0, "gp_pct": 0.9, "sample_games": 75.0,
            **{f"{s}_per36": 22.0 for s in sp.RATE_STATS}}
    out = sp.shrink_to_priors(proj, priors, NBA_GAMES)
    assert out["mpg"] == pytest.approx(34.0)          # ≥ 41 evidence games → w=1
    assert out["pts_per36"] == pytest.approx(22.0)


def test_thin_sample_minutes_regress_toward_replacement():
    priors = sp.league_rate_priors(priors_frame())
    # The Cormac Ryan shape: 12 games of 24 mpg.
    proj = {"mpg": 24.0, "gp_pct": 0.3, "sample_games": 12.0,
            **{f"{s}_per36": 21.0 for s in sp.RATE_STATS}}
    out = sp.shrink_to_priors(proj, priors, NBA_GAMES)
    replacement = priors["mpg"] * sp.REPLACEMENT_MPG_FRAC
    assert out["mpg"] < 24.0
    assert out["mpg"] > replacement          # not flattened all the way either
    # w = 12/41 ≈ 0.29 → most of the projection is the replacement prior.
    w = 12.0 / (NBA_GAMES * sp.MPG_FULL_CONF_FRAC)
    assert out["mpg"] == pytest.approx(w * 24.0 + (1 - w) * replacement)


def test_thin_sample_rates_regress_symmetrically():
    priors = sp.league_rate_priors(priors_frame())
    hot = {"mpg": 20.0, "gp_pct": 0.3, "sample_games": 8.0,
           **{f"{s}_per36": 30.0 for s in sp.RATE_STATS}}
    cold = {"mpg": 20.0, "gp_pct": 0.3, "sample_games": 8.0,
            **{f"{s}_per36": 2.0 for s in sp.RATE_STATS}}
    hot_out = sp.shrink_to_priors(hot, priors, NBA_GAMES)
    cold_out = sp.shrink_to_priors(cold, priors, NBA_GAMES)
    assert hot_out["pts_per36"] < 30.0   # hot sample pulled down…
    assert cold_out["pts_per36"] > 2.0   # …cold sample pulled up

def test_zero_evidence_lands_on_the_prior():
    priors = sp.league_rate_priors(priors_frame())
    proj = {"mpg": 33.0, "gp_pct": 0.5, "sample_games": 0.0,
            **{f"{s}_per36": 25.0 for s in sp.RATE_STATS}}
    out = sp.shrink_to_priors(proj, priors, NBA_GAMES)
    assert out["mpg"] == pytest.approx(priors["mpg"] * sp.REPLACEMENT_MPG_FRAC)
    assert out["pts_per36"] == pytest.approx(priors["pts_per36"])


def test_fg3a_is_projected():
    """Regression: fg3a was absent from RATE_STATS while franchise_edge.STATS
    (next_game) had it, so every season projection ever written had proj_3pa
    NULL and leagues weighting 3PA lost the penalty entirely — Curry projected
    52.8 fpts against a 41.5 actual on an otherwise identical line."""
    assert "fg3a" in sp.RATE_STATS
    proj = {"mpg": 36.0, "gp_pct": 0.9, "sample_games": 75.0,
            **{f"{s}_per36": 11.0 for s in sp.RATE_STATS}}
    assert sp.to_per_game(proj)["proj_fg3a"] == pytest.approx(11.0)


def test_minutes_ramp_later_than_rates():
    # At an evidence level between the two thresholds, rates are fully trusted
    # while minutes are still partly shrunk — role needs the bigger sample.
    priors = sp.league_rate_priors(priors_frame())
    n = NBA_GAMES * sp.RATE_FULL_CONF_FRAC + 1  # ≈ 25.6 games
    proj = {"mpg": 30.0, "gp_pct": 0.5, "sample_games": n,
            **{f"{s}_per36": 25.0 for s in sp.RATE_STATS}}
    out = sp.shrink_to_priors(proj, priors, NBA_GAMES)
    assert out["pts_per36"] == pytest.approx(25.0)  # rate ramp done
    assert out["mpg"] < 30.0                        # minutes ramp isn't
