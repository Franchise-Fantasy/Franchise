"""
Seed the nba_schedule table with the full season schedule (past + future).
Uses the nba_api library's ScheduleLeagueV2 endpoint.

Usage:
    python seed_schedule.py              # seeds 2025-26 season
    python seed_schedule.py 2024-25      # seeds a specific season
"""

import os
import sys
import time
from nba_api.stats.endpoints import scheduleleaguev2
from supabase import create_client

SUPABASE_URL = 'https://iuqbossmnsezzgocpcbo.supabase.co'
SUPABASE_KEY = os.environ['SB_SECRET_KEY']

NBA_SEASON = sys.argv[1] if len(sys.argv) > 1 else '2025-26'

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

print(f'Fetching NBA schedule for {NBA_SEASON} via nba_api...')
time.sleep(1)

sched = scheduleleaguev2.ScheduleLeagueV2(league_id='00', season=NBA_SEASON)
data = sched.get_dict()

game_dates = data.get('leagueSchedule', {}).get('gameDates', [])
print(f'  Got {len(game_dates)} game dates.')

rows = []
seen_ids = set()

for gd in game_dates:
    for game in gd.get('games', []):
        game_id = game.get('gameId')
        if not game_id or game_id in seen_ids:
            continue
        seen_ids.add(game_id)

        home = game.get('homeTeam', {})
        away = game.get('awayTeam', {})
        home_tricode = home.get('teamTricode')
        away_tricode = away.get('teamTricode')

        # Skip TBD playoff games (no tricode yet)
        if not home_tricode or not away_tricode:
            continue

        # gameDateEst: "2025-10-22T00:00:00Z"
        game_date = str(game.get('gameDateEst', ''))[:10]
        if not game_date:
            continue

        game_status = game.get('gameStatus', 1)  # 1=scheduled, 2=live, 3=final
        status = 'final' if game_status == 3 else 'scheduled'
        home_score = home.get('score') if game_status == 3 else None
        away_score = away.get('score') if game_status == 3 else None

        game_time_utc = game.get('gameDateTimeUTC')  # e.g. "2025-10-22T23:30:00Z"

        rows.append({
            'game_id': game_id,
            'game_date': game_date,
            'season': NBA_SEASON,
            'home_team': home_tricode,
            'away_team': away_tricode,
            'home_score': home_score,
            'away_score': away_score,
            'status': status,
            'game_time_utc': game_time_utc,
        })

print(f'  Parsed {len(rows)} unique games.')

if not rows:
    print('ERROR: No games parsed.')
    sys.exit(1)

rows.sort(key=lambda g: g['game_date'])
print(f'  First game: {rows[0]["game_date"]}  ({rows[0]["away_team"]} @ {rows[0]["home_team"]})')
print(f'  Last game:  {rows[-1]["game_date"]}  ({rows[-1]["away_team"]} @ {rows[-1]["home_team"]})')

# Upsert in batches of 500
BATCH = 500
inserted = 0
for i in range(0, len(rows), BATCH):
    batch = rows[i:i + BATCH]
    supabase.table('nba_schedule').upsert(batch, on_conflict='game_id').execute()
    inserted += len(batch)
    print(f'  Upserted {inserted}/{len(rows)}...')

print(f'Done. {len(rows)} games upserted for {NBA_SEASON}.')
