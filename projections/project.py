"""
Franchise Fantasy: hierarchical Bayesian projection model — v0.2.0

Enhancements over v0.1:
  - Opponent defensive adjustment (from game_team_stats)
  - Home/away and back-to-back effects learned in model
  - Recency-weighted likelihood (60-day half-life exponential decay)
  - Injury-adjusted minutes: excludes "Out", halves "Day-To-Day"
  - Minutes model: recent-N average shrunk toward archetype mean
  - Vegas props blending: 35% weight when market line available (next_game only)
  - Upcoming game context: per-player opponent, venue, schedule

USAGE
-----
    python project.py --league wnba --season 2025 --horizon ros
    python project.py --league wnba --season 2025 --horizon next_game
"""
import os
import argparse
from datetime import date
from typing import Dict, Optional

import numpy as np
import pandas as pd
import pymc as pm
import pytensor.tensor as pt
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

load_dotenv()
PG_DSN = os.environ["PG_DSN"]
MODEL_VERSION = "v0.2.0-bdl-goat"

COUNT_STATS = ["pts", "reb", "ast", "stl", "blk", "tov", "fg3m"]

DEFAULT_FANTASY_WEIGHTS = {
    "pts": 1.0, "reb": 1.2, "ast": 1.5,
    "stl": 3.0, "blk": 3.0, "fg3m": 0.5,
    "tov": -1.0,
}

RECENCY_HALF_LIFE_DAYS = 60   # games 60 days ago weighted at 50%
VEGAS_BLEND_WEIGHT = 0.35     # market line weight for next_game projections
MIN_PROJECTION_GAMES = 5      # player must have this many recent games to project
RECENT_N_GAMES = 10           # window for minutes estimate


# ================================================================
# Data loading
# ================================================================

def load_training_data(conn, league: str, current_season: int,
                       lookback_seasons: int = 3) -> pd.DataFrame:
    """
    Pull box scores from the last N seasons with game context:
    is_home, opp_team_id, and team_id for each observation.
    """
    seasons = tuple(range(current_season - lookback_seasons + 1, current_season + 1))
    q = """
        SELECT gps.player_id, gps.game_id, g.season, g.game_date,
               gps.team_id,
               gps.min_played, gps.pts, gps.reb, gps.ast, gps.stl, gps.blk,
               gps.tov, gps.fg3m, gps.fgm, gps.fga, gps.ftm, gps.fta, gps.fg3a,
               pa.archetype,
               CASE WHEN gps.team_id = g.home_team_id THEN 1 ELSE 0 END AS is_home,
               CASE WHEN gps.team_id = g.home_team_id
                    THEN g.away_team_id ELSE g.home_team_id
               END AS opp_team_id
        FROM game_player_stats gps
        JOIN games g ON g.game_id = gps.game_id AND g.league = gps.league
        LEFT JOIN player_archetypes pa
          ON pa.player_id = gps.player_id
         AND pa.season = g.season
         AND pa.league = gps.league
        WHERE gps.league = %s
          AND g.season IN %s
          AND g.postseason = FALSE
          AND gps.min_played IS NOT NULL
          AND gps.min_played > 0
        ORDER BY gps.player_id, g.game_date
    """
    df = pd.read_sql(q, conn, params=(league, seasons))
    df["archetype"] = df["archetype"].fillna("unclassified")
    df["game_date"] = pd.to_datetime(df["game_date"])
    return df


def compute_opp_factors(conn, league: str, seasons: tuple) -> dict:
    """
    For each (team_id, season), compute how much more/less than league average
    that team allows per game for each counting stat. Factor > 1 = easier matchup.

    Uses game_team_stats: opponent's offensive box score = defense team's allowed.
    """
    q = """
        WITH game_pairs AS (
            SELECT g.season,
                   CASE WHEN gts.team_id = g.home_team_id
                        THEN g.away_team_id ELSE g.home_team_id
                   END AS def_team_id,
                   (2 * gts.fgm + gts.fg3m + gts.ftm) AS pts,
                   gts.reb, gts.ast, gts.stl, gts.blk,
                   gts.turnovers AS tov, gts.fg3m
            FROM game_team_stats gts
            JOIN games g ON g.game_id = gts.game_id AND g.league = gts.league
            WHERE gts.league = %s AND g.season IN %s AND g.postseason = FALSE
        )
        SELECT def_team_id AS team_id, season,
               AVG(pts)  AS avg_pts,  AVG(reb)  AS avg_reb,  AVG(ast)  AS avg_ast,
               AVG(stl)  AS avg_stl,  AVG(blk)  AS avg_blk,  AVG(tov)  AS avg_tov,
               AVG(fg3m) AS avg_fg3m
        FROM game_pairs
        GROUP BY def_team_id, season
    """
    df = pd.read_sql(q, conn, params=(league, seasons))
    if df.empty:
        return {}

    # Normalize each stat by league average so factor = 1.0 is league-average defense
    opp_factors = {}
    for season in df["season"].unique():
        season_df = df[df["season"] == season]
        league_avg = season_df[[f"avg_{s}" for s in COUNT_STATS]].mean()
        for _, row in season_df.iterrows():
            factors = {}
            for stat in COUNT_STATS:
                col = f"avg_{stat}"
                league_val = league_avg[col]
                factors[stat] = float(row[col] / league_val) if league_val > 0 else 1.0
            opp_factors[(int(row["team_id"]), int(season))] = factors

    return opp_factors


def get_injured_players(conn, league: str) -> Dict[int, str]:
    """Returns {player_id: status} for all currently injured players."""
    q = "SELECT player_id, status FROM player_injuries WHERE league = %s"
    df = pd.read_sql(q, conn, params=(league,))
    return {int(r["player_id"]): r["status"] for _, r in df.iterrows()}


def load_upcoming_context(conn, league: str, season: int) -> dict:
    """
    For each player, find their next unplayed game and return:
    {player_id: {game_id, game_date, opp_team_id, is_home, is_b2b}}

    Player → team mapping uses most recent game in game_player_stats.
    B2B flag: player's team played yesterday.
    """
    # Most recent team per player
    team_q = """
        SELECT DISTINCT ON (gps.player_id) gps.player_id, gps.team_id
        FROM game_player_stats gps
        JOIN games g ON g.game_id = gps.game_id AND g.league = gps.league
        WHERE gps.league = %s AND g.season = %s
        ORDER BY gps.player_id, g.game_date DESC
    """
    team_df = pd.read_sql(team_q, conn, params=(league, season))
    player_team = {int(r["player_id"]): int(r["team_id"]) for _, r in team_df.iterrows()}

    # Next unplayed game per team
    games_q = """
        SELECT game_id, game_date, home_team_id, away_team_id
        FROM games
        WHERE league = %s AND season = %s
          AND game_date >= CURRENT_DATE
          AND (home_score IS NULL OR away_score IS NULL)
        ORDER BY game_date
    """
    games_df = pd.read_sql(games_q, conn, params=(league, season))
    games_df["game_date"] = pd.to_datetime(games_df["game_date"])

    # Yesterday's games (for b2b detection)
    yesterday_q = """
        SELECT DISTINCT home_team_id AS team_id FROM games
        WHERE league = %s AND game_date = CURRENT_DATE - 1
          AND (home_score IS NOT NULL OR away_score IS NOT NULL)
        UNION
        SELECT DISTINCT away_team_id FROM games
        WHERE league = %s AND game_date = CURRENT_DATE - 1
          AND (home_score IS NOT NULL OR away_score IS NOT NULL)
    """
    yesterday_df = pd.read_sql(yesterday_q, conn, params=(league, league))
    played_yesterday = set(int(r["team_id"]) for _, r in yesterday_df.iterrows())

    # Build next-game lookup per team
    team_next_game = {}
    for _, g in games_df.iterrows():
        for team_id, is_home in [(int(g["home_team_id"]), 1), (int(g["away_team_id"]), 0)]:
            if team_id not in team_next_game:
                opp = int(g["away_team_id"]) if is_home else int(g["home_team_id"])
                team_next_game[team_id] = {
                    "game_id": int(g["game_id"]),
                    "game_date": g["game_date"],
                    "opp_team_id": opp,
                    "is_home": is_home,
                    "is_b2b": 1 if team_id in played_yesterday else 0,
                }

    return {
        pid: team_next_game[tid]
        for pid, tid in player_team.items()
        if tid in team_next_game
    }


def load_vegas_props(conn, league: str, season: int) -> dict:
    """
    Returns {player_id: {stat: line_value}} for the most recent player props.
    Only used for next_game projections.

    BDL prop_type values are typically "points", "rebounds", "assists" etc.
    We map them to our stat names.
    """
    PROP_TYPE_MAP = {
        "points": "pts", "rebounds": "reb", "assists": "ast",
        "steals": "stl", "blocks": "blk", "turnovers": "tov",
        "three_point_field_goals_made": "fg3m",
    }
    q = """
        SELECT DISTINCT ON (pp.player_id, pp.prop_type)
               pp.player_id, pp.prop_type, pp.line_value
        FROM player_props pp
        JOIN games g ON g.game_id = pp.game_id AND g.league = pp.league
        WHERE pp.league = %s AND g.season = %s
          AND g.game_date >= CURRENT_DATE
        ORDER BY pp.player_id, pp.prop_type, pp.captured_at DESC
    """
    df = pd.read_sql(q, conn, params=(league, season))
    props = {}
    for _, r in df.iterrows():
        stat = PROP_TYPE_MAP.get(r["prop_type"])
        if stat and r["line_value"] is not None:
            pid = int(r["player_id"])
            props.setdefault(pid, {})[stat] = float(r["line_value"])
    return props


# ================================================================
# Feature engineering
# ================================================================

def add_b2b_flag(df: pd.DataFrame) -> pd.DataFrame:
    """
    Flag each game where the player played the previous day.
    Assumes df is sorted by player_id, game_date (load_training_data guarantees this).
    """
    df = df.copy()
    df["prev_game_date"] = df.groupby("player_id")["game_date"].shift(1)
    df["is_b2b"] = (
        (df["game_date"] - df["prev_game_date"]).dt.days == 1
    ).astype(int).fillna(0)
    return df


def add_recency_weights(df: pd.DataFrame,
                        half_life: int = RECENCY_HALF_LIFE_DAYS) -> pd.DataFrame:
    """
    Exponential decay weight by days since most recent game in dataset.
    Newer games → weight near 1.0; older games → lower weight.
    Floor at 0.1 to prevent numerical issues.
    """
    df = df.copy()
    max_date = df["game_date"].max()
    days_ago = (max_date - df["game_date"]).dt.days
    df["weight"] = np.exp(-np.log(2) / half_life * days_ago).clip(lower=0.1)
    return df


# ================================================================
# Model
# ================================================================

def fit_count_stat(df: pd.DataFrame, stat: str, n_advi: int = 30_000):
    """
    Hierarchical Negative Binomial for one counting stat.

    Features included per observation:
      - Player's archetype-level prior (hierarchical shrinkage)
      - is_home: learned home court advantage
      - is_b2b: learned back-to-back penalty
      - opp_log_offset: fixed log-scale opponent defensive factor
      - weight: recency-decayed likelihood weight

    Uses ADVI for speed (~30s per stat vs. hours for MCMC).
    """
    players = pd.Categorical(df["player_id"])
    archetypes = pd.Categorical(df["archetype"])
    p_idx = players.codes
    player_to_arch = (
        df.groupby("player_id")["archetype"]
          .agg(lambda s: s.mode().iat[0])
          .reindex(players.categories)
    )
    player_arch_idx = pd.Categorical(player_to_arch,
                                     categories=archetypes.categories).codes

    minutes = df["min_played"].to_numpy()
    y = df[stat].fillna(0).to_numpy().astype(int)
    is_home = df["is_home"].to_numpy().astype(float)
    is_b2b = df["is_b2b"].to_numpy().astype(float)
    opp_log_offset = df["opp_log_offset"].to_numpy().astype(float)
    weights = df["weight"].to_numpy().astype(float)

    n_players = len(players.categories)
    n_archetypes = len(archetypes.categories)

    with pm.Model():
        # League-level prior
        mu_league = pm.Normal(
            "mu_league",
            mu=np.log(max(y.mean(), 0.1) / minutes.mean() * 36),
            sigma=1.0,
        )
        # Archetype-level effects
        sigma_arch = pm.HalfNormal("sigma_arch", 0.5)
        arch_z = pm.Normal("arch_z", 0, 1, shape=n_archetypes)
        mu_arch = pm.Deterministic("mu_arch", mu_league + arch_z * sigma_arch)

        # Player-level offsets
        sigma_player = pm.HalfNormal("sigma_player", 0.4)
        player_z = pm.Normal("player_z", 0, 1, shape=n_players)
        log_rate_player = pm.Deterministic(
            "log_rate_player",
            mu_arch[player_arch_idx] + player_z * sigma_player,
        )

        # Game-level adjustments
        beta_home = pm.Normal("beta_home", 0, 0.15)   # home court effect
        beta_b2b = pm.Normal("beta_b2b", 0, 0.15)    # back-to-back fatigue

        # Per-observation log rate: player base + context adjustments
        log_rate_obs = (
            log_rate_player[p_idx]
            + beta_home * is_home
            + beta_b2b * is_b2b
            + opp_log_offset          # fixed data offset, not a learned param
        )
        expected = pm.math.exp(log_rate_obs) * (minutes / 36.0)
        alpha = pm.HalfNormal("alpha", 5)

        # Recency-weighted likelihood via Potential
        obs_logp = pm.logp(pm.NegativeBinomial.dist(mu=expected, alpha=alpha), y)
        pm.Potential("weighted_obs", (pt.as_tensor_variable(weights) * obs_logp).sum())

        approx = pm.fit(
            n=n_advi, method="advi", progressbar=True,
            callbacks=[pm.callbacks.CheckParametersConvergence(diff="absolute")],
        )
        trace = approx.sample(1000, random_seed=42)

    return {
        "trace": trace,
        "players": players.categories.tolist(),
        "stat": stat,
    }


# ================================================================
# Minutes model
# ================================================================

def estimate_projected_minutes(df: pd.DataFrame, injuries: Dict[int, str],
                                recent_n: int = RECENT_N_GAMES) -> Dict[int, float]:
    """
    Per-player projected minutes:
      1. Recent-N-game average (their own track record)
      2. Shrunk toward archetype mean when sample is thin
      3. Injury adjusted: "Out" excluded, "Day-To-Day" halved
    """
    df_sorted = df.sort_values(["player_id", "game_date"])
    recent = df_sorted.groupby("player_id").tail(recent_n)
    player_recent_avg = recent.groupby("player_id")["min_played"].mean()
    player_recent_n = recent.groupby("player_id").size()

    # Archetype means from full history
    player_arch = (
        df.groupby("player_id")["archetype"]
          .agg(lambda s: s.mode().iat[0])
    )
    arch_means = df.groupby("archetype")["min_played"].mean()
    league_mean = df["min_played"].mean()

    projected = {}
    for pid in player_recent_avg.index:
        recent_avg = player_recent_avg[pid]
        n = player_recent_n[pid]

        # Shrinkage: weight on own data grows with sample size
        own_weight = n / (n + 5)
        arch = player_arch.get(pid, "unclassified")
        arch_mean = arch_means.get(arch, league_mean)
        blended = own_weight * recent_avg + (1 - own_weight) * arch_mean

        status = injuries.get(pid)
        if status == "Out":
            continue  # exclude from projections
        elif status == "Day-To-Day":
            blended *= 0.5

        projected[int(pid)] = float(blended)

    return projected


# ================================================================
# Summarize posterior → per-player projections
# ================================================================

def summarize_posterior(fit: dict, projected_minutes: Dict[int, float],
                        upcoming_ctx: dict, opp_factors: dict,
                        current_season: int) -> pd.DataFrame:
    """
    For each player, draw from the ADVI posterior at their projected minutes,
    applying opponent/home/b2b adjustments from their upcoming game context.
    """
    trace = fit["trace"]
    players = fit["players"]
    stat = fit["stat"]

    log_rate = trace.posterior["log_rate_player"].values
    log_rate = log_rate.reshape(-1, log_rate.shape[-1])   # (S, n_players)

    beta_home_s = trace.posterior["beta_home"].values.flatten()   # (S,)
    beta_b2b_s = trace.posterior["beta_b2b"].values.flatten()     # (S,)

    out = []
    for i, pid in enumerate(players):
        mins = projected_minutes.get(pid, np.nan)
        if np.isnan(mins) or mins < 1:
            continue

        ctx = upcoming_ctx.get(pid, {})
        is_home_val = float(ctx.get("is_home", 0.5))   # 0.5 = no game info
        is_b2b_val = float(ctx.get("is_b2b", 0))
        opp_team = ctx.get("opp_team_id")

        opp_f = 1.0
        if opp_team:
            opp_f = opp_factors.get((opp_team, current_season), {}).get(stat, 1.0)
            opp_f = float(np.clip(opp_f, 0.7, 1.4))  # cap extreme outliers

        rate_per_36 = np.exp(
            log_rate[:, i] + beta_home_s * is_home_val + beta_b2b_s * is_b2b_val
        )
        per_game = rate_per_36 * (mins / 36.0) * opp_f

        out.append({
            "player_id": pid,
            f"proj_{stat}": float(per_game.mean()),
            f"sd_{stat}": float(per_game.std()),
        })

    return pd.DataFrame(out)


# ================================================================
# Fantasy score
# ================================================================

def compute_fantasy_score(result: pd.DataFrame) -> pd.DataFrame:
    result = result.copy()
    result["proj_fantasy_pg"] = sum(
        result[f"proj_{k}"] * w
        for k, w in DEFAULT_FANTASY_WEIGHTS.items()
        if f"proj_{k}" in result.columns
    )
    result["sd_fantasy_pg"] = np.sqrt(sum(
        (result[f"sd_{k}"] * abs(w)) ** 2
        for k, w in DEFAULT_FANTASY_WEIGHTS.items()
        if f"sd_{k}" in result.columns
    ))
    return result


# ================================================================
# DB write
# ================================================================

def write_projections(conn, df: pd.DataFrame, league: str, season: int, horizon: str):
    today = date.today()
    rows = []
    for _, r in df.iterrows():
        rows.append((
            int(r["player_id"]), league, season, today, horizon,
            float(r.get("proj_min", 0) or 0),
            float(r.get("proj_pts", 0) or 0),
            float(r.get("proj_reb", 0) or 0),
            float(r.get("proj_ast", 0) or 0),
            float(r.get("proj_stl", 0) or 0),
            float(r.get("proj_blk", 0) or 0),
            float(r.get("proj_tov", 0) or 0),
            float(r.get("proj_fg3m", 0) or 0),
            None, None,
            float(r.get("sd_pts", 0) or 0),
            float(r.get("sd_reb", 0) or 0),
            float(r.get("sd_ast", 0) or 0),
            float(r.get("proj_fantasy_pg", 0) or 0),
            float(r.get("sd_fantasy_pg", 0) or 0),
            None,
            MODEL_VERSION,
        ))
    with conn.cursor() as cur:
        execute_values(cur, """
            INSERT INTO projections (
                player_id, league, season, projection_date, horizon,
                proj_min, proj_pts, proj_reb, proj_ast, proj_stl, proj_blk,
                proj_tov, proj_fg3m, proj_fg_pct, proj_ft_pct,
                sd_pts, sd_reb, sd_ast, proj_fantasy_pg, sd_fantasy_pg,
                games_remaining, model_version
            ) VALUES %s
            ON CONFLICT (player_id, season, projection_date, horizon, league)
            DO UPDATE SET
                proj_pts        = EXCLUDED.proj_pts,
                proj_reb        = EXCLUDED.proj_reb,
                proj_ast        = EXCLUDED.proj_ast,
                proj_stl        = EXCLUDED.proj_stl,
                proj_blk        = EXCLUDED.proj_blk,
                proj_tov        = EXCLUDED.proj_tov,
                proj_fg3m       = EXCLUDED.proj_fg3m,
                proj_fantasy_pg = EXCLUDED.proj_fantasy_pg,
                sd_pts          = EXCLUDED.sd_pts,
                sd_reb          = EXCLUDED.sd_reb,
                sd_ast          = EXCLUDED.sd_ast,
                sd_fantasy_pg   = EXCLUDED.sd_fantasy_pg,
                model_version   = EXCLUDED.model_version
        """, rows)
    conn.commit()


# ================================================================
# Orchestrator
# ================================================================

def run_projections(league: str, season: int, horizon: str = "ros"):
    conn = psycopg2.connect(PG_DSN)
    try:
        print("Loading training data...")
        df = load_training_data(conn, league, season)
        if df.empty:
            raise RuntimeError(f"No training data for {league} {season}")

        df = add_b2b_flag(df)
        df = add_recency_weights(df)

        seasons = tuple(df["season"].unique().tolist())
        print("Computing opponent defensive factors...")
        opp_factors = compute_opp_factors(conn, league, seasons)

        print("Loading injury list...")
        injuries = get_injured_players(conn, league)
        n_out = sum(1 for s in injuries.values() if s == "Out")
        n_dtd = sum(1 for s in injuries.values() if s == "Day-To-Day")
        print(f"  {n_out} Out, {n_dtd} Day-To-Day")

        print("Loading upcoming game context...")
        upcoming_ctx = load_upcoming_context(conn, league, season)
        print(f"  Found next game for {len(upcoming_ctx)} players")

        vegas_props: dict = {}
        if horizon == "next_game":
            print("Loading Vegas props...")
            vegas_props = load_vegas_props(conn, league, season)
            print(f"  Props available for {len(vegas_props)} players")

        print("Estimating projected minutes...")
        projected_min = estimate_projected_minutes(df, injuries)
        print(f"  Projecting {len(projected_min)} players")

        # Build opp_log_offset column for each stat (needed by fit_count_stat)
        # We pre-join it into the df once per stat inside the loop below
        all_summaries = []
        for stat in COUNT_STATS:
            print(f"  Fitting {stat}...")
            # Attach opponent log offset for this stat to each observation
            df_stat = df.copy()
            df_stat["opp_log_offset"] = df_stat.apply(
                lambda r: np.log(max(
                    opp_factors.get((int(r["opp_team_id"]), int(r["season"])), {})
                              .get(stat, 1.0),
                    0.5
                )),
                axis=1,
            )
            fit = fit_count_stat(df_stat, stat)
            summary = summarize_posterior(fit, projected_min, upcoming_ctx,
                                          opp_factors, season)
            all_summaries.append(summary)

        # Merge stats into one row per player
        result = all_summaries[0]
        for s in all_summaries[1:]:
            result = result.merge(s, on="player_id", how="outer")

        result["proj_min"] = result["player_id"].map(projected_min)
        result = compute_fantasy_score(result)

        # Vegas blending for next_game: weighted average of model + market line
        if horizon == "next_game" and vegas_props:
            for stat in COUNT_STATS:
                col = f"proj_{stat}"
                if col not in result.columns:
                    continue
                market = result["player_id"].map(
                    {pid: props.get(stat) for pid, props in vegas_props.items()}
                )
                has_market = market.notna()
                result.loc[has_market, col] = (
                    (1 - VEGAS_BLEND_WEIGHT) * result.loc[has_market, col]
                    + VEGAS_BLEND_WEIGHT * market[has_market]
                )
            # Recompute fantasy score after blending
            result = compute_fantasy_score(result)

        write_projections(conn, result, league, season, horizon)
        print(f"Wrote projections for {len(result)} players.")

    finally:
        conn.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--league", choices=["nba", "wnba"], required=True)
    ap.add_argument("--season", type=int, required=True)
    ap.add_argument("--horizon", default="ros", choices=["ros", "season", "next_game"])
    args = ap.parse_args()
    run_projections(args.league, args.season, args.horizon)
