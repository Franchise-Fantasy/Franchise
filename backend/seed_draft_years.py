"""
Populate players.nba_draft_year using nba_api library.
For drafted players: uses drafthistory bulk endpoint.
For undrafted players: falls back to debut year from commonallplayers.

Usage:
    python seed_draft_years.py
"""

import time
from nba_api.stats.endpoints import drafthistory, commonallplayers
from supabase import create_client

SUPABASE_URL = 'https://iuqbossmnsezzgocpcbo.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1cWJvc3NtbnNlenpnb2NwY2JvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTI4Nzk5MiwiZXhwIjoyMDg2ODYzOTkyfQ.bqe3N6Q-Mj2BZRAVtUl1lCgzdgTnNu081BMouSJTGig'

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Step 1: Fetch draft history (drafted players)
print('Fetching NBA draft history...', flush=True)
draft_year_by_id = {}
try:
    dh = drafthistory.DraftHistory(league_id='00', timeout=120)
    df = dh.get_data_frames()[0]
    for _, row in df.iterrows():
        player_id = str(row['PERSON_ID'])
        season = row['SEASON']
        if season and str(season).isdigit() and int(season) > 0:
            draft_year_by_id[player_id] = int(season)
    print(f'  {len(draft_year_by_id)} drafted players found.', flush=True)
except Exception as e:
    print(f'  Error fetching draft history: {e}', flush=True)
    exit(1)

# Step 2: Fetch debut years (all players including undrafted)
print('Fetching debut years from commonallplayers...', flush=True)
debut_year_by_id = {}
try:
    time.sleep(1)
    cap = commonallplayers.CommonAllPlayers(
        is_only_current_season=0, league_id='00', season='2025-26', timeout=120
    )
    df2 = cap.get_data_frames()[0]
    for _, row in df2.iterrows():
        player_id = str(row['PERSON_ID'])
        from_year = row.get('FROM_YEAR')
        if from_year and str(from_year).isdigit() and int(from_year) > 0:
            debut_year_by_id[player_id] = int(from_year)
    print(f'  {len(debut_year_by_id)} players with debut years.', flush=True)
except Exception as e:
    print(f'  Error fetching debut years: {e}', flush=True)
    print('  Will skip undrafted players.', flush=True)

# Step 3: Fetch players from Supabase missing nba_draft_year
sb_players = (
    supabase.table('players')
    .select('id, name, external_id_nba, nba_draft_year')
    .is_('nba_draft_year', 'null')
    .not_.is_('external_id_nba', 'null')
    .execute()
    .data
)
print(f'{len(sb_players)} players missing draft year in DB.', flush=True)

# Step 4: Match and update — prefer draft year, fall back to debut year
updates_drafted = 0
updates_debut = 0
no_match = []
for p in sb_players:
    nba_id = p['external_id_nba']
    if nba_id in draft_year_by_id:
        supabase.table('players').update(
            {'nba_draft_year': draft_year_by_id[nba_id]}
        ).eq('id', p['id']).execute()
        updates_drafted += 1
    elif nba_id in debut_year_by_id:
        supabase.table('players').update(
            {'nba_draft_year': debut_year_by_id[nba_id]}
        ).eq('id', p['id']).execute()
        updates_debut += 1
    else:
        no_match.append(p['name'])

print(f'\nUpdated {updates_drafted} via draft history.', flush=True)
print(f'Updated {updates_debut} via debut year (undrafted players).', flush=True)
if no_match:
    print(f'{len(no_match)} still unmatched:', flush=True)
    for n in sorted(no_match):
        print(f'  - {n}', flush=True)
