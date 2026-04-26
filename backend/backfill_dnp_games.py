"""
Backfill DNP (Did Not Play) games into player_games.

Purely database-driven — no NBA API calls needed.

For each player:
1. Fetches their existing player_games records (game_id + matchup)
2. Cross-references with nba_schedule to determine which team they were on per game:
   - "vs X" means player was home team, "@X" means player was away team
3. Groups by team to build stints (date ranges per team, handles trades)
4. Finds completed nba_schedule games within each stint that are missing
5. Inserts those as zero-stat DNP rows
"""

import os
from collections import defaultdict
from datetime import datetime

from supabase import create_client

BATCH_SIZE = 50

supabase_url = 'https://iuqbossmnsezzgocpcbo.supabase.co'
supabase_key = os.environ['SB_SECRET_KEY']
sb = create_client(supabase_url, supabase_key)


def paginated_fetch(table, select, filters=None):
    """Fetch all rows from a table, paginated past the 1000-row limit."""
    all_rows = []
    page_size = 1000
    offset = 0
    while True:
        q = sb.table(table).select(select)
        if filters:
            for col, val in filters:
                q = q.eq(col, val)
        result = q.range(offset, offset + page_size - 1).execute()
        all_rows.extend(result.data)
        if len(result.data) < page_size:
            break
        offset += page_size
    return all_rows


def fetch_schedule_by_game_id():
    """Fetch all completed nba_schedule games, keyed by game_id."""
    rows = paginated_fetch('nba_schedule', 'game_id, game_date, home_team, away_team, status')
    games = {}
    for row in rows:
        if row['status'] == 'final':
            games[row['game_id']] = row
    return games


def build_team_game_index(all_games):
    """Map each team abbreviation to its list of completed schedule entries."""
    index = defaultdict(list)
    for game in all_games.values():
        index[game['home_team']].append(game)
        index[game['away_team']].append(game)
    return index


def get_player_team_stints(player_games, schedule):
    """
    Derive team stints from existing player_games + nba_schedule.

    For each game the player played:
    - Look up game_id in nba_schedule to get home_team / away_team
    - Use matchup to determine which team the player was on:
      "vs X" → home team, "@X" → away team
    - Fall back to players.nba_team if matchup is null

    Returns list of (team, first_date, last_date) tuples.
    """
    team_dates = defaultdict(list)

    for pg in player_games:
        sched = schedule.get(pg['game_id'])
        if not sched:
            continue

        game_date = datetime.strptime(sched['game_date'], '%Y-%m-%d').date()
        matchup = pg.get('matchup') or ''

        if matchup.startswith('vs '):
            team = sched['home_team']
        elif matchup.startswith('@'):
            team = sched['away_team']
        else:
            # No matchup data — try to infer from nba_team
            nba_team = pg.get('_nba_team')
            if nba_team and nba_team in (sched['home_team'], sched['away_team']):
                team = nba_team
            else:
                continue

        team_dates[team].append(game_date)

    stints = []
    for team, dates in team_dates.items():
        dates.sort()
        stints.append((team, dates[0], dates[-1]))
    return stints


def find_missing_games(stints, existing_game_ids, team_game_index):
    """Find completed schedule games within each stint that the player missed."""
    missing = []
    for team, start_date, end_date in stints:
        for sched in team_game_index.get(team, []):
            game_id = sched['game_id']
            game_date = datetime.strptime(sched['game_date'], '%Y-%m-%d').date()

            if game_date < start_date or game_date > end_date:
                continue
            if game_id in existing_game_ids:
                continue

            if team == sched['home_team']:
                matchup = f"vs {sched['away_team']}"
            else:
                matchup = f"@{sched['home_team']}"

            missing.append({
                'game_id': game_id,
                'game_date': sched['game_date'],
                'matchup': matchup,
            })
    return missing


def main():
    print("Fetching completed games from nba_schedule...")
    schedule = fetch_schedule_by_game_id()
    team_game_index = build_team_game_index(schedule)
    print(f"  {len(schedule)} completed games")

    print("Fetching all players...")
    players = paginated_fetch('players', 'id, pro_team')
    print(f"  {len(players)} players")

    print("Fetching all player_games...")
    all_player_games = paginated_fetch('player_games', 'player_id, game_id, matchup')
    # Group by player_id
    games_by_player = defaultdict(list)
    for pg in all_player_games:
        games_by_player[pg['player_id']].append(pg)
    print(f"  {len(all_player_games)} game records across {len(games_by_player)} players\n")

    total_inserted = 0
    batch = []

    def flush_batch():
        nonlocal batch, total_inserted
        if batch:
            sb.table('player_games').insert(batch).execute()
            total_inserted += len(batch)
            batch = []

    for i, player in enumerate(players, 1):
        pid = player['id']
        player_game_rows = games_by_player.get(pid, [])

        if not player_game_rows:
            continue

        # Attach nba_team as fallback for null matchups
        for pg in player_game_rows:
            pg['_nba_team'] = player['pro_team']

        stints = get_player_team_stints(player_game_rows, schedule)
        if not stints:
            continue

        existing_ids = {pg['game_id'] for pg in player_game_rows}
        missing = find_missing_games(stints, existing_ids, team_game_index)

        if not missing:
            continue

        for game in missing:
            batch.append({
                'player_id': pid,
                'game_id': game['game_id'],
                'game_date': game['game_date'],
                'matchup': game['matchup'],
                'min': 0,
                'pts': 0,
                'reb': 0,
                'ast': 0,
                'stl': 0,
                'blk': 0,
                'tov': 0,
                'fgm': 0,
                'fga': 0,
                '3pm': 0,
                '3pa': 0,
                'ftm': 0,
                'fta': 0,
                'pf': 0,
                'double_double': False,
                'triple_double': False,
            })

        stint_info = ', '.join(f"{t} ({s}→{e})" for t, s, e in stints)
        print(f"[{i}/{len(players)}] +{len(missing)} DNP — {stint_info}")

        if len(batch) >= BATCH_SIZE:
            flush_batch()

    flush_batch()
    print(f"\nDone! Inserted {total_inserted} DNP records.")


if __name__ == "__main__":
    main()
