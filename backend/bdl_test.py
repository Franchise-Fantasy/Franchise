import requests

url = 'https://www.balldontlie.io/api/v1/players?per_page=100&page=1'
r = requests.get(url)
print("Status:", r.status_code)
print("Raw response:", r.text[:500])
data = r.json()

players = data.get('data', [])
print(f"Players on page 1: {len(players)}\n")

for p in players[:30]:
    name = f"{p['first_name']} {p['last_name']}"
    pos = p.get('position', 'N/A')
    team = p.get('team', {}).get('abbreviation', 'N/A')
    print(f"{name:<30} {pos:<8} {team}")
