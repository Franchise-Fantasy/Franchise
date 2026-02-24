"""
Backfill missing player_games for specific game IDs.

Fetches box scores per game using BoxScoreTraditionalV3, then maps
NBA player IDs to our player UUIDs and inserts the records.
"""

import time

import requests
from supabase import create_client

CDN_BOX_SCORE_URL = 'https://cdn.nba.com/static/json/liveData/boxscore/boxscore_{game_id}.json'

BATCH_SIZE = 25

# Game ID -> game_date (from nba_schedule)
MISSING_GAMES = {
    # 2/19
    '0022500792': '2026-02-19', '0022500793': '2026-02-19',
    '0022500794': '2026-02-19', '0022500795': '2026-02-19',
    '0022500796': '2026-02-19', '0022500797': '2026-02-19',
    '0022500798': '2026-02-19', '0022500799': '2026-02-19',
    '0022500800': '2026-02-19', '0022500801': '2026-02-19',
    # 2/20
    '0022500802': '2026-02-20', '0022500803': '2026-02-20',
    '0022500804': '2026-02-20', '0022500805': '2026-02-20',
    '0022500806': '2026-02-20', '0022500807': '2026-02-20',
    '0022500808': '2026-02-20', '0022500809': '2026-02-20',
    '0022500810': '2026-02-20',
    # 2/21
    '0022500811': '2026-02-21', '0022500812': '2026-02-21',
    '0022500813': '2026-02-21', '0022500814': '2026-02-21',
    '0022500815': '2026-02-21', '0022500816': '2026-02-21',
}

supabase_url = 'https://iuqbossmnsezzgocpcbo.supabase.co'
supabase_key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1cWJvc3NtbnNlenpnb2NwY2JvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTI4Nzk5MiwiZXhwIjoyMDg2ODYzOTkyfQ.bqe3N6Q-Mj2BZRAVtUl1lCgzdgTnNu081BMouSJTGig'
sb = create_client(supabase_url, supabase_key)


def build_nba_id_to_uuid():
    """Build a mapping of NBA external ID (str) -> player UUID."""
    lookup = {}
    offset = 0
    page_size = 1000
    while True:
        result = sb.table('players').select('id, external_id_nba').range(offset, offset + page_size - 1).execute()
        for row in result.data:
            if row['external_id_nba']:
                lookup[str(row['external_id_nba'])] = row['id']
        if len(result.data) < page_size:
            break
        offset += page_size
    return lookup


def parse_minutes(min_str):
    if not min_str:
        return 0
    s = str(min_str)
    # CDN format: "PT30M41.80S"
    if s.startswith('PT'):
        s = s[2:]  # strip "PT"
        mins = 0
        if 'M' in s:
            mins = int(s.split('M')[0])
        return mins
    # stats.nba.com format: "30:41"
    return int(s.split(':')[0])


def is_double_double(pts, reb, ast, stl, blk):
    return sum(1 for v in [pts, reb, ast, stl, blk] if v >= 10) >= 2


def is_triple_double(pts, reb, ast, stl, blk):
    return sum(1 for v in [pts, reb, ast, stl, blk] if v >= 10) >= 3


def process_team_players(players, game_id, game_date, matchup, nba_to_uuid):
    """Convert a team's player list from box score V3 into insert records."""
    records = []
    for p in players:
        nba_id = str(p['personId'])
        player_uuid = nba_to_uuid.get(nba_id)
        if not player_uuid:
            continue

        s = p['statistics']
        pts = s.get('points', 0) or 0
        reb = s.get('reboundsTotal', 0) or 0
        ast = s.get('assists', 0) or 0
        stl = s.get('steals', 0) or 0
        blk = s.get('blocks', 0) or 0

        records.append({
            'player_id': player_uuid,
            'game_id': game_id,
            'game_date': game_date,
            'matchup': matchup,
            'min': parse_minutes(s.get('minutes')),
            'pts': pts,
            'reb': reb,
            'ast': ast,
            'stl': stl,
            'blk': blk,
            'tov': s.get('turnovers', 0) or 0,
            'fgm': s.get('fieldGoalsMade', 0) or 0,
            'fga': s.get('fieldGoalsAttempted', 0) or 0,
            '3pm': s.get('threePointersMade', 0) or 0,
            '3pa': s.get('threePointersAttempted', 0) or 0,
            'ftm': s.get('freeThrowsMade', 0) or 0,
            'fta': s.get('freeThrowsAttempted', 0) or 0,
            'pf': s.get('foulsPersonal', 0) or 0,
            'double_double': is_double_double(pts, reb, ast, stl, blk),
            'triple_double': is_triple_double(pts, reb, ast, stl, blk),
        })
    return records


if __name__ == "__main__":
    print("Building NBA ID -> player UUID lookup...")
    nba_to_uuid = build_nba_id_to_uuid()
    print(f"  {len(nba_to_uuid)} players mapped")

    # Check which games already have data so we can skip them
    print("Checking which games already have data...")
    games_to_fetch = []
    for game_id in sorted(MISSING_GAMES.keys()):
        result = sb.table('player_games').select('id').eq('game_id', game_id).limit(1).execute()
        if result.data:
            print(f"  {game_id} already has data, skipping")
        else:
            games_to_fetch.append(game_id)
    print(f"  {len(games_to_fetch)} games to fetch\n")

    total_inserted = 0
    batch = []
    max_retries = 3

    for i, game_id in enumerate(games_to_fetch, 1):
        game_date = MISSING_GAMES[game_id]

        for attempt in range(max_retries):
            delay = 1 if attempt == 0 else 5 * attempt
            print(f"[{i}/{len(games_to_fetch)}] {game_id} ({game_date}) attempt {attempt + 1}...")
            time.sleep(delay)

            try:
                url = CDN_BOX_SCORE_URL.format(game_id=game_id)
                resp = requests.get(url, timeout=30)
                resp.raise_for_status()
                game_data = resp.json()['game']

                home = game_data['homeTeam']
                away = game_data['awayTeam']
                home_tri = home['teamTricode']
                away_tri = away['teamTricode']

                home_matchup = f"vs {away_tri}"
                away_matchup = f"@{home_tri}"

                home_records = process_team_players(home['players'], game_id, game_date, home_matchup, nba_to_uuid)
                away_records = process_team_players(away['players'], game_id, game_date, away_matchup, nba_to_uuid)

                batch.extend(home_records)
                batch.extend(away_records)
                print(f"  {home_tri} vs {away_tri}: {len(home_records)} + {len(away_records)} player records")

                if len(batch) >= BATCH_SIZE:
                    sb.table('player_games').insert(batch).execute()
                    total_inserted += len(batch)
                    print(f"  Flushed {len(batch)} records (total: {total_inserted})")
                    batch = []

                break  # success, move to next game

            except Exception as e:
                import traceback
                print(f"  Error: {e}")
                traceback.print_exc()
                if attempt == max_retries - 1:
                    print(f"  FAILED after {max_retries} attempts, skipping {game_id}")

    if batch:
        sb.table('player_games').insert(batch).execute()
        total_inserted += len(batch)

    print(f"\nDone! Inserted {total_inserted} game records.")
