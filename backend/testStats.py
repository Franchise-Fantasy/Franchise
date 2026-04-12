import os
import time

from nba_api.stats.endpoints import playergamelog
from supabase import create_client

CURRENT_SEASON = "2025-26"
BATCH_SIZE = 50

supabase_url = 'https://iuqbossmnsezzgocpcbo.supabase.co'
supabase_key = os.environ['SB_SECRET_KEY']
supabase = create_client(supabase_url, supabase_key)


def fetch_all_players():
    """Fetch all players from supabase, paginated to get past the 1000-row default limit."""
    all_players = []
    page_size = 1000
    offset = 0
    while True:
        result = supabase.table('players').select('id, external_id_nba').range(offset, offset + page_size - 1).execute()
        all_players.extend(result.data)
        if len(result.data) < page_size:
            break
        offset += page_size
    return all_players


def parse_minutes(min_str):
    """Convert 'MM:SS' or 'MM' string to integer minutes. Returns 0 if invalid."""
    if not min_str:
        return 0
    parts = str(min_str).split(':')
    return int(parts[0])


def is_double_double(pts, reb, ast, stl, blk):
    categories = sum(1 for v in [pts, reb, ast, stl, blk] if v >= 10)
    return categories >= 2


def is_triple_double(pts, reb, ast, stl, blk):
    categories = sum(1 for v in [pts, reb, ast, stl, blk] if v >= 10)
    return categories >= 3


def fetch_game_logs(nba_player_id):
    """Fetch game logs from the NBA API for a given player and season."""
    log = playergamelog.PlayerGameLog(player_id=nba_player_id, season=CURRENT_SEASON)
    data = log.get_dict()['resultSets'][0]
    headers = data['headers']
    return [dict(zip(headers, row)) for row in data['rowSet']]


def map_game_to_record(game, player_uuid):
    """Map an NBA API game log row to a player_games table record."""
    pts = game.get('PTS', 0) or 0
    reb = game.get('REB', 0) or 0
    ast = game.get('AST', 0) or 0
    stl = game.get('STL', 0) or 0
    blk = game.get('BLK', 0) or 0

    return {
        'player_id': player_uuid,
        'game_id': game['Game_ID'],
        'min': parse_minutes(game.get('MIN')),
        'pts': pts,
        'reb': reb,
        'ast': ast,
        'stl': stl,
        'blk': blk,
        'tov': game.get('TOV', 0) or 0,
        'fgm': game.get('FGM', 0) or 0,
        'fga': game.get('FGA', 0) or 0,
        '3pm': game.get('FG3M', 0) or 0,
        '3pa': game.get('FG3A', 0) or 0,
        'ftm': game.get('FTM', 0) or 0,
        'fta': game.get('FTA', 0) or 0,
        'pf': game.get('PF', 0) or 0,
        'double_double': is_double_double(pts, reb, ast, stl, blk),
        'triple_double': is_triple_double(pts, reb, ast, stl, blk),
    }


if __name__ == "__main__":
    print("Fetching players from database...")
    players = fetch_all_players()
    print(f"Found {len(players)} players")

    total_games = 0
    skipped = 0
    batch = []

    for i, player in enumerate(players, 1):
        nba_id = player['external_id_nba']
        if not nba_id:
            skipped += 1
            continue

        try:
            time.sleep(0.6)
            games = fetch_game_logs(nba_id)

            if not games:
                print(f"[{i}/{len(players)}] No games for player {nba_id}")
                continue

            for game in games:
                batch.append(map_game_to_record(game, player['id']))

            print(f"[{i}/{len(players)}] {len(games)} games for player {nba_id} (batch: {len(batch)})")

            # Flush batch when it gets large enough
            if len(batch) >= BATCH_SIZE:
                supabase.table('player_games').insert(batch).execute()
                total_games += len(batch)
                batch = []

        except Exception as e:
            print(f"[{i}/{len(players)}] Error for player {nba_id}: {e}")
            continue

    # Insert remaining records
    if batch:
        supabase.table('player_games').insert(batch).execute()
        total_games += len(batch)

    print(f"\nDone! Inserted {total_games} game records. Skipped {skipped} players with no NBA ID.")
