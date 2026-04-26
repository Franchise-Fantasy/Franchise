"""
Sync player positions from Sleeper's public player database.

Sleeper provides fantasy_positions (e.g. ["PG", "SG"]) which map directly
to our app's position spectrum format (e.g. "PG-SG").

BDL sync handles team changes and new player detection — this script
is the sole authority for position data.

Usage:
    python sync_positions.py
"""

import os
import re
import unicodedata

import requests
from supabase import create_client

SUPABASE_URL = 'https://iuqbossmnsezzgocpcbo.supabase.co'
SUPABASE_KEY = os.environ['SB_SECRET_KEY']

SLEEPER_PLAYERS_URL = 'https://api.sleeper.app/v1/players/nba'

# Must match POSITION_SPECTRUM in utils/rosterSlots.ts
POSITION_SPECTRUM = ['PG', 'SG', 'SF', 'PF', 'C']

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def normalize(name):
    """Strip diacritics, suffixes, punctuation for fuzzy matching."""
    name = unicodedata.normalize('NFD', name)
    name = ''.join(c for c in name if unicodedata.category(c) != 'Mn')
    name = name.lower()
    name = re.sub(r'\b(jr|sr|ii|iii|iv|v)\b\.?', '', name)
    name = re.sub(r"[.'\\-]", '', name)
    return name.strip()


def build_position(fantasy_positions):
    """
    Convert Sleeper's fantasy_positions list (e.g. ["PG", "SG"]) into our
    spectrum format (e.g. "PG-SG").

    Uses the position spectrum to find the range endpoints. If positions
    span a range, everything in between is implied by the spectrum format.
    """
    if not fantasy_positions:
        return None

    valid = [p for p in fantasy_positions if p in POSITION_SPECTRUM]
    if not valid:
        return None

    indices = [POSITION_SPECTRUM.index(p) for p in valid]
    lo = min(indices)
    hi = max(indices)

    if lo == hi:
        return POSITION_SPECTRUM[lo]

    return f'{POSITION_SPECTRUM[lo]}-{POSITION_SPECTRUM[hi]}'


def main():
    # 1. Fetch Sleeper player database (~5MB)
    print('Fetching Sleeper player database...', flush=True)
    resp = requests.get(SLEEPER_PLAYERS_URL, timeout=60)
    resp.raise_for_status()
    sleeper_players = resp.json()
    print(f'  Got {len(sleeper_players)} Sleeper entries', flush=True)

    # 2. Build name→position map from Sleeper (active NBA players only)
    sleeper_by_name = {}  # normalized name → position string
    sleeper_by_name_team = {}  # "normalized name|TEAM" → position string

    for pid, sp in sleeper_players.items():
        if sp.get('sport') != 'nba' or not sp.get('active'):
            continue

        fp = sp.get('fantasy_positions') or ([sp['position']] if sp.get('position') else None)
        position = build_position(fp)
        if not position:
            continue

        name = sp.get('full_name') or f"{sp.get('first_name', '')} {sp.get('last_name', '')}".strip()
        if not name:
            continue

        norm = normalize(name)
        team = (sp.get('team') or '').upper()

        if team:
            sleeper_by_name_team[f'{norm}|{team}'] = position
        sleeper_by_name[norm] = position

    print(f'  Mapped {len(sleeper_by_name)} active players with positions', flush=True)

    # 3. Fetch our players
    print('Fetching DB players...', flush=True)
    result = supabase.table('players').select('id, name, position, pro_team').execute()
    db_players = result.data or []
    print(f'  Got {len(db_players)} DB players', flush=True)

    # 4. Match and collect updates
    updates = []
    unmatched = []

    for p in db_players:
        norm = normalize(p['name'])
        team = (p.get('pro_team') or '').upper()

        # Try name+team first, then name only
        new_pos = sleeper_by_name_team.get(f'{norm}|{team}') or sleeper_by_name.get(norm)

        if not new_pos:
            if team:  # only flag unmatched active players
                unmatched.append(p['name'])
            continue

        if p.get('position') != new_pos:
            updates.append({'id': p['id'], 'position': new_pos})

    print(f'\n  {len(updates)} positions to update', flush=True)
    if unmatched:
        print(f'  {len(unmatched)} active players not matched in Sleeper:', flush=True)
        for name in sorted(unmatched)[:20]:
            print(f'    - {name}')
        if len(unmatched) > 20:
            print(f'    ... and {len(unmatched) - 20} more')

    # 5. Batch update
    if updates:
        print('\nUpdating positions...', flush=True)
        for i in range(0, len(updates), 50):
            chunk = updates[i:i + 50]
            for u in chunk:
                supabase.table('players').update({'position': u['position']}).eq('id', u['id']).execute()
            print(f'  Updated {min(i + 50, len(updates))}/{len(updates)}', flush=True)

    print('\nDone!', flush=True)

    # 6. Summary
    if updates:
        print(f'\nSample updates:')
        for u in updates[:15]:
            player = next(p for p in db_players if p['id'] == u['id'])
            print(f'  {player["name"]}: {player.get("position")} -> {u["position"]}')


if __name__ == '__main__':
    main()
