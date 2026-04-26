"""
Map balldontlie player IDs to existing players in the database.

Paginates through the BDL /players endpoint, matches by normalized
name + team abbreviation, and sets external_id_bdl on matched rows.
Reports unmatched players for manual review.

Usage:
    BDL_API_KEY=your_key python seed_bdl_ids.py
"""

import json
import os
import sys
import time
import unicodedata
import requests
from supabase import create_client

SUPABASE_URL = 'https://iuqbossmnsezzgocpcbo.supabase.co'
SUPABASE_KEY = os.environ['SB_SECRET_KEY']
BDL_API_KEY = os.environ.get('BDL_API_KEY', '')
BDL_BASE = 'https://api.balldontlie.io/v1'

if not BDL_API_KEY:
    print('Error: BDL_API_KEY env var is required', flush=True)
    sys.exit(1)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def normalize(name: str) -> str:
    """Strip diacritics, lowercase, remove punctuation for fuzzy matching."""
    name = name.strip()
    nfkd = unicodedata.normalize('NFKD', name)
    ascii_name = ''.join(c for c in nfkd if not unicodedata.combining(c))
    result = ascii_name.lower().replace("'", "").replace("-", " ").replace(".", "")
    # Strip common suffixes
    for suffix in [' iv', ' iii', ' ii', ' jr', ' sr']:
        if result.endswith(suffix):
            result = result[:-len(suffix)]
            break
    return result.strip()


def bdl_fetch_all_players() -> list[dict]:
    """Paginate through all BDL players."""
    all_players = []
    cursor = None
    page = 0

    while True:
        params = {'per_page': '100'}
        if cursor:
            params['cursor'] = str(cursor)

        for attempt in range(5):
            resp = requests.get(
                f'{BDL_BASE}/players',
                headers={'Authorization': BDL_API_KEY},
                params=params,
                timeout=30,
            )
            if resp.status_code == 429:
                wait = 30 * (attempt + 1)
                print(f'  Rate limited, waiting {wait}s...', flush=True)
                time.sleep(wait)
                continue
            resp.raise_for_status()
            break
        else:
            resp.raise_for_status()  # raise on final failure
        data = resp.json()

        players = data.get('data', [])
        all_players.extend(players)
        page += 1
        print(f'  Page {page}: fetched {len(players)} players (total: {len(all_players)})', flush=True)

        cursor = data.get('meta', {}).get('next_cursor')
        if not cursor:
            break

        # Respect rate limits (free tier: 5 req/min = 1 req per 12s)
        time.sleep(13)

    return all_players


def load_db_players() -> list[dict]:
    """Load all players from DB with their current identifiers."""
    all_rows = []
    page_size = 1000
    offset = 0

    while True:
        resp = supabase.table('players').select(
            'id, name, pro_team, external_id_nba, external_id_bdl'
        ).range(offset, offset + page_size - 1).execute()

        rows = resp.data or []
        all_rows.extend(rows)

        if len(rows) < page_size:
            break
        offset += page_size

    return all_rows


CACHE_FILE = os.path.join(os.path.dirname(__file__), 'bdl_players_cache.json')


def main():
    # Use cached BDL data if available (avoids re-fetching on retry)
    if os.path.exists(CACHE_FILE):
        print(f'Loading cached BDL players from {CACHE_FILE}...', flush=True)
        with open(CACHE_FILE, 'r') as f:
            bdl_players = json.load(f)
    else:
        print('Fetching BDL players...', flush=True)
        bdl_players = bdl_fetch_all_players()
        with open(CACHE_FILE, 'w') as f:
            json.dump(bdl_players, f)
        print(f'  Cached to {CACHE_FILE}', flush=True)
    print(f'Total BDL players: {len(bdl_players)}\n', flush=True)

    print('Loading DB players...', flush=True)
    db_players = load_db_players()
    print(f'Total DB players: {len(db_players)}\n', flush=True)

    # Build lookup: normalized name + team -> db player
    # Some players share names, so we use name+team as key
    db_by_name_team: dict[str, dict] = {}
    db_by_name: dict[str, list[dict]] = {}

    for p in db_players:
        name = normalize(p.get('name', ''))
        team = (p.get('pro_team') or '').upper()
        key = f'{name}|{team}'
        db_by_name_team[key] = p
        db_by_name.setdefault(name, []).append(p)

    matched = 0
    unmatched_bdl = []
    already_set = 0
    updates = []

    for bdl in bdl_players:
        bdl_id = bdl['id']
        bdl_name = normalize(f"{bdl.get('first_name', '')} {bdl.get('last_name', '')}")
        bdl_team = (bdl.get('team', {}) or {}).get('abbreviation', '').upper() if bdl.get('team') else ''

        # Skip players without a team (free agents / retired)
        if not bdl_team:
            continue

        # Try name + team match first
        key = f'{bdl_name}|{bdl_team}'
        db_match = db_by_name_team.get(key)

        # Fall back to name-only if exactly one match
        if not db_match:
            name_matches = db_by_name.get(bdl_name, [])
            if len(name_matches) == 1:
                db_match = name_matches[0]

        if db_match:
            if db_match.get('external_id_bdl'):
                already_set += 1
                continue
            updates.append({'id': db_match['id'], 'external_id_bdl': bdl_id})
            matched += 1
        else:
            unmatched_bdl.append({
                'bdl_id': bdl_id,
                'name': f"{bdl.get('first_name', '')} {bdl.get('last_name', '')}",
                'team': bdl_team,
            })

    print(f'Matched: {matched}', flush=True)
    print(f'Already set: {already_set}', flush=True)
    print(f'Unmatched BDL players (have team, not in DB): {len(unmatched_bdl)}', flush=True)

    # Show DB players that didn't get a BDL match
    matched_db_ids = {u['id'] for u in updates}
    already_ids = {p['id'] for p in db_players if p.get('external_id_bdl')}
    unmatched_db = [p for p in db_players if p['id'] not in matched_db_ids and p['id'] not in already_ids and p.get('pro_team')]
    if unmatched_db:
        print(f'\nDB players WITHOUT BDL match ({len(unmatched_db)}):', flush=True)
        for p in unmatched_db:
            name_safe = (p.get('name', '') or '').encode('ascii', 'replace').decode()
        print(f"  {(p.get('pro_team') or ''):4s} {name_safe:30s}", flush=True)

    if unmatched_bdl:
        # Only show BDL players on current NBA teams who aren't in our DB
        # (skip historical players — those are expected misses)
        current_teams = {p.get('pro_team', '').upper() for p in db_players if p.get('pro_team')}
        relevant_unmatched = [p for p in unmatched_bdl if p['team'] in current_teams]
        if relevant_unmatched:
            print(f'\nUnmatched BDL players on active NBA teams ({len(relevant_unmatched)}):', flush=True)
            for p in sorted(relevant_unmatched, key=lambda x: x['team']):
                name_safe = p['name'].encode('ascii', 'replace').decode()
                print(f"  {p['team']:4s} {name_safe:30s} (bdl_id: {p['bdl_id']})", flush=True)

    # Apply updates in batches
    if updates:
        print(f'\nApplying {len(updates)} updates...', flush=True)
        batch_size = 50
        for i in range(0, len(updates), batch_size):
            batch = updates[i:i + batch_size]
            for row in batch:
                supabase.table('players').update(
                    {'external_id_bdl': row['external_id_bdl']}
                ).eq('id', row['id']).execute()
            print(f'  Updated {min(i + batch_size, len(updates))}/{len(updates)}', flush=True)

        print('Done!', flush=True)
    else:
        print('\nNo updates needed.', flush=True)

    # Coverage check
    resp = supabase.table('players').select(
        'id', count='exact'
    ).not_.is_('pro_team', 'null').is_('external_id_bdl', 'null').execute()

    missing_count = resp.count or 0
    total_resp = supabase.table('players').select(
        'id', count='exact'
    ).not_.is_('pro_team', 'null').execute()
    total_active = total_resp.count or 0

    if total_active > 0:
        coverage = ((total_active - missing_count) / total_active) * 100
        print(f'\nCoverage: {total_active - missing_count}/{total_active} active players have BDL ID ({coverage:.1f}%)', flush=True)
        if missing_count > 0:
            print(f'  {missing_count} active players still missing BDL ID', flush=True)
    else:
        print('\nNo active players found in DB.', flush=True)


if __name__ == '__main__':
    main()
