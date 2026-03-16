"""
Sync active NBA players to Supabase.

Fetches the current active player list from the NBA's commonallplayers
endpoint (live, not static), compares against existing players in the DB,
and upserts any missing ones with position data from CommonPlayerInfo.

On subsequent runs it only processes new activations (usually 0-5 players).
"""

import os
import time
import unicodedata

from nba_api.stats.endpoints import commonallplayers, commonplayerinfo
from nba_api.stats.library.http import NBAStatsHTTP
from supabase import create_client

# NBA API requires browser-like headers or it will timeout/block
CUSTOM_HEADERS = {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': 'https://www.nba.com',
    'Referer': 'https://www.nba.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
}
NBAStatsHTTP.nba_response = None  # reset any cached state

# Must match CURRENT_NBA_SEASON in constants/LeagueDefaults.ts
CURRENT_SEASON = '2025-26'

supabase_url = os.environ.get('SUPABASE_URL', 'https://iuqbossmnsezzgocpcbo.supabase.co')
supabase_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1cWJvc3NtbnNlenpnb2NwY2JvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTI4Nzk5MiwiZXhwIjoyMDg2ODYzOTkyfQ.bqe3N6Q-Mj2BZRAVtUl1lCgzdgTnNu081BMouSJTGig')

supabase = create_client(supabase_url, supabase_key)

def normalize_position(raw: str) -> str:
    """Convert NBA API position words to app position codes."""
    if not raw:
        return 'G'
    pos = raw.strip().lower()
    mapping = {
        'guard': 'PG',
        'forward': 'SF',
        'center': 'C',
        'guard-forward': 'SG',
        'forward-guard': 'SF',
        'forward-center': 'PF',
        'center-forward': 'C',
    }
    return mapping.get(pos, 'G')

def fetch_with_retry(endpoint_fn, retries=4, delay=5, **kwargs):
    """Call an nba_api endpoint with retries on timeout."""
    for attempt in range(retries):
        try:
            return endpoint_fn(**kwargs, headers=CUSTOM_HEADERS, timeout=180)
        except Exception as e:
            if attempt < retries - 1:
                wait = delay * (2 ** attempt)
                print(f"  Attempt {attempt + 1} failed: {e}. Retrying in {wait}s...")
                time.sleep(wait)
            else:
                raise

def refresh_mat_view():
    """Always refresh the materialized view, regardless of NBA API status."""
    print("Refreshing player_season_stats materialized view...")
    supabase.rpc('refresh_player_season_stats').execute()
    print("Materialized view refreshed.")

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

    # 2. Get active players from the LIVE NBA API (not the static bundled list)
    nba_api_failed = False
    new_players_df = None
    try:
        print(f"Fetching active players from NBA API (season {CURRENT_SEASON})...")
        all_players_response = fetch_with_retry(
            commonallplayers.CommonAllPlayers,
            is_only_current_season=1,
            season=CURRENT_SEASON,
        )
        all_players_df = all_players_response.get_data_frames()[0]
        print(f"  {len(all_players_df)} active players from NBA")

        # 3. Filter to only new players (not already in DB)
        new_players_df = all_players_df[~all_players_df['PERSON_ID'].isin(existing_ids)]
        print(f"  {len(new_players_df)} new players to process")
    except Exception as e:
        print(f"NBA API unavailable: {e}")
        print("Skipping player sync, will still refresh materialized view.")
        nba_api_failed = True

    if nba_api_failed or new_players_df is None or len(new_players_df) == 0:
        if not nba_api_failed:
            print("No new players to sync.")
        refresh_mat_view()
        exit(0)

    # 4. Fetch position info for each new player via CommonPlayerInfo
    players_to_upsert = []
    for index, (_, row) in enumerate(new_players_df.iterrows(), 1):
        person_id = int(row['PERSON_ID'])
        display_name = row.get('DISPLAY_FIRST_LAST', f"ID {person_id}")

        try:
            time.sleep(0.6)  # Rate limit

            print(f"Processing {index}/{len(new_players_df)}: {display_name}")
            player_info = fetch_with_retry(
                commonplayerinfo.CommonPlayerInfo,
                player_id=person_id,
            )
            info_df = player_info.get_data_frames()[0]
            info_row = info_df.iloc[0]

            position = info_row.get('POSITION', '')
            nba_team = info_row.get('TEAM_ABBREVIATION', '')

            mapped_pos = normalize_position(position)
            players_to_upsert.append({
                'external_id_nba': person_id,
                'name': display_name,
                'position': mapped_pos,
                'nba_team': nba_team if nba_team else None,
                'status': 'active',
            })
            print(f"  Position: {position} -> {mapped_pos}, Team: {nba_team}")

        except Exception as e:
            # If we can't get detailed info, still insert with basic data
            print(f"  Error getting details for {display_name}: {e}")
            team_abbr = row.get('TEAM_ABBREVIATION', '')
            players_to_upsert.append({
                'external_id_nba': person_id,
                'name': display_name,
                'position': 'G',  # Default — positions are managed manually
                'nba_team': team_abbr if team_abbr else None,
                'status': 'active',
            })
            print(f"  Inserted with default position")

    # 5. Upsert into Supabase
    if players_to_upsert:
        print(f"\nUpserting {len(players_to_upsert)} players into database...")
        result = supabase.table('players').upsert(
            players_to_upsert,
            on_conflict='external_id_nba',
        ).execute()
        print(f"Done! Upserted {len(players_to_upsert)} players.")

    # 6. Always refresh materialized view
    refresh_mat_view()

except Exception as e:
    print(f"Fatal error: {e}")
    exit(1)
