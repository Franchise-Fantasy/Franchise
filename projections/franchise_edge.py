"""
franchise_edge.py — the original engine's PRODUCTION projector, imported into
Franchise.
========================================================================
This is a faithful copy of the source engine's `edge.py` projection
(`get_player_distributions`) — the model that actually shipped. The original
labeled the hierarchical Bayesian model (`project.py`) a "future swap-in"; the
working projector was this empirical one:

  - per-stat (mean, sd) from the player's OWN game logs;
  - the in-progress season blended toward the last completed season by sample
    size: w = n_curr / (n_curr + K), K=5 — ~50/50 at 5 current games, current-
    dominant by midseason (keeps thin early-season samples honest);
  - each stat scaled by a recent-minutes factor (recent mins ÷ blended-baseline
    mins, clamped) to catch role changes.

No archetype clustering, no hierarchical cross-player regression — each player
is anchored to their own production, so stars are never dragged toward a cluster
mean and breakouts are tracked.

The blend math, constants and minutes factor are copied verbatim from edge.py.
Only two things change: the data source is Franchise `player_games` (sport-
scoped, UUID player_id) instead of the engine's `game_player_stats`, and the
stat list is extended from edge.py's 4 prop stats to the full fantasy set (same
blend per stat). The original's betting math (edge/EV/de-vig) is NOT ported.
"""
import math

# ── edge.py constants (verbatim) ─────────────────────────────────────────────
MIN_MINUTES       = 5.0
MIN_GAMES         = 8     # prior season: enough games for a stable mean/sd
MIN_GAMES_CURRENT = 1     # current season counts from game 1 (thin → shrunk)
PRIOR_SHRINKAGE_K = 5.0   # games of weight given to the prior season in the blend
RECENT_GAMES_K    = 5
MIN_FACTOR_LO     = 0.65
MIN_FACTOR_HI     = 1.35

# edge.py projected pts/reb/ast/fg3m (the prop stats). Fantasy scoring needs the
# full set; the blend is identical per stat. fg3m/fg3a are Franchise "3pm"/"3pa"
# (mapped to proj_3pm/proj_3pa on write).
STATS = ["pts", "reb", "ast", "stl", "blk", "tov", "fg3m", "fg3a",
         "fgm", "fga", "ftm", "fta"]


def _f(v):
    return float(v) if v is not None else 0.0


def _sd(sd, mean):
    """Guard against null/zero SD: floor at a Poisson-like sqrt(mean). Verbatim."""
    sd = float(sd) if sd is not None else 0.0
    floor = math.sqrt(max(_f(mean), 0.5))
    return max(sd, floor, 0.5)


def _blend_stat(curr, prior, n_curr, k=PRIOR_SHRINKAGE_K):
    """Shrink a current-season (mean, sd) toward the prior-season (mean, sd).
    Weight on current = n_curr / (n_curr + k); variance blended the same way so
    a thin current sample inherits some of the prior's spread. Verbatim edge.py."""
    if prior is None:
        return curr            # rookie / no prior → current is all we have
    if curr is None:
        return prior           # hasn't played yet → fall back to prior
    w = n_curr / (n_curr + k)
    m = w * curr[0] + (1.0 - w) * prior[0]
    var = w * (curr[1] ** 2) + (1.0 - w) * (prior[1] ** 2)
    return (m, _sd(math.sqrt(var), m))


def _season_distributions(conn, sport: str, season: int, min_games: int) -> dict:
    """Raw per-stat (mean, sd) from one season's game logs, per player.
    { player_id: { 'pts': (mean, sd), ..., '_n': n, '_min': mpg } }.
    Reads Franchise player_games; mirrors edge.py._season_distributions."""
    sql = """
        SELECT pg.player_id,
               COUNT(*)                                          AS n,
               AVG(COALESCE(pg.pts ,0)) AS pts_mean,  STDDEV_SAMP(COALESCE(pg.pts ,0)) AS pts_sd,
               AVG(COALESCE(pg.reb ,0)) AS reb_mean,  STDDEV_SAMP(COALESCE(pg.reb ,0)) AS reb_sd,
               AVG(COALESCE(pg.ast ,0)) AS ast_mean,  STDDEV_SAMP(COALESCE(pg.ast ,0)) AS ast_sd,
               AVG(COALESCE(pg.stl ,0)) AS stl_mean,  STDDEV_SAMP(COALESCE(pg.stl ,0)) AS stl_sd,
               AVG(COALESCE(pg.blk ,0)) AS blk_mean,  STDDEV_SAMP(COALESCE(pg.blk ,0)) AS blk_sd,
               AVG(COALESCE(pg.tov ,0)) AS tov_mean,  STDDEV_SAMP(COALESCE(pg.tov ,0)) AS tov_sd,
               AVG(COALESCE(pg."3pm",0)) AS fg3m_mean, STDDEV_SAMP(COALESCE(pg."3pm",0)) AS fg3m_sd,
               AVG(COALESCE(pg."3pa",0)) AS fg3a_mean, STDDEV_SAMP(COALESCE(pg."3pa",0)) AS fg3a_sd,
               AVG(COALESCE(pg.fgm ,0)) AS fgm_mean,  STDDEV_SAMP(COALESCE(pg.fgm ,0)) AS fgm_sd,
               AVG(COALESCE(pg.fga ,0)) AS fga_mean,  STDDEV_SAMP(COALESCE(pg.fga ,0)) AS fga_sd,
               AVG(COALESCE(pg.ftm ,0)) AS ftm_mean,  STDDEV_SAMP(COALESCE(pg.ftm ,0)) AS ftm_sd,
               AVG(COALESCE(pg.fta ,0)) AS fta_mean,  STDDEV_SAMP(COALESCE(pg.fta ,0)) AS fta_sd,
               AVG(COALESCE(pg.min ,0)) AS min_mean
        FROM player_games pg
        WHERE pg.sport = %s
          AND EXTRACT(YEAR FROM pg.game_date) = %s
          AND pg.min >= %s
        GROUP BY pg.player_id
        HAVING COUNT(*) >= %s
    """
    out = {}
    with conn.cursor() as cur:
        cur.execute(sql, (sport, season, MIN_MINUTES, min_games))
        colnames = [c[0] for c in cur.description]
        for row in cur.fetchall():
            rec = dict(zip(colnames, row))
            d = {"_n": int(rec["n"]), "_min": _f(rec["min_mean"])}
            for s in STATS:
                d[s] = (_f(rec[f"{s}_mean"]), _sd(rec[f"{s}_sd"], rec[f"{s}_mean"]))
            out[rec["player_id"]] = d
    return out


def _recent_minutes(conn, sport: str, season: int, k: int) -> dict:
    """Average minutes over each player's most recent `k` games this season.
    Mirrors edge.py._recent_minutes."""
    sql = """
        WITH ranked AS (
            SELECT pg.player_id, pg.min AS min_played,
                   ROW_NUMBER() OVER (PARTITION BY pg.player_id
                                      ORDER BY pg.game_date DESC) AS rn
            FROM player_games pg
            WHERE pg.sport = %s AND EXTRACT(YEAR FROM pg.game_date) = %s
              AND pg.min >= %s
        )
        SELECT player_id, AVG(min_played) FROM ranked WHERE rn <= %s GROUP BY player_id
    """
    out = {}
    with conn.cursor() as cur:
        cur.execute(sql, (sport, season, MIN_MINUTES, k))
        for pid, am in cur.fetchall():
            out[pid] = _f(am)
    return out


def get_player_distributions(conn, sport: str, season: int) -> dict:
    """Per-player per-stat (mean, sd), blending the in-progress `season` toward
    the prior completed season via sample-size shrinkage, scaled by a recent-
    minutes factor. Exact port of edge.py.get_player_distributions.

    Each player dict carries provenance: _n (current games), _n_prior, _basis
    ∈ {'blend','current_only','prior_only'}, _proj_min, _base_min, _min_factor.
    """
    prior = _season_distributions(conn, sport, season - 1, MIN_GAMES)
    curr = _season_distributions(conn, sport, season, MIN_GAMES_CURRENT)
    recent_min = _recent_minutes(conn, sport, season, RECENT_GAMES_K)

    out = {}
    for pid in set(prior) | set(curr):
        c = curr.get(pid)
        p = prior.get(pid)
        if c and p:
            basis, n_c = "blend", c["_n"]
        elif c:
            basis, n_c = "current_only", c["_n"]
        else:
            basis, n_c = "prior_only", 0

        # Blended season minutes (same shrinkage as the stats).
        cm = (c or {}).get("_min")
        pm = (p or {}).get("_min")
        if cm and pm:
            w = n_c / (n_c + PRIOR_SHRINKAGE_K)
            base_min = w * cm + (1.0 - w) * pm
        else:
            base_min = cm or pm or 0.0

        # Minutes factor: recent (current-season) minutes vs blended baseline.
        proj_min = recent_min.get(pid) or base_min
        if base_min > 0 and proj_min > 0:
            factor = min(MIN_FACTOR_HI, max(MIN_FACTOR_LO, proj_min / base_min))
        else:
            factor = 1.0

        rec = {"_n": (c or {}).get("_n", 0),
               "_n_prior": (p or {}).get("_n", 0),
               "_basis": basis,
               "_min_factor": round(factor, 3),
               "_proj_min": round(proj_min, 1),
               "_base_min": round(base_min, 1)}
        for s in STATS:
            m, sd = _blend_stat((c or {}).get(s), (p or {}).get(s), n_c)
            rec[s] = (m * factor, sd * factor)   # rate × minutes, via scaling
        out[pid] = rec
    return out


# ── Absence redistribution (port of dashboard.py.compute_absence_boosts) ─────
INJ_ABSENCE_CAP = 1.40   # max 40% stat boost from teammate absences (verbatim)

# Fade window (games). This is the ONE deliberate divergence from the source's
# verbatim boost. The source assumed a health-agnostic base rate, but this port's
# base is each player's RECENT minutes — which already reflect the current injury
# environment. An Out teammate whose absence already spans the recent-minutes
# window is therefore baked into the active players' recent minutes; re-crediting
# those minutes double-counts and inflates every teammate's projection. So an Out
# player's redistribution weight decays linearly from 1.0 (fresh scratch, played
# the team's last game) to 0.0 once their absence spans this many team games.
# Aligned with RECENT_GAMES_K so the boost only ever adds minutes the recent
# baseline has NOT already absorbed.
ABSENCE_FADE_GAMES = RECENT_GAMES_K   # 5


def absence_freshness_weight(games_missed: float) -> float:
    """Linear fade in [0, 1]: 1.0 for a fresh scratch (0 team games missed since
    the player last appeared), decaying to 0.0 once the absence spans
    ABSENCE_FADE_GAMES team games (by which point the recent-minutes baseline has
    fully absorbed it). See ABSENCE_FADE_GAMES for the why."""
    return max(0.0, 1.0 - games_missed / ABSENCE_FADE_GAMES)


def compute_absence_boosts(out_ids, dists: dict, player_teams: dict,
                           player_names: dict, games_missed: dict = None) -> dict:
    """Redistribute projected minutes from Out players to their active teammates,
    weighted by each teammate's current minute share, into a capped multiplicative
    factor. Port of dashboard.py.compute_absence_boosts (the injuries arg is
    adapted to a set of Out player_ids). Multiple Out teammates stack.

    `games_missed` (player_id -> team games already missed) fades each Out
    player's contribution via absence_freshness_weight so a long-standing absence
    already reflected in teammates' recent minutes isn't double-counted. Pass None
    (the pure unit tests do) for the source's full-weight behavior.

    Returns {player_id: {'extra_min', 'factor', 'factor_pct', 'caused_by'}}.
    """
    out_ids = set(out_ids)

    # Active-player minute map per team (Out players excluded).
    team_active: dict = {}
    for pid, d in dists.items():
        tid = player_teams.get(pid)
        if not tid or pid in out_ids:
            continue
        pm = d.get("_proj_min", 0.0)
        if pm > 0:
            team_active.setdefault(tid, {})[pid] = pm

    # Accumulate raw extra-minute credits on active teammates.
    raw: dict = {}
    for pid in out_ids:
        d = dists.get(pid)
        if not d:
            continue
        out_min = d.get("_proj_min", 0.0)
        if out_min < 5.0:          # ignore bench players with negligible minutes
            continue
        # Fade by recency so an already-absorbed absence isn't re-credited. Absent
        # from the map → treated as fully faded (weight 0), a safe default that
        # can only under-boost, never double-count.
        if games_missed is not None:
            out_min *= absence_freshness_weight(games_missed.get(pid, ABSENCE_FADE_GAMES))
            if out_min <= 0.0:
                continue
        tid = player_teams.get(pid)
        if not tid:
            continue
        teammates = team_active.get(tid, {})
        total = sum(teammates.values())
        if total <= 0:
            continue
        name = player_names.get(pid) or f"#{pid}"
        for tpid, tmin in teammates.items():
            share = tmin / total
            b = raw.setdefault(tpid, {"extra_min": 0.0, "caused_by": []})
            b["extra_min"] += out_min * share
            b["caused_by"].append(name)

    # Convert to capped factors.
    boosts: dict = {}
    for pid, b in raw.items():
        base_min = dists.get(pid, {}).get("_proj_min", 0.0)
        if base_min <= 0:
            continue
        factor = min(INJ_ABSENCE_CAP, (base_min + b["extra_min"]) / base_min)
        boosts[pid] = {"extra_min": round(b["extra_min"], 1),
                       "factor": round(factor, 3),
                       "factor_pct": round((factor - 1.0) * 100, 1),
                       "caused_by": b["caused_by"]}
    return boosts


def apply_absence_boosts(dists: dict, boosts: dict) -> None:
    """Apply each boost factor to ALL projected stats AND projected minutes in
    place. Minutes redistribution flows through every box-score stat
    proportionally — the source scaled its 4 prop stats; we scale the full
    fantasy set plus `_proj_min`, so the displayed minutes stay consistent with
    the boosted line (a small, intentional improvement over the source, which
    left _proj_min unscaled). Scaling both keeps the implied per-minute rate
    unchanged — i.e. the boost is modeled as pure extra minutes."""
    for pid, boost in boosts.items():
        d = dists.get(pid)
        if not d:
            continue
        f = boost["factor"]
        for s in STATS:
            m, sd = d[s]
            d[s] = (m * f, sd * f)
        d["_proj_min"] = round(d.get("_proj_min", 0.0) * f, 1)
        d["_absence_boost"] = boost
