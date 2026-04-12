"""
Populate players.nba_team with real NBA team tricodes (e.g. "OKC", "BOS").
Matches by players.external_id_nba (NBA personId).

Usage:
    python seed_player_teams.py
"""

import os
import time
from nba_api.stats.endpoints import commonallplayers
from supabase import create_client

SUPABASE_URL = 'https://iuqbossmnsezzgocpcbo.supabase.co'
SUPABASE_KEY = os.environ['SB_SECRET_KEY']

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

print('Fetching active players from NBA API...')
time.sleep(1)
all_players = commonallplayers.CommonAllPlayers(
    is_only_current_season=1,
    league_id='00',
    season='2025-26',
)
df = all_players.get_data_frames()[0]
print(f'  Got {len(df)} players from NBA API.')

# Build NBA personId → team tricode map (skip players with no team, e.g. free agents)
nba_team_map: dict[str, str] = {}
for _, row in df.iterrows():
    tricode = str(row.get('TEAM_ABBREVIATION', '')).strip()
    if tricode and tricode != 'nan':
        nba_team_map[str(int(row['PERSON_ID']))] = tricode

print(f'  {len(nba_team_map)} players have an active team.')

# Fetch all players from Supabase
sb_players = supabase.table('players').select('id, external_id_nba').execute().data
print(f'  {len(sb_players)} players in Supabase.')

updates = 0
skipped = 0
for p in sb_players:
    nba_id = str(p.get('external_id_nba') or '').strip()
    if not nba_id or nba_id not in nba_team_map:
        skipped += 1
        continue
    tricode = nba_team_map[nba_id]
    supabase.table('players').update({'nba_team': tricode}).eq('id', p['id']).execute()
    updates += 1

print(f'Done. Updated {updates} players. Skipped {skipped} (no NBA match or free agent).')
