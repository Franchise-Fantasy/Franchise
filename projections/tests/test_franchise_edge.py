"""Unit tests for the ported edge.py projector (franchise_edge.py).

Pure-function tests — no DB. They guard the blend math + absence redistribution
against drift from the original engine. Run: `cd projections && python -m pytest`.
"""
import math
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import franchise_edge as fe  # noqa: E402


# ── _blend_stat ──────────────────────────────────────────────────────────────

def test_blend_prior_only():
    # No current sample → fall back to the prior season verbatim.
    assert fe._blend_stat(None, (20.0, 5.0), 0) == (20.0, 5.0)


def test_blend_current_only():
    # No prior → current is all we have.
    assert fe._blend_stat((18.0, 4.0), None, 6) == (18.0, 4.0)


def test_blend_weight_5050_at_k_games():
    # n_curr == K → exactly 50/50 on the mean.
    m, _ = fe._blend_stat((20.0, 4.0), (10.0, 4.0), fe.PRIOR_SHRINKAGE_K)
    assert m == pytest.approx(15.0)


def test_blend_current_dominates_with_many_games():
    # 45 current games → w = 45/50 = 0.9, mean pulls toward current.
    m, _ = fe._blend_stat((20.0, 4.0), (10.0, 4.0), 45)
    assert m == pytest.approx(0.9 * 20 + 0.1 * 10)


def test_sd_floor():
    assert fe._sd(0.0, 16.0) == 4.0                       # floored at sqrt(mean)
    assert fe._sd(0.1, 0.0) == pytest.approx(math.sqrt(0.5))  # floor sqrt(max(mean,0.5))
    assert fe._sd(9.0, 4.0) == 9.0                        # passes through above the floor


# ── absence redistribution ───────────────────────────────────────────────────

def _dist(proj_min, pts_mean):
    """Minimal dist dict carrying the keys compute/apply touch."""
    d = {"_proj_min": proj_min}
    for s in fe.STATS:
        d[s] = (pts_mean if s == "pts" else 1.0, 1.0)
    return d


def test_absence_redistributes_by_minute_share_and_caps():
    dists = {
        "out": _dist(30.0, 20.0),   # OUT — 30 min to redistribute
        "a":   _dist(30.0, 15.0),   # active, 3/4 of active minutes
        "b":   _dist(10.0, 5.0),    # active, 1/4
    }
    teams = {"out": "X", "a": "X", "b": "X"}
    boosts = fe.compute_absence_boosts({"out"}, dists, teams, {})
    # Both would exceed +40% → capped.
    assert boosts["a"]["factor"] == fe.INJ_ABSENCE_CAP
    assert boosts["b"]["factor"] == fe.INJ_ABSENCE_CAP


def test_absence_small_boost_uncapped_exact():
    dists = {"out": _dist(10.0, 8.0), "a": _dist(30.0, 15.0), "b": _dist(30.0, 15.0)}
    teams = {"out": "X", "a": "X", "b": "X"}
    boosts = fe.compute_absence_boosts({"out"}, dists, teams, {})
    # a absorbs 10 * 30/60 = 5 over base 30 → 35/30.
    assert boosts["a"]["factor"] == pytest.approx(round(35.0 / 30.0, 3))


def test_absence_low_minute_out_player_ignored():
    dists = {"out": _dist(4.0, 2.0), "a": _dist(30.0, 15.0)}
    teams = {"out": "X", "a": "X"}
    boosts = fe.compute_absence_boosts({"out"}, dists, teams, {})
    assert "a" not in boosts          # <5 proj_min out player contributes nothing


def test_absence_other_team_unaffected():
    dists = {"out": _dist(30.0, 20.0), "a": _dist(30.0, 15.0), "z": _dist(30.0, 15.0)}
    teams = {"out": "X", "a": "X", "z": "Y"}
    boosts = fe.compute_absence_boosts({"out"}, dists, teams, {})
    assert "z" not in boosts          # different team


def test_absence_multiple_out_stack():
    # One out → the still-active teammate shares the load; both out → the lone
    # survivor absorbs everything. More absences = a bigger boost (they stack).
    dists = {"o1": _dist(20.0, 10.0), "o2": _dist(20.0, 10.0), "a": _dist(30.0, 15.0)}
    teams = {"o1": "X", "o2": "X", "a": "X"}
    one = fe.compute_absence_boosts({"o1"}, dists, teams, {})["a"]["extra_min"]
    two = fe.compute_absence_boosts({"o1", "o2"}, dists, teams, {})["a"]["extra_min"]
    assert two > one


# ── absence freshness fade (games_missed gating) ─────────────────────────────

def test_freshness_weight_bounds():
    assert fe.absence_freshness_weight(0) == 1.0                        # fresh scratch
    assert fe.absence_freshness_weight(fe.ABSENCE_FADE_GAMES) == 0.0    # fully absorbed
    assert fe.absence_freshness_weight(fe.ABSENCE_FADE_GAMES + 3) == 0.0  # clamped, not negative
    assert fe.absence_freshness_weight(fe.ABSENCE_FADE_GAMES / 2) == pytest.approx(0.5)


def test_absence_fade_zero_for_fully_absorbed_out_player():
    # Absence spanning the whole window → weight 0 → no boost at all (its minutes
    # are already in the active players' recent baseline).
    dists = {"out": _dist(30.0, 20.0), "a": _dist(30.0, 15.0)}
    teams = {"out": "X", "a": "X"}
    boosts = fe.compute_absence_boosts({"out"}, dists, teams, {},
                                       {"out": fe.ABSENCE_FADE_GAMES})
    assert "a" not in boosts


def test_absence_fade_partial_scales_extra_min():
    # games_missed at half the window → the Out player's minutes credited at ~50%.
    dists = {"out": _dist(10.0, 8.0), "a": _dist(30.0, 15.0), "b": _dist(30.0, 15.0)}
    teams = {"out": "X", "a": "X", "b": "X"}
    full = fe.compute_absence_boosts({"out"}, dists, teams, {})["a"]["extra_min"]
    faded = fe.compute_absence_boosts({"out"}, dists, teams, {},
                                      {"out": fe.ABSENCE_FADE_GAMES / 2})["a"]["extra_min"]
    assert faded == pytest.approx(full * 0.5)


def test_absence_fade_fresh_scratch_matches_full_weight():
    # games_missed 0 (played the team's last game) → identical to the ungated boost.
    dists = {"out": _dist(10.0, 8.0), "a": _dist(30.0, 15.0), "b": _dist(30.0, 15.0)}
    teams = {"out": "X", "a": "X", "b": "X"}
    full = fe.compute_absence_boosts({"out"}, dists, teams, {})["a"]["factor"]
    fresh = fe.compute_absence_boosts({"out"}, dists, teams, {},
                                      {"out": 0})["a"]["factor"]
    assert fresh == pytest.approx(full)


def test_absence_fade_missing_from_map_defaults_to_faded():
    # An Out player absent from the games_missed map is treated as fully faded
    # (defensive: unknown recency can only under-boost, never double-count).
    dists = {"out": _dist(30.0, 20.0), "a": _dist(30.0, 15.0)}
    teams = {"out": "X", "a": "X"}
    boosts = fe.compute_absence_boosts({"out"}, dists, teams, {}, {})  # empty map
    assert "a" not in boosts


def test_apply_scales_stats_and_minutes():
    dists = {"a": _dist(30.0, 20.0)}
    fe.apply_absence_boosts(dists, {"a": {"factor": 1.2}})
    assert dists["a"]["pts"][0] == pytest.approx(24.0)     # 20 * 1.2
    assert dists["a"]["_proj_min"] == pytest.approx(36.0)  # 30 * 1.2 — fix #4
    assert dists["a"]["_absence_boost"] == {"factor": 1.2}
