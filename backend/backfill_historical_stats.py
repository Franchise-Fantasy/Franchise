"""
Backfill player_historical_stats from the NBA API.

Uses nba_api's PlayerCareerStats to fetch season-by-season per-game averages
for every player in the database that has an external_id_nba.

Usage:
    python backfill_historical_stats.py                     # all seasons for all players
    python backfill_historical_stats.py --season 2024-25    # only 2024-25 season
"""

import os
import sys
import time

from nba_api.stats.endpoints import playercareerstats
from supabase import create_client

supabase_url = os.environ.get(
    "SUPABASE_URL", "https://iuqbossmnsezzgocpcbo.supabase.co"
)
supabase_key = os.environ.get("SB_SECRET_KEY", "")
if not supabase_key:
    raise ValueError("Set SB_SECRET_KEY env var")

supabase = create_client(supabase_url, supabase_key)

TARGET_SEASON = None
if len(sys.argv) > 2 and sys.argv[1] == "--season":
    TARGET_SEASON = sys.argv[2]
    print(f"Targeting season: {TARGET_SEASON}")

# Fetch all players with an NBA external ID
print("Fetching players from database...")
players_res = (
    supabase.table("players")
    .select("id, external_id_nba, name")
    .filter("external_id_nba", "not.is", "null")
    .execute()
)
players = players_res.data
print(f"Found {len(players)} players with external_id_nba")

success = 0
errors = 0

for i, player in enumerate(players):
    nba_id = int(player["external_id_nba"])
    player_uuid = player["id"]
    player_name = player.get("name", "Unknown")

    try:
        time.sleep(0.6)  # rate limit

        career = playercareerstats.PlayerCareerStats(
            player_id=nba_id,
            per_mode36="PerGame",
            timeout=60,
        )
        result = career.get_dict()
        season_data = result["resultSets"][0]
        headers = season_data["headers"]
        rows = season_data["rowSet"]

        for row in rows:
            season_id = row[headers.index("SEASON_ID")]
            if TARGET_SEASON and season_id != TARGET_SEASON:
                continue

            gp = row[headers.index("GP")]
            if gp == 0:
                continue

            # nba_api PerGame mode returns per-game averages directly
            avg_pts = row[headers.index("PTS")]
            avg_reb = row[headers.index("REB")]
            avg_ast = row[headers.index("AST")]
            avg_stl = row[headers.index("STL")]
            avg_blk = row[headers.index("BLK")]
            avg_tov = row[headers.index("TOV")]
            avg_min = row[headers.index("MIN")]
            avg_fgm = row[headers.index("FGM")]
            avg_fga = row[headers.index("FGA")]
            avg_3pm = row[headers.index("FG3M")]
            avg_3pa = row[headers.index("FG3A")]
            avg_ftm = row[headers.index("FTM")]
            avg_fta = row[headers.index("FTA")]
            avg_pf = row[headers.index("PF")]

            record = {
                "player_id": player_uuid,
                "season": season_id,
                "games_played": gp,
                "avg_min": avg_min,
                "avg_pts": avg_pts,
                "avg_reb": avg_reb,
                "avg_ast": avg_ast,
                "avg_stl": avg_stl,
                "avg_blk": avg_blk,
                "avg_tov": avg_tov,
                "avg_fgm": avg_fgm,
                "avg_fga": avg_fga,
                "avg_3pm": avg_3pm,
                "avg_3pa": avg_3pa,
                "avg_ftm": avg_ftm,
                "avg_fta": avg_fta,
                "avg_pf": avg_pf,
                "total_pts": round(avg_pts * gp),
                "total_reb": round(avg_reb * gp),
                "total_ast": round(avg_ast * gp),
                "total_stl": round(avg_stl * gp),
                "total_blk": round(avg_blk * gp),
                "total_tov": round(avg_tov * gp),
                "nba_team": row[headers.index("TEAM_ABBREVIATION")],
            }

            supabase.table("player_historical_stats").upsert(
                record, on_conflict="player_id,season"
            ).execute()

        success += 1
        print(f"[{i + 1}/{len(players)}] {player_name}: OK".encode("ascii", "replace").decode())

    except Exception as e:
        errors += 1
        print(f"[{i + 1}/{len(players)}] {player_name}: ERROR - {e}".encode("ascii", "replace").decode())

print(f"\nDone. Success: {success}, Errors: {errors}")
