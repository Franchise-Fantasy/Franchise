"""Tests for the league-blended games-played model and the sport-gated
experience curve (both shipped 2026-08-02, franchise-v1.4).

Both changes came out of a 5-pair held-out backtest rather than reasoning, so
what these tests pin is the CONTRACT each one has to keep — the blend's
direction and bounds, and the fact that the experience gate is a per-sport
config decision rather than a hardcoded constant. The accuracy claims
themselves live in the audit lab, not here; a unit test can't re-derive them.

Run: `cd projections && python -m pytest`.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import season_project as sp  # noqa: E402


@pytest.fixture(autouse=True)
def league_config():
    """A 40-game season with a 0.727 league GP% (the WNBA shape).

    season_project keeps its config in module globals, so this restores them
    afterwards — tests here mutate PROJECT_GAMES and must not leak into any
    other test file that runs in the same session.
    """
    saved = (sp.PROJECT_GAMES, sp.LEAGUE_AVG_GP_PCT)
    sp.PROJECT_GAMES = 40
    sp.LEAGUE_AVG_GP_PCT = 0.727
    yield
    sp.PROJECT_GAMES, sp.LEAGUE_AVG_GP_PCT = saved


# ── project_games_blended ────────────────────────────────────────────────────

def test_blend_sits_between_player_and_league():
    """An iron-man regresses DOWN toward the league mean, a fragile player UP —
    the whole point of the blend, and what the old shrink+injury+trend model
    kept getting wrong by stacking penalties on the fragile side."""
    iron, _ = sp.project_games_blended(1.0)
    fragile, _ = sp.project_games_blended(0.3)
    league, _ = sp.project_games_blended(sp.LEAGUE_AVG_GP_PCT)

    assert fragile < league < iron
    assert iron < sp.PROJECT_GAMES          # never projects a full season
    assert fragile > 0.3 * sp.PROJECT_GAMES  # never projects the raw low mark


def test_league_average_player_is_a_fixed_point():
    games, pct = sp.project_games_blended(sp.LEAGUE_AVG_GP_PCT)
    assert pct == pytest.approx(sp.LEAGUE_AVG_GP_PCT)
    assert games == round(sp.LEAGUE_AVG_GP_PCT * sp.PROJECT_GAMES)


def test_blend_is_the_documented_50_50():
    _, pct = sp.project_games_blended(0.5)
    assert pct == pytest.approx(0.5 * sp.LEAGUE_AVG_GP_PCT + 0.5 * 0.5)
    assert sp.GAMES_LEAGUE_BLEND == 0.5


def test_output_is_clamped_to_a_playable_season():
    """Guards the failure that stranded live drafts before: a games value of 0
    (or one above the schedule) makes downstream season totals meaningless."""
    for gp_pct in (0.0, -1.0, 1.0, 5.0):
        games, _ = sp.project_games_blended(gp_pct)
        assert 1 <= games <= sp.PROJECT_GAMES
        assert isinstance(games, int)


def test_scales_with_season_length():
    """The blend is expressed in GP% precisely so an 82-game NBA season and a
    40-game WNBA one don't need separate constants."""
    sp.PROJECT_GAMES, sp.LEAGUE_AVG_GP_PCT = 82, 0.587
    games, _ = sp.project_games_blended(0.587)
    assert games == round(0.587 * 82)


# ── sport-gated experience curve ─────────────────────────────────────────────

def test_experience_curve_only_boosts_the_young():
    """experience_seasons clamps career length to 5, so the curve has exactly
    two reachable outcomes. If that ever stops being true, the WNBA gate's
    rationale ('this flag is really the young-player boost') needs rewriting."""
    from season_windows import experience_seasons

    reachable = {experience_seasons(2026, 2026 - n, 1) for n in range(0, 25)}
    assert reachable == {1, 2, 3, 4, 5}

    mults = {s: sp.experience_curve({"pts_per36": 10.0}, s)["pts_per36"] / 10.0
             for s in reachable}
    assert mults[1] == pytest.approx(1.10)
    assert mults[2] == pytest.approx(1.10)
    assert all(mults[s] == pytest.approx(1.0) for s in (3, 4, 5))


def test_sport_params_gate_the_curve_per_sport():
    """The gate is config, not a constant: WNBA off, NBA on (backtested).

    Read from the source with `ast` rather than imported — franchise_project
    pulls in franchise_db, which requires PG_DSN at import time, and
    projections-test.yml has no database.
    """
    import ast

    src = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "franchise_project.py")
    tree = ast.parse(open(src).read())
    params = next(
        ast.literal_eval(node.value)
        for node in tree.body
        if isinstance(node, ast.Assign)
        and any(getattr(t, "id", None) == "SPORT_SEASON_PARAMS" for t in node.targets)
    )

    assert params["wnba"]["experience_curve"] is False
    assert params["nba"]["experience_curve"] is True
    for sport in params.values():
        assert "league_avg_gp_pct" in sport and "default_len" in sport
