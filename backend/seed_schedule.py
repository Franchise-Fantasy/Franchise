"""
Seed the nba_schedule table with all regular season games for a given NBA season.
Uses the nba_api LeagueGameFinder endpoint.

Usage:
    python seed_schedule.py              # seeds current season (2025-26)
    python seed_schedule.py 2024-25      # seeds a specific season
"""

import sys
import time
from datetime import datetime

from nba_api.stats.endpoints import leaguegamefinder
from supabase import create_client

SUPABASE_URL = 'https://iuqbossmnsezzgocpcbo.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1cWJvc3NtbnNlenpnb2NwY2JvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTI4Nzk5MiwiZXhwIjoyMDg2ODYzOTkyfQ.bqe3N6Q-Mj2BZRAVtUl1lCgzdgTnNu081BMouSJTGig'

NBA_SEASON = sys.argv[1] if len(sys.argv) > 1 else '2025-26'

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

print(f'Fetching NBA schedule for {NBA_SEASON}...')

# LeagueGameFinder returns one row per team per game, so we get duplicates.
# We deduplicate by game_id, picking the home team's row as the canonical record.
time.sleep(1)  # avoid rate limiting on first call
finder = leaguegamefinder.LeagueGameFinder(
    season_nullable=NBA_SEASON,
    league_id_nullable='00',       # '00' = NBA
    season_type_nullable='Regular Season',
)

df = finder.get_data_frames()[0]
print(f'  Fetched {len(df)} team-game rows.')

# Columns from LeagueGameFinder:
# SEASON_ID, TEAM_ID, TEAM_ABBREVIATION, TEAM_NAME, GAME_ID, GAME_DATE,
# MATCHUP, WL, MIN, PTS, ... (full box score totals)
# MATCHUP format: "BOS vs. MIA" (home) or "BOS @ MIA" (away)

games: dict[str, dict] = {}

for _, row in df.iterrows():
    game_id = row['GAME_ID']
    matchup: str = row['MATCHUP']
    team = row['TEAM_ABBREVIATION']
    game_date = row['GAME_DATE']  # 'YYYY-MM-DD'
    pts = row.get('PTS')
    wl = row.get('WL')  # 'W' or 'L' or None if unplayed

    is_home = 'vs.' in matchup

    if game_id not in games:
        games[game_id] = {
            'game_id': game_id,
            'game_date': game_date,
            'season': NBA_SEASON,
            'home_team': None,
            'away_team': None,
            'home_score': None,
            'away_score': None,
            'status': 'final' if wl else 'scheduled',
        }

    if is_home:
        games[game_id]['home_team'] = team
        if pts is not None and str(pts) != 'nan':
            games[game_id]['home_score'] = int(pts)
    else:
        games[game_id]['away_team'] = team
        if pts is not None and str(pts) != 'nan':
            games[game_id]['away_score'] = int(pts)

rows = [g for g in games.values() if g['home_team'] and g['away_team']]
print(f'  Deduped to {len(rows)} unique games.')

# Sort by date so we can verify the last game easily
rows.sort(key=lambda g: g['game_date'])

if rows:
    print(f'  First game: {rows[0]["game_date"]}  ({rows[0]["away_team"]} @ {rows[0]["home_team"]})')
    print(f'  Last game:  {rows[-1]["game_date"]}  ({rows[-1]["away_team"]} @ {rows[-1]["home_team"]})')

# Upsert in batches of 500 to stay well under Supabase payload limits
BATCH = 500
inserted = 0
for i in range(0, len(rows), BATCH):
    batch = rows[i:i + BATCH]
    supabase.table('nba_schedule').upsert(batch, on_conflict='game_id').execute()
    inserted += len(batch)
    print(f'  Upserted {inserted}/{len(rows)}...')
    time.sleep(0.3)

print(f'Done. {len(rows)} games upserted for {NBA_SEASON}.')
