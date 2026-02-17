import os
import time

from nba_api.stats.endpoints import commonplayerinfo
from nba_api.stats.static import players
from supabase import create_client

# Load environment variables from .env file

# Initialize Supabase client with error checking
supabase_url = 'https://iuqbossmnsezzgocpcbo.supabase.co'
supabase_key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1cWJvc3NtbnNlenpnb2NwY2JvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTI4Nzk5MiwiZXhwIjoyMDg2ODYzOTkyfQ.bqe3N6Q-Mj2BZRAVtUl1lCgzdgTnNu081BMouSJTGig'

if not supabase_url or not supabase_key:
    raise ValueError("Missing SUPABASE_URL or SUPABASE_KEY in .env file")

supabase = create_client(supabase_url, supabase_key)

try:
    print("Fetching active players...")
    active_players = players.get_active_players()
    print(f"Found {len(active_players)} active players")

    # Process each player
    players_to_insert = []
    for index, player in enumerate(active_players, 1):
        try:
            # Add delay to avoid rate limiting
            time.sleep(0.6)
            
            print(f"Processing {index}/{len(active_players)}: {player['full_name']}")
            player_info = commonplayerinfo.CommonPlayerInfo(player_id=player['id'])
            player_data = player_info.get_dict()
            common_info = player_data['resultSets'][0]['rowSet'][0]
            
            # Get position from POSITION index (14)
            position = common_info[15]
            
            player_record = {
                'external_id_nba': player['id'],
                'name': f"{player['first_name']} {player['last_name']}",
                'position': position,  # This will now be their actual position
                'nba_team': common_info[16],
            }
            players_to_insert.append(player_record)
            print(f"  Position: {position}")  # Debug print to verify position
            
        except Exception as e:
            print(f"Error processing {player['full_name']}: {str(e)}")
            continue

    # Insert into Supabase
    if players_to_insert:
        print(f"\nInserting {len(players_to_insert)} players into database...")
        result = supabase.table('players').insert(players_to_insert).execute()
        print("Database update complete!")

except Exception as e:
    print(f"Fatal error: {str(e)}")