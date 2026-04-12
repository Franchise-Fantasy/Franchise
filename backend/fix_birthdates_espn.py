"""
Fix incorrect player birthdates using ESPN roster API.
Overwrites ALL birthdates (not just nulls) to correct bad data.
Uses normalized name matching with diacritics stripped.

Usage:
    python fix_birthdates_espn.py
"""

import os
import re
import time
import unicodedata

import requests

from supabase import create_client

SUPABASE_URL = 'https://iuqbossmnsezzgocpcbo.supabase.co'
SUPABASE_KEY = os.environ['SB_SECRET_KEY']

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def normalize(name):
    """Strip diacritics, suffixes, punctuation for fuzzy matching."""
    name = unicodedata.normalize('NFD', name)
    name = ''.join(c for c in name if unicodedata.category(c) != 'Mn')
    name = name.lower()
    name = re.sub(r'\b(jr|sr|ii|iii|iv|v)\b\.?', '', name)
    name = re.sub(r"[.'\\-]", '', name)
    return name.strip()


# 1. Fetch all ESPN birthdates from team rosters
print('Fetching birthdates from ESPN...', flush=True)
resp = requests.get(
    'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams',
    timeout=15,
)
resp.raise_for_status()
teams = resp.json()['sports'][0]['leagues'][0]['teams']

espn_birthdates = {}  # normalized name -> date string
for entry in teams:
    team = entry['team']
    time.sleep(0.3)
    r = requests.get(
        f'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{team["id"]}/roster',
        timeout=15,
    )
    if r.status_code != 200:
        print(f'  Failed: {team["displayName"]}', flush=True)
        continue
    athletes = r.json().get('athletes', [])
    for athlete in athletes:
        name = athlete.get('fullName', '')
        bd = athlete.get('dateOfBirth', '')
        if name and bd:
            espn_birthdates[normalize(name)] = bd[:10]
    print(f'  {team["displayName"]}: {len(athletes)} players', flush=True)

print(f'\n{len(espn_birthdates)} ESPN players with birthdates loaded.', flush=True)

# 2. Fetch ALL players from DB
print('\nFetching players from DB...', flush=True)
page_size = 1000
offset = 0
db_players = []
while True:
    batch = (
        supabase.table('players')
        .select('id, name, birthdate')
        .range(offset, offset + page_size - 1)
        .execute()
        .data
    )
    db_players.extend(batch)
    if len(batch) < page_size:
        break
    offset += page_size

print(f'  {len(db_players)} players in DB.', flush=True)

# 3. Compare and fix
updates = 0
mismatches = []
no_match = []

for p in db_players:
    key = normalize(p['name'])
    espn_date = espn_birthdates.get(key)
    if not espn_date:
        no_match.append(p['name'])
        continue

    current = (p.get('birthdate') or '')[:10]

    if current != espn_date:
        mismatches.append((p['name'], current or '(null)', espn_date))
        supabase.table('players').update({'birthdate': espn_date}).eq('id', p['id']).execute()
        updates += 1

print(f'\nFixed {updates} birthdates.', flush=True)
print(f'{len(no_match)} players not found in ESPN (free agents / retired).', flush=True)

if mismatches:
    print(f'\nMismatches corrected (showing up to 50):', flush=True)
    for name, old, new in mismatches[:50]:
        print(f'  {name}: {old} -> {new}', flush=True)
    if len(mismatches) > 50:
        print(f'  ... and {len(mismatches) - 50} more', flush=True)

if no_match:
    print(f'\nUnmatched players (showing up to 20):', flush=True)
    for n in no_match[:20]:
        print(f'  - {n}', flush=True)
    if len(no_match) > 20:
        print(f'  ... and {len(no_match) - 20} more', flush=True)
