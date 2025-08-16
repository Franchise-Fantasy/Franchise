from nba_api.live.nba.endpoints import scoreboard
from nba_api.live.nba.endpoints import boxscore

# Today's Score Board
games = scoreboard.ScoreBoard()

# json
game=games.get_json()




# dictionary
gamess=games.get_dict()

games_list = gamess["scoreboard"]["games"]

# Loop through each game and extract relevant information
for game in games_list:
    game_id = game["gameId"]
    game_status = game["gameStatusText"]
    game_time = game["gameTimeUTC"]
    home_team = game["homeTeam"]["teamName"]
    away_team = game["awayTeam"]["teamName"]
    home_team_score = game["homeTeam"]["score"]
    away_team_score = game["awayTeam"]["score"]
    period = game["period"]
    game_clock = game["gameClock"]

    box=boxscore.BoxScore(game_id)

    boxx=box.get_dict()

    print(f"\n{home_team} Box Score:")
    home_players = boxx['game']['homeTeam']['players']
    #print(home_players)
    for player in home_players:
        player_name = player["name"]
        points = player["statistics"].get("points", 0)
        rebounds = player["statistics"].get("reboundsTotal", 0)
        assists = player["statistics"].get("assists", 0)
        block = player["statistics"].get("blocks", 0)
        steals = player["statistics"].get("steals", 0)
        turnovers = player["statistics"].get("turnovers", 0)
        print(f"  {player_name}: {points} PTS, {rebounds} REB, {assists} AST, {block} BLK, {steals} STL, {turnovers} TO")
    
    # Print the away team's box score
    print(f"\n{away_team} Box Score:")
    away_players = boxx['game']['awayTeam']['players']
    for player in away_players:
        player_name = player["name"]
        points = player["statistics"].get("points", 0)
        rebounds = player["statistics"].get("reboundsTotal", 0)
        assists = player["statistics"].get("assists", 0)
        block = player["statistics"].get("blocks", 0)
        steals = player["statistics"].get("steals", 0)
        turnovers = player["statistics"].get("turnovers", 0)
        print(f"  {player_name}: {points} PTS, {rebounds} REB, {assists} AST, {block} BLK, {steals} STL, {turnovers} TO")
    
    # print(f"Game ID: {game_id}")
    # print(f"Game Status: {game_status}")
    # print(f"Game Time: {game_time}")
    # print(f"{home_team} vs {away_team}")
    # print(f"Score: {home_team_score} - {away_team_score}")
    # print(f"Current Period: {period}, Game Clock: {game_clock}")
    # print("-" * 50)


# print(gamess)