import requests

# Step 1: get all teams
teams_url = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams?limit=40'
teams_resp = requests.get(teams_url).json()
teams = teams_resp['sports'][0]['leagues'][0]['teams']
print(f"Found {len(teams)} teams\n")

all_players = []

# Step 2: get roster for each team
for t in teams:
    team = t['team']
    team_id = team['id']
    team_abbr = team['abbreviation']
    roster_url = f"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{team_id}/roster"
    resp = requests.get(roster_url).json()
    athletes = resp.get('athletes', [])
    for athlete in athletes:
        name = athlete.get('displayName', '')
        pos = athlete.get('position', {}).get('abbreviation', 'N/A')
        all_players.append((name, pos, team_abbr))

import json

# Dump the full first athlete object to see all available fields
for t in teams[:1]:
    team = t['team']
    roster_url = f"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{team['id']}/roster"
    resp = requests.get(roster_url).json()
    first = resp.get('athletes', [])[0]
    print("Full athlete object:")
    print(json.dumps(first, indent=2))
