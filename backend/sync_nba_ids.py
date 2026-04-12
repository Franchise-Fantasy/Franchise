"""
Backfill external_id_nba on existing players.

The Supabase sync-players edge function (BDL + Sleeper) handles inserts,
team changes, and positions. But NBA Stats API is blocked from Supabase
edge runtime, so external_id_nba (which the headshot CDN URL is built from)
can't be populated from there.

This script runs from a GitHub Actions runner — those IPs aren't blocked
by NBA.com — and backfills external_id_nba for any DB player still missing
one. Headshot URLs become valid as soon as the ID lands.

Idempotent: only touches rows where external_id_nba IS NULL.
"""

import os
import re
import time
import unicodedata

from nba_api.stats.endpoints import commonallplayers
from nba_api.stats.library.http import NBAStatsHTTP
from supabase import create_client

# NBA Stats requires browser-like headers or it will timeout/block
CUSTOM_HEADERS = {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': 'https://www.nba.com',
    'Referer': 'https://www.nba.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
}
NBAStatsHTTP.nba_response = None

# Must match CURRENT_NBA_SEASON in constants/LeagueDefaults.ts
CURRENT_SEASON = '2025-26'

SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://iuqbossmnsezzgocpcbo.supabase.co')
SUPABASE_KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def normalize(name: str) -> str:
    """Match the normalizer in supabase/functions/_shared/normalize.ts."""
    name = unicodedata.normalize('NFD', name)
    name = ''.join(c for c in name if unicodedata.category(c) != 'Mn')
    name = name.lower()
    name = re.sub(r'\b(jr|sr|ii|iii|iv|v)\b\.?', '', name)
    name = re.sub(r"[.'\-]", '', name)
    name = re.sub(r'\s+', ' ', name)
    return name.strip()


def fetch_with_retry(retries=4, delay=5):
    """Call commonallplayers with retries on transient failures."""
    for attempt in range(retries):
        try:
            resp = commonallplayers.CommonAllPlayers(
                is_only_current_season=1,
                season=CURRENT_SEASON,
                headers=CUSTOM_HEADERS,
                timeout=180,
            )
            return resp.get_data_frames()[0]
        except Exception as e:
            if attempt < retries - 1:
                wait = delay * (2 ** attempt)
                print(f'  attempt {attempt + 1} failed: {e}. retrying in {wait}s...', flush=True)
                time.sleep(wait)
            else:
                raise


def main():
    print('fetching players missing external_id_nba...', flush=True)
    result = supabase.table('players').select('id, name, nba_team').is_('external_id_nba', 'null').execute()
    missing = result.data or []
    print(f'  {len(missing)} rows to backfill', flush=True)

    if not missing:
        print('nothing to do.')
        return

    print(f'fetching active NBA players (season {CURRENT_SEASON})...', flush=True)
    df = fetch_with_retry()
    print(f'  {len(df)} active players from NBA Stats', flush=True)

    # Build name → person_id map (with team disambiguation)
    by_name_team = {}
    by_name = {}
    for _, row in df.iterrows():
        person_id = int(row['PERSON_ID'])
        name = str(row.get('DISPLAY_FIRST_LAST') or '').strip()
        if not name:
            continue
        norm = normalize(name)
        team = str(row.get('TEAM_ABBREVIATION') or '').upper()
        if team:
            by_name_team[f'{norm}|{team}'] = person_id
        by_name[norm] = person_id

    # Match and queue updates
    updates = []
    unmatched = []
    for p in missing:
        norm = normalize(p['name'])
        team = (p.get('nba_team') or '').upper()
        person_id = by_name_team.get(f'{norm}|{team}') or by_name.get(norm)
        if person_id:
            updates.append({'id': p['id'], 'name': p['name'], 'external_id_nba': person_id})
        else:
            unmatched.append(p['name'])

    print(f'\n{len(updates)} matched, {len(unmatched)} unmatched', flush=True)

    if updates:
        print('\nupdating...', flush=True)
        for u in updates:
            supabase.table('players').update({'external_id_nba': u['external_id_nba']}).eq('id', u['id']).execute()
            print(f"  {u['name']} -> {u['external_id_nba']}", flush=True)

    if unmatched:
        print(f'\nunmatched players (no NBA Stats record found):', flush=True)
        for name in sorted(unmatched)[:30]:
            print(f'  - {name}')
        if len(unmatched) > 30:
            print(f'  ... and {len(unmatched) - 30} more')

    print('\ndone.')


if __name__ == '__main__':
    main()
