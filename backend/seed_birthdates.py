"""
Populate players.birthdate using ESPN roster API.
Matches by player name.

Usage:
    python seed_birthdates.py
"""

import os
import requests
import time
from supabase import create_client

SUPABASE_URL = 'https://iuqbossmnsezzgocpcbo.supabase.co'
SUPABASE_KEY = os.environ['SB_SECRET_KEY']

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Fetch all team rosters from ESPN
print('Fetching birthdates from ESPN...', flush=True)
resp = requests.get('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams', timeout=15)
resp.raise_for_status()
teams = resp.json()['sports'][0]['leagues'][0]['teams']

birthdate_map = {}
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
    for athlete in r.json().get('athletes', []):
        name = athlete.get('fullName', '')
        bd = athlete.get('dateOfBirth', '')
        if name and bd:
            birthdate_map[name] = bd[:10]
    print(f'  {team["displayName"]}: {len(r.json().get("athletes", []))} players', flush=True)

print(f'\n{len(birthdate_map)} birthdates from ESPN.', flush=True)

# Update Supabase
sb_players = supabase.table('players').select('id, name').is_('birthdate', 'null').execute().data
print(f'{len(sb_players)} players missing birthdates in DB.', flush=True)

updates = 0
no_match = []
for p in sb_players:
    name = p['name']
    if name in birthdate_map:
        supabase.table('players').update({'birthdate': birthdate_map[name]}).eq('id', p['id']).execute()
        updates += 1
    else:
        no_match.append(name)

print(f'\nUpdated {updates} birthdates.', flush=True)
if no_match:
    print(f'{len(no_match)} unmatched (name mismatch or free agent):', flush=True)
    for n in no_match[:20]:
        print(f'  - {n}', flush=True)
    if len(no_match) > 20:
        print(f'  ... and {len(no_match) - 20} more', flush=True)
