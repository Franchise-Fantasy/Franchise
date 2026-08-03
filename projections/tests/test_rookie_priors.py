"""Tests for rookie_priors.py (franchise-v1.6). The accuracy evidence lives in
the lab backtest (5.1-6.5 MAE LFO per class); what these pin is the contract:
rookie identification, bucket edges, the trust gate, the undrafted fallback,
and per-sport gating.

Run: `cd projections && python -m pytest`.
"""
import os
import sys

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import rookie_priors as rp  # noqa: E402


def hist(rookie_specs, season=2024, season_len=82):
    """Build a history frame where each spec is (pid, mpg); every player is a
    rookie of `season` (draft_year == season set by the caller's maps)."""
    rows = []
    for pid, mpg in rookie_specs:
        row = {"player_id": pid, "season": season, "games_played": 60,
               "mpg": mpg}
        for s in rp.RATE_STATS:
            row[f"{s}_per36"] = 10.0
        rows.append(row)
    # one veteran season so max games (schedule proxy) is realistic
    rows.append({"player_id": "vet", "season": season, "games_played": season_len,
                 "mpg": 30.0, **{f"{s}_per36": 10.0 for s in rp.RATE_STATS}})
    return pd.DataFrame(rows)


# ── bucket_of ────────────────────────────────────────────────────────────────

def test_bucket_edges():
    assert rp.bucket_of(1) == "1-3" and rp.bucket_of(3) == "1-3"
    assert rp.bucket_of(4) == "4-10" and rp.bucket_of(10) == "4-10"
    assert rp.bucket_of(11) == "11-20" and rp.bucket_of(20) == "11-20"
    assert rp.bucket_of(21) == "21-30" and rp.bucket_of(30) == "21-30"
    assert rp.bucket_of(31) == "r2" and rp.bucket_of(60) == "r2"
    assert rp.bucket_of(None) == rp.UNDRAFTED_BUCKET
    assert rp.bucket_of(float("nan")) == rp.UNDRAFTED_BUCKET


# ── fit_priors ───────────────────────────────────────────────────────────────

def test_only_rookie_seasons_enter_the_prior():
    """A player-season counts only when season == the player's draft_year —
    the vet row and a sophomore row must not leak in."""
    n = rp.MIN_BUCKET_N
    specs = [(f"r{i}", 20.0) for i in range(n)]
    frame = hist(specs)
    soph = frame[frame.player_id == "r0"].assign(season=2025, mpg=35.0)
    frame = pd.concat([frame, soph])
    draft_years = {f"r{i}": 2024 for i in range(n)}          # vet: absent
    slots = {f"r{i}": 5 for i in range(n)}                   # all picks 4-10
    pri = rp.fit_priors(frame, draft_years, slots)
    assert list(pri.index) == ["4-10"]
    assert pri.loc["4-10", "mpg"] == pytest.approx(20.0)     # 35-mpg soph excluded
    assert pri.loc["4-10", "n"] == n


def test_min_bucket_n_gate():
    specs = [(f"r{i}", 20.0) for i in range(rp.MIN_BUCKET_N - 1)]
    pri = rp.fit_priors(hist(specs),
                        {p: 2024 for p, _ in specs},
                        {p: 5 for p, _ in specs})
    assert pri.empty                        # too few — trust nothing
    assert rp.project_rookie(pri, 5, 82) is None


def test_empty_history():
    assert rp.fit_priors(pd.DataFrame(), {}, {}).empty


# ── project_rookie ───────────────────────────────────────────────────────────

def prior_fixture():
    n = rp.MIN_BUCKET_N
    specs = [(f"a{i}", 30.0) for i in range(n)] + \
            [(f"b{i}", 12.0) for i in range(n)]
    dy = {p: 2024 for p, _ in specs}
    slots = {**{f"a{i}": 2 for i in range(n)},
             **{f"b{i}": 45 for i in range(n)}}
    return rp.fit_priors(hist(specs), dy, slots)


def test_projection_shape_and_scaling():
    pri = prior_fixture()
    row = rp.project_rookie(pri, 1, 82)
    assert row["proj_min"] == pytest.approx(30.0)
    # per-game = per-36 x mpg/36; rates were 10.0 across the board
    assert row["proj_pts"] == pytest.approx(10.0 * 30.0 / 36.0, abs=0.01)
    assert set(f"proj_{s}" for s in rp.RATE_STATS) <= set(row)
    assert 1 <= row["projected_games"] <= 82
    # gp: 60 games in an 82-game proxy season -> ~60 projected of 82
    assert row["projected_games"] == round(60 / 82 * 82)


def test_slot_gradient_and_undrafted_fallback():
    pri = prior_fixture()
    top = rp.project_rookie(pri, 2, 82)
    late = rp.project_rookie(pri, 45, 82)
    undrafted = rp.project_rookie(pri, None, 82)
    assert top["proj_min"] > late["proj_min"]
    assert undrafted == late                # undrafted -> round-2 prior


# ── per-sport config gate ────────────────────────────────────────────────────

def test_rookie_priors_sport_gate():
    import ast

    src = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "franchise_project.py")
    params = next(
        ast.literal_eval(n.value) for n in ast.parse(open(src).read()).body
        if isinstance(n, ast.Assign)
        and any(getattr(t, "id", None) == "SPORT_SEASON_PARAMS"
                for t in n.targets))
    assert params["nba"]["rookie_priors"] is True
    # WNBA off ONLY because BDL has no WNBA draft fields — flipping this
    # requires seeding players.draft_number for WNBA first.
    assert params["wnba"]["rookie_priors"] is False
