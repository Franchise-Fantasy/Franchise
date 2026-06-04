"""
Franchise player-archetype clustering — port of the source engine's
`archetype.py` to Franchise data.

K-means (6 clusters) on per-36 box-score rates assigns each player a role label
that the projection model (project.py) uses as its archetype-level prior. Without
it, every player collapses into one league-wide pool and the Bayesian shrinkage
drags starters toward the bench average (the ~20-30% low bias). Real role tiers
let a scorer shrink toward the scorer mean, a glass-eater toward the glass-eater
mean, and so on.

Reads Franchise `player_games` (sport-scoped); writes `player_archetypes`
(UUID player_id, sport, season). Runs as the projections_engine role, before
franchise_project, in the daily workflow.

USAGE
    python franchise_archetype.py --sport wnba --season 2026
    python franchise_archetype.py --sport wnba --season 2026 --inspect
"""
import argparse

import numpy as np
import pandas as pd
from psycopg2.extras import execute_values
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler

from franchise_db import get_conn

N_CLUSTERS = 6
# Source uses 10; WNBA seasons are short and we need stars classified in May/June
# when regulars still have <10 games, so floor lower. Clusters are noisier early
# but still beat one undifferentiated league pool.
MIN_GAMES = 5

# Per-36 features (+ fg_pct), identical to the source engine.
FEATURES = ["pts_p36", "reb_p36", "ast_p36", "stl_p36", "blk_p36", "tov_p36", "fg3m_p36", "fg_pct"]

# Static label map (used when the fit produces exactly N_CLUSTERS clusters).
ARCHETYPE_LABELS = {
    0: "primary_scorer",
    1: "playmaker",
    2: "glass_eater",
    3: "versatile",
    4: "role_3andD",
    5: "reserve",
}


def load_season_rates(conn, sport: str, season: int) -> pd.DataFrame:
    """Per-player per-36 rates for one season, excluding DNPs / garbage time."""
    q = """
        SELECT pg.player_id,
               COUNT(*)                                          AS games,
               SUM(pg.min)                                       AS total_min,
               SUM(pg.pts)   / NULLIF(SUM(pg.min), 0) * 36       AS pts_p36,
               SUM(pg.reb)   / NULLIF(SUM(pg.min), 0) * 36       AS reb_p36,
               SUM(pg.ast)   / NULLIF(SUM(pg.min), 0) * 36       AS ast_p36,
               SUM(pg.stl)   / NULLIF(SUM(pg.min), 0) * 36       AS stl_p36,
               SUM(pg.blk)   / NULLIF(SUM(pg.min), 0) * 36       AS blk_p36,
               SUM(pg.tov)   / NULLIF(SUM(pg.min), 0) * 36       AS tov_p36,
               SUM(pg."3pm") / NULLIF(SUM(pg.min), 0) * 36       AS fg3m_p36,
               SUM(pg.fgm)::numeric / NULLIF(SUM(pg.fga), 0)     AS fg_pct
        FROM player_games pg
        WHERE pg.sport = %s
          AND EXTRACT(YEAR FROM pg.game_date) = %s
          AND pg.min >= 5
        GROUP BY pg.player_id
        HAVING COUNT(*) >= %s
    """
    return pd.read_sql(q, conn, params=(sport, season, MIN_GAMES))


def fit_archetypes(df: pd.DataFrame, n_clusters: int, random_state: int = 42):
    """KMeans on standardized per-36 features. Returns (labels, scaler, model)."""
    X = df[FEATURES].fillna(0).values
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    km = KMeans(n_clusters=n_clusters, random_state=random_state, n_init=20)
    labels = km.fit_predict(X_scaled)
    return labels, scaler, km


def label_clusters(km, scaler) -> dict:
    """Auto-label clusters by centroid signature (same logic as the source)."""
    centroids = scaler.inverse_transform(km.cluster_centers_)
    n = len(centroids)
    if n != len(ARCHETYPE_LABELS):
        return {i: f"cluster_{i}" for i in range(n)}

    pts = centroids[:, FEATURES.index("pts_p36")]
    reb = centroids[:, FEATURES.index("reb_p36")]
    ast = centroids[:, FEATURES.index("ast_p36")]
    blk = centroids[:, FEATURES.index("blk_p36")]
    fg3m = centroids[:, FEATURES.index("fg3m_p36")]

    assigned: dict = {}
    remaining = set(range(n))

    def claim(role, scores):
        best = max(remaining, key=lambda i: scores[i])
        assigned[best] = role
        remaining.discard(best)

    claim("glass_eater", reb + blk)
    claim("playmaker", ast)
    claim("primary_scorer", pts)
    claim("role_3andD", fg3m)
    claim("versatile", pts + reb + ast)
    for i in remaining:
        assigned[i] = "reserve"
    return assigned


def print_centroids(labels, km, scaler):
    centroids = scaler.inverse_transform(km.cluster_centers_)
    centroid_df = pd.DataFrame(centroids, columns=FEATURES)
    centroid_df.insert(0, "cluster", range(len(centroids)))
    centroid_df["n_players"] = pd.Series(labels).value_counts().sort_index().values
    print("\nCluster centroids (per-36 rates, original scale):")
    print(centroid_df.to_string(index=False, float_format="{:.2f}".format))


def write_archetypes(conn, player_ids, labels, cluster_map, sport, season, km, scaler, df) -> int:
    """Upsert one row per player into player_archetypes."""
    X = df[FEATURES].fillna(0).values
    dists = km.transform(scaler.transform(X))  # (n_players, n_clusters)
    rows = []
    for i, pid in enumerate(player_ids):
        cluster_idx = int(labels[i])
        archetype = cluster_map.get(cluster_idx, f"cluster_{cluster_idx}")
        sorted_d = np.sort(dists[i])
        # Soft confidence: how much closer to the assigned centroid than the next.
        confidence = float(1.0 - sorted_d[0] / sorted_d[1]) if len(sorted_d) >= 2 and sorted_d[1] > 0 else 1.0
        rows.append((str(pid), sport, str(season), archetype, round(confidence, 4)))

    with conn.cursor() as cur:
        execute_values(cur, """
            INSERT INTO player_archetypes (player_id, sport, season, archetype, archetype_confidence)
            VALUES %s
            ON CONFLICT (player_id, sport, season)
            DO UPDATE SET archetype            = EXCLUDED.archetype,
                          archetype_confidence = EXCLUDED.archetype_confidence,
                          updated_at           = now()
        """, rows)
    conn.commit()
    return len(rows)


def run(sport: str, season: int, inspect: bool = False):
    conn = get_conn()
    try:
        print(f"Loading {sport} {season} box-score rates...")
        df = load_season_rates(conn, sport, season)
        if df.empty:
            raise RuntimeError(f"No {sport} {season} data with >= {MIN_GAMES} games.")
        print(f"  {len(df)} players with >= {MIN_GAMES} games")

        n_clusters = min(N_CLUSTERS, len(df))
        labels, scaler, km = fit_archetypes(df, n_clusters)
        cluster_map = label_clusters(km, scaler)

        if inspect:
            print_centroids(labels, km, scaler)
            for idx, name in sorted(cluster_map.items()):
                print(f"  cluster {idx}: {name}  ({int((labels == idx).sum())} players)")
            return

        n = write_archetypes(conn, df["player_id"].values, labels, cluster_map,
                             sport, season, km, scaler, df)
        print(f"Wrote {n} archetype assignments for {sport} {season}.")
    finally:
        conn.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--sport", choices=["nba", "wnba"], default="wnba")
    ap.add_argument("--season", type=int, required=True)
    ap.add_argument("--inspect", action="store_true",
                    help="Print cluster centroids without writing to DB")
    args = ap.parse_args()
    run(args.sport, args.season, inspect=args.inspect)
