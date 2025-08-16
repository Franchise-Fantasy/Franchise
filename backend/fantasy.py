from nba_api.stats.endpoints import playerindex

# Get all players
player = playerindex.PlayerIndex()
players = player.get_dict()
data = players['resultSets'][0]['rowSet']

# Sort players by last name and get first 10
# data[1] is the last name, data[2] is the first name
sorted_players = sorted(data, key=lambda x: x[1])[:10]

# Print each player's info
for player in sorted_players:
    print(player)  # First name, Last name, Team