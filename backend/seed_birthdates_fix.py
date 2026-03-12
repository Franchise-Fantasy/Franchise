"""
Fix remaining birthdate mismatches by stripping diacritics for fuzzy name matching.

Usage:
    python seed_birthdates_fix.py
"""

import unicodedata
import time
import requests
from supabase import create_client

SUPABASE_URL = 'https://iuqbossmnsezzgocpcbo.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1cWJvc3NtbnNlenpnb2NwY2JvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTI4Nzk5MiwiZXhwIjoyMDg2ODYzOTkyfQ.bqe3N6Q-Mj2BZRAVtUl1lCgzdgTnNu081BMouSJTGig'

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def normalize(name):
    """Strip diacritics and lowercase for fuzzy matching."""
    name = name.strip()
    nfkd = unicodedata.normalize('NFKD', name)
    ascii_name = ''.join(c for c in nfkd if not unicodedata.combining(c))
    return ascii_name.lower().replace("'", "").replace("-", " ")


# Fetch ESPN birthdates
print('Fetching ESPN rosters...', flush=True)
resp = requests.get('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams', timeout=15)
teams = resp.json()['sports'][0]['leagues'][0]['teams']

espn_birthdates = {}
for entry in teams:
    team = entry['team']
    time.sleep(0.3)
    r = requests.get(
        f'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{team["id"]}/roster',
        timeout=15,
    )
    if r.status_code != 200:
        continue
    for athlete in r.json().get('athletes', []):
        name = athlete.get('fullName', '')
        bd = athlete.get('dateOfBirth', '')
        if name and bd:
            espn_birthdates[normalize(name)] = bd[:10]

print(f'{len(espn_birthdates)} ESPN players loaded.', flush=True)

# Get unmatched DB players
sb_players = supabase.table('players').select('id, name').is_('birthdate', 'null').execute().data
print(f'{len(sb_players)} players still missing birthdates.', flush=True)

updates = 0
still_missing = []
for p in sb_players:
    db_name = p['name']
    key = normalize(db_name)
    if key in espn_birthdates:
        supabase.table('players').update({'birthdate': espn_birthdates[key]}).eq('id', p['id']).execute()
        updates += 1
    else:
        still_missing.append(db_name)

print(f'\nUpdated {updates} more birthdates.', flush=True)
if still_missing:
    print(f'{len(still_missing)} still missing:', flush=True)
    for n in still_missing:
        try:
            print(f'  - {n}', flush=True)
        except UnicodeEncodeError:
            print(f'  - {normalize(n)}', flush=True)
