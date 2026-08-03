"""
rookie_priors.py — draft-slot priors for incoming rookies (season horizon).
========================================================================
Rookies were the season snapshot's biggest COVERAGE hole: candidates come from
"played last season", so every rookie was simply absent from the projection
table — invisible on the draft board and the free-agent wire (15-20 of each
season's actual top-100 in the worst WNBA years; Cooper Flagg in the NBA).

The fix is the industry-standard zero-budget one (Pelton: draft slot + position
beats college-stats models; even DARKO punts on rookies): project each rookie
from what PAST rookies drafted in the same slot range actually did. Measured
on our own 2019-2025 NBA classes (423 rookie seasons), slot is strongly
predictive of role — picks 1-3 median 30.7 mpg / 30.4 chewers fpg vs round 2's
11.8 / 10.6, spearman(pick, fpg) = -0.52 — and a leave-future-out slot-prior
backtest scores 5.1-6.5 MAE, veteran-model-grade, against ~16 MAE for
projecting them as nothing (the previous behavior). What slot CANNOT do is
order rookies within a class (spearman 0.13-0.47): a pick-13 breakout will be
under-projected until real games arrive. That is the accepted cost.

Priors are computed at run time from the caller-supplied history frame, so
they are leave-future-out by construction (past classes only) and improve
every year as classes accumulate. Pure module — no DB access.
"""
import numpy as np
import pandas as pd

RATE_STATS = ["pts", "reb", "ast", "stl", "blk", "tov", "fg3m", "fg3a",
              "fgm", "fga", "ftm", "fta"]

# Slot buckets: wide enough that each holds 20+ historical rookie seasons,
# narrow enough to preserve the monotone role gradient the data shows.
BUCKETS = [(1, 3, "1-3"), (4, 10, "4-10"), (11, 20, "11-20"),
           (21, 30, "21-30"), (31, 300, "r2")]
# Rostered-but-undrafted rookies get the round-2 prior: the empirical
# undrafted median (14.0 fpg) is conditioned on having APPEARED, which
# over-projects the fringe of the group; round 2's line is the conservative
# neighbor. Documented approximation, not a fit.
UNDRAFTED_BUCKET = "r2"

# A bucket prior is trusted only with this many historical rookie seasons
# behind it; below that (early WNBA path, tiny buckets) the rookie is skipped
# rather than projected from noise.
MIN_BUCKET_N = 12


def bucket_of(draft_number):
    if draft_number is None or (isinstance(draft_number, float)
                                and np.isnan(draft_number)):
        return UNDRAFTED_BUCKET
    for lo, hi, name in BUCKETS:
        if lo <= draft_number <= hi:
            return name
    return UNDRAFTED_BUCKET


def fit_priors(hist: pd.DataFrame, draft_years: dict,
               draft_numbers: dict) -> pd.DataFrame:
    """Bucket -> median rookie-year line, from past classes only.

    `hist` is per-player-season (fetch_player_seasons shape: games_played,
    mpg, <stat>_per36) covering as many completed seasons as retained; a row
    is a ROOKIE season when its season == the player's draft_year. Returns a
    frame indexed by bucket with mpg, gp_pct and the 12 per-36 medians.
    gp_pct uses each season's max games_played as the schedule-length proxy
    (exact enough for a median, and self-contained).
    """
    if hist.empty or "player_id" not in hist.columns:
        return pd.DataFrame()
    h = hist.copy()
    h["draft_year"] = h.player_id.map(draft_years)
    rookies = h[h.season == h.draft_year].copy()
    if rookies.empty:
        return pd.DataFrame()
    season_len = h.groupby("season").games_played.max().clip(lower=40)
    rookies["gp_pct"] = (rookies.games_played
                         / rookies.season.map(season_len)).clip(upper=1.0)
    rookies["bucket"] = rookies.player_id.map(draft_numbers).map(bucket_of)

    cols = ["mpg", "gp_pct"] + [f"{s}_per36" for s in RATE_STATS]
    pri = rookies.groupby("bucket")[cols].median()
    pri["n"] = rookies.groupby("bucket").size()
    return pri[pri.n >= MIN_BUCKET_N]


def project_rookie(priors: pd.DataFrame, draft_number,
                   project_games: int) -> dict:
    """One rookie's projection row fields (to_per_game shape +
    projected_games), or None when the bucket has no trustworthy prior."""
    bucket = bucket_of(draft_number)
    if priors.empty or bucket not in priors.index:
        return None
    p = priors.loc[bucket]
    mpg = float(p.mpg)
    out = {"proj_min": round(mpg, 1)}
    for s in RATE_STATS:
        out[f"proj_{s}"] = round(float(p[f"{s}_per36"]) * mpg / 36.0, 2)
    games = int(np.clip(round(float(p.gp_pct) * project_games),
                        1, project_games))
    out["projected_games"] = games
    return out
