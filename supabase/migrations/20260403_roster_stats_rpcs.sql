-- RPCs that eliminate waterfall queries for roster stats.
-- Each replaces 2-3 sequential client queries with a single server-side join
-- against the player_season_stats materialized view.

-- 1. League roster stats: all rostered players with their team_id
CREATE OR REPLACE FUNCTION public.get_league_roster_stats(p_league_id uuid)
RETURNS TABLE (
  team_id uuid,
  player_id uuid,
  name text,
  "position" text,
  nba_team text,
  status text,
  external_id_nba text,
  rookie boolean,
  season_added text,
  nba_draft_year integer,
  birthdate date,
  games_played bigint,
  total_pts numeric, total_reb numeric, total_ast numeric,
  total_stl numeric, total_blk numeric, total_tov numeric,
  total_fgm numeric, total_fga numeric, total_3pm numeric,
  total_3pa numeric, total_ftm numeric, total_fta numeric,
  total_pf numeric, total_dd numeric, total_td numeric,
  avg_pts numeric, avg_reb numeric, avg_ast numeric,
  avg_stl numeric, avg_blk numeric, avg_tov numeric,
  avg_fgm numeric, avg_fga numeric, avg_3pm numeric,
  avg_3pa numeric, avg_ftm numeric, avg_fta numeric,
  avg_pf numeric, avg_min numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT lp.team_id, pss.*
  FROM league_players lp
  JOIN player_season_stats pss ON pss.player_id = lp.player_id
  WHERE lp.league_id = p_league_id
    AND lp.team_id IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.get_league_roster_stats(uuid) TO authenticated;

-- 2. Team roster stats: players on a specific team
CREATE OR REPLACE FUNCTION public.get_team_roster_stats(p_league_id uuid, p_team_id uuid)
RETURNS SETOF player_season_stats
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT pss.*
  FROM league_players lp
  JOIN player_season_stats pss ON pss.player_id = lp.player_id
  WHERE lp.league_id = p_league_id
    AND lp.team_id = p_team_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_team_roster_stats(uuid, uuid) TO authenticated;

-- 3. Team roster for trade: includes roster_slot
CREATE OR REPLACE FUNCTION public.get_team_roster_for_trade(p_league_id uuid, p_team_id uuid)
RETURNS TABLE (
  roster_slot text,
  player_id uuid,
  name text,
  "position" text,
  nba_team text,
  status text,
  external_id_nba text,
  rookie boolean,
  season_added text,
  nba_draft_year integer,
  birthdate date,
  games_played bigint,
  total_pts numeric, total_reb numeric, total_ast numeric,
  total_stl numeric, total_blk numeric, total_tov numeric,
  total_fgm numeric, total_fga numeric, total_3pm numeric,
  total_3pa numeric, total_ftm numeric, total_fta numeric,
  total_pf numeric, total_dd numeric, total_td numeric,
  avg_pts numeric, avg_reb numeric, avg_ast numeric,
  avg_stl numeric, avg_blk numeric, avg_tov numeric,
  avg_fgm numeric, avg_fga numeric, avg_3pm numeric,
  avg_3pa numeric, avg_ftm numeric, avg_fta numeric,
  avg_pf numeric, avg_min numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT lp.roster_slot, pss.*
  FROM league_players lp
  JOIN player_season_stats pss ON pss.player_id = lp.player_id
  WHERE lp.league_id = p_league_id
    AND lp.team_id = p_team_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_team_roster_for_trade(uuid, uuid) TO authenticated;

-- 4. Draft queue: entries with stats, excluding already-drafted players
CREATE OR REPLACE FUNCTION public.get_draft_queue(
  p_draft_id uuid,
  p_team_id uuid,
  p_league_id uuid
)
RETURNS TABLE (
  queue_id uuid,
  player_id uuid,
  priority integer,
  name text,
  "position" text,
  nba_team text,
  status text,
  external_id_nba text,
  rookie boolean,
  season_added text,
  nba_draft_year integer,
  birthdate date,
  games_played bigint,
  total_pts numeric, total_reb numeric, total_ast numeric,
  total_stl numeric, total_blk numeric, total_tov numeric,
  total_fgm numeric, total_fga numeric, total_3pm numeric,
  total_3pa numeric, total_ftm numeric, total_fta numeric,
  total_pf numeric, total_dd numeric, total_td numeric,
  avg_pts numeric, avg_reb numeric, avg_ast numeric,
  avg_stl numeric, avg_blk numeric, avg_tov numeric,
  avg_fgm numeric, avg_fga numeric, avg_3pm numeric,
  avg_3pa numeric, avg_ftm numeric, avg_fta numeric,
  avg_pf numeric, avg_min numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT dq.id AS queue_id, pss.player_id, dq.priority,
    pss.name, pss.position, pss.nba_team, pss.status,
    pss.external_id_nba, pss.rookie, pss.season_added,
    pss.nba_draft_year, pss.birthdate, pss.games_played,
    pss.total_pts, pss.total_reb, pss.total_ast,
    pss.total_stl, pss.total_blk, pss.total_tov,
    pss.total_fgm, pss.total_fga, pss.total_3pm,
    pss.total_3pa, pss.total_ftm, pss.total_fta,
    pss.total_pf, pss.total_dd, pss.total_td,
    pss.avg_pts, pss.avg_reb, pss.avg_ast,
    pss.avg_stl, pss.avg_blk, pss.avg_tov,
    pss.avg_fgm, pss.avg_fga, pss.avg_3pm,
    pss.avg_3pa, pss.avg_ftm, pss.avg_fta,
    pss.avg_pf, pss.avg_min
  FROM draft_queue dq
  JOIN player_season_stats pss ON pss.player_id = dq.player_id
  WHERE dq.draft_id = p_draft_id
    AND dq.team_id = p_team_id
    AND dq.player_id NOT IN (
      SELECT lp.player_id FROM league_players lp WHERE lp.league_id = p_league_id
    )
  ORDER BY dq.priority;
$$;

GRANT EXECUTE ON FUNCTION public.get_draft_queue(uuid, uuid, uuid) TO authenticated;
