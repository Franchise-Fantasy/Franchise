"""
Backfill player_games for recently added players who are missing game history.

Finds players with external_id_nba but 0 games in player_games, fetches their
game logs from the NBA API, and inserts the records.
"""

import time

from nba_api.stats.endpoints import playergamelog
from supabase import create_client

CURRENT_SEASON = '2025-26'

supabase_url = 'https://iuqbossmnsezzgocpcbo.supabase.co'
supabase_key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1cWJvc3NtbnNlenpnb2NwY2JvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTI4Nzk5MiwiZXhwIjoyMDg2ODYzOTkyfQ.bqe3N6Q-Mj2BZRAVtUl1lCgzdgTnNu081BMouSJTGig'
sb = create_client(supabase_url, supabase_key)


def fetch_with_retry(endpoint_fn, retries=3, delay=5, **kwargs):
    for attempt in range(retries):
        try:
            return endpoint_fn(**kwargs, timeout=120)
        except Exception as e:
            if attempt < retries - 1:
                print(f"    Retry {attempt + 1}: {e}")
                time.sleep(delay)
                delay *= 2
            else:
                raise


def is_double_double(pts, reb, ast, stl, blk):
    return sum(1 for v in [pts, reb, ast, stl, blk] if v >= 10) >= 2


def is_triple_double(pts, reb, ast, stl, blk):
    return sum(1 for v in [pts, reb, ast, stl, blk] if v >= 10) >= 3


if __name__ == "__main__":
    # 1. Find players with no game history
    print("Finding players with no game history...")
    all_players = []
    offset = 0
    while True:
        result = sb.table('players').select('id, external_id_nba, name').not_.is_('external_id_nba', 'null').range(offset, offset + 999).execute()
        all_players.extend(result.data)
        if len(result.data) < 1000:
            break
        offset += 1000

    # Check which ones have 0 games
    players_to_backfill = []
    for p in all_players:
        result = sb.table('player_games').select('id', count='exact', head=True).eq('player_id', p['id']).execute()
        if result.count == 0:
            players_to_backfill.append(p)

    print(f"  {len(players_to_backfill)} players need backfill")

    if not players_to_backfill:
        print("Nothing to backfill. Done!")
        exit(0)

    # 2. Fetch game logs for each player
    total_inserted = 0
    for i, player in enumerate(players_to_backfill, 1):
        nba_id = int(player['external_id_nba'])
        name = player['name']
        player_uuid = player['id']

        print(f"[{i}/{len(players_to_backfill)}] {name} (NBA ID: {nba_id})")

        try:
            time.sleep(0.6)
            log = fetch_with_retry(
                playergamelog.PlayerGameLog,
                player_id=nba_id,
                season=CURRENT_SEASON,
            )
            df = log.get_data_frames()[0]

            if df.empty:
                print(f"  No games this season")
                continue

            records = []
            for _, row in df.iterrows():
                game_id = row['Game_ID']
                game_date = row['GAME_DATE']
                matchup = row.get('MATCHUP', '')

                pts = int(row.get('PTS', 0) or 0)
                reb = int(row.get('REB', 0) or 0)
                ast = int(row.get('AST', 0) or 0)
                stl = int(row.get('STL', 0) or 0)
                blk = int(row.get('BLK', 0) or 0)

                # Parse minutes from "MM:SS" format
                min_str = str(row.get('MIN', '0') or '0')
                mins = int(min_str.split(':')[0]) if ':' in min_str else int(min_str)

                records.append({
                    'player_id': player_uuid,
                    'game_id': game_id,
                    'game_date': game_date,
                    'matchup': matchup,
                    'min': mins,
                    'pts': pts,
                    'reb': reb,
                    'ast': ast,
                    'stl': stl,
                    'blk': blk,
                    'tov': int(row.get('TOV', 0) or 0),
                    'fgm': int(row.get('FGM', 0) or 0),
                    'fga': int(row.get('FGA', 0) or 0),
                    '3pm': int(row.get('FG3M', 0) or 0),
                    '3pa': int(row.get('FG3A', 0) or 0),
                    'ftm': int(row.get('FTM', 0) or 0),
                    'fta': int(row.get('FTA', 0) or 0),
                    'pf': int(row.get('PF', 0) or 0),
                    'double_double': is_double_double(pts, reb, ast, stl, blk),
                    'triple_double': is_triple_double(pts, reb, ast, stl, blk),
                })

            if records:
                sb.table('player_games').upsert(
                    records,
                    on_conflict='player_id,game_id',
                ).execute()
                total_inserted += len(records)
                print(f"  {len(records)} games inserted")

        except Exception as e:
            print(f"  Error: {e}")
            continue

    # 3. Refresh materialized view
    print(f"\nInserted {total_inserted} total game records.")
    print("Refreshing player_season_stats materialized view...")
    sb.rpc('refresh_player_season_stats').execute()
    print("Done!")
