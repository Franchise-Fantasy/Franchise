"""
Sync active NBA players to Supabase.

Fetches the current active player list from nba_api, compares against
existing players in the DB, and upserts any missing ones with full
position data from CommonPlayerInfo.

On first run this processes ~500+ players (~5 min with rate limiting).
On subsequent runs it only processes new activations (usually 0-5 players).
"""

import os
import time

from nba_api.stats.endpoints import commonplayerinfo
from nba_api.stats.static import players
from supabase import create_client

supabase_url = os.environ.get('SUPABASE_URL', 'https://iuqbossmnsezzgocpcbo.supabase.co')
supabase_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1cWJvc3NtbnNlenpnb2NwY2JvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTI4Nzk5MiwiZXhwIjoyMDg2ODYzOTkyfQ.bqe3N6Q-Mj2BZRAVtUl1lCgzdgTnNu081BMouSJTGig')

supabase = create_client(supabase_url, supabase_key)

try:
    # 1. Fetch existing external_id_nba values from our DB
    print("Fetching existing players from database...")
    existing = supabase.table('players').select('external_id_nba').execute()
    existing_ids = {
        int(p['external_id_nba'])
        for p in existing.data
        if p.get('external_id_nba') is not None
    }
    print(f"  {len(existing_ids)} players already in DB")

    # 2. Get active players from NBA API
    print("Fetching active players from NBA...")
    active_players = players.get_active_players()
    print(f"  {len(active_players)} active players from NBA")

    # 3. Filter to only new players
    new_players = [p for p in active_players if p['id'] not in existing_ids]
    print(f"  {len(new_players)} new players to process")

    if not new_players:
        print("No new players to sync. Done!")
        exit(0)

    # 4. Fetch detailed info for each new player
    players_to_upsert = []
    for index, player in enumerate(new_players, 1):
        try:
            time.sleep(0.6)  # Rate limit

            print(f"Processing {index}/{len(new_players)}: {player['full_name']}")
            player_info = commonplayerinfo.CommonPlayerInfo(player_id=player['id'])
            player_data = player_info.get_dict()
            common_info = player_data['resultSets'][0]['rowSet'][0]

            position = common_info[15]  # POSITION column
            nba_team = common_info[16]  # TEAM_ABBREVIATION column

            players_to_upsert.append({
                'external_id_nba': player['id'],
                'name': f"{player['first_name']} {player['last_name']}",
                'position': position if position else 'G',
                'nba_team': nba_team if nba_team else None,
                'status': 'active',
            })
            print(f"  Position: {position}, Team: {nba_team}")

        except Exception as e:
            print(f"Error processing {player['full_name']}: {str(e)}")
            continue

    # 5. Upsert into Supabase
    if players_to_upsert:
        print(f"\nUpserting {len(players_to_upsert)} players into database...")
        result = supabase.table('players').upsert(
            players_to_upsert,
            on_conflict='external_id_nba',
        ).execute()
        print(f"Done! Upserted {len(players_to_upsert)} players.")

        # 6. Refresh materialized view
        print("Refreshing player_season_stats materialized view...")
        supabase.rpc('refresh_player_season_stats').execute()
        print("Materialized view refreshed.")
    else:
        print("No valid players to upsert.")

except Exception as e:
    print(f"Fatal error: {str(e)}")
    exit(1)
