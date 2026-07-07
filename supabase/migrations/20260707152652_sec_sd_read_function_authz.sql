-- Security review 2026-07-07 — Batch 1: SECURITY DEFINER read/mutate authorization.
--
-- These SECURITY DEFINER functions bypass RLS and previously returned or mutated
-- per-team / per-league state with no caller ownership/membership check (IDOR).
-- Add the missing guards. Legit callers are unaffected (they own the team / are
-- members); attackers passing another team's/league's id now get no rows / error.

-- 1. get_draft_queue — a team's draft queue is private strategy. Only the team's
--    OWNER may read it (sibling get_draft_room_init already checks this).
CREATE OR REPLACE FUNCTION public.get_draft_queue(p_draft_id uuid, p_team_id uuid, p_league_id uuid)
 RETURNS TABLE(queue_id uuid, player_id uuid, priority integer, name text, "position" text, sport text, pro_team text, status text, external_id_nba text, rookie boolean, season_added text, draft_year integer, birthdate date, games_played integer, total_pts integer, total_reb integer, total_ast integer, total_stl integer, total_blk integer, total_tov integer, total_fgm integer, total_fga integer, total_3pm integer, total_3pa integer, total_ftm integer, total_fta integer, total_pf integer, total_dd integer, total_td integer, avg_pts numeric, avg_reb numeric, avg_ast numeric, avg_stl numeric, avg_blk numeric, avg_tov numeric, avg_fgm numeric, avg_fga numeric, avg_3pm numeric, avg_3pa numeric, avg_ftm numeric, avg_fta numeric, avg_pf numeric, avg_min numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT dq.id AS queue_id, pss.player_id, dq.priority,
    pss.name, pss."position", pss.sport, pss.pro_team, pss.status,
    pss.external_id_nba, pss.rookie, pss.season_added,
    pss.draft_year, pss.birthdate, pss.games_played,
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
    AND EXISTS (SELECT 1 FROM teams t WHERE t.id = p_team_id AND t.user_id = (SELECT auth.uid()))
    AND dq.player_id NOT IN (
      SELECT lp.player_id FROM league_players lp WHERE lp.league_id = p_league_id
    )
  ORDER BY dq.priority;
$function$;

-- 2. get_team_roster_for_trade — restrict to league members.
CREATE OR REPLACE FUNCTION public.get_team_roster_for_trade(p_league_id uuid, p_team_id uuid)
 RETURNS TABLE(roster_slot text, player_id uuid, name text, "position" text, sport text, pro_team text, status text, external_id_nba text, rookie boolean, season_added text, draft_year integer, birthdate date, games_played integer, total_pts integer, total_reb integer, total_ast integer, total_stl integer, total_blk integer, total_tov integer, total_fgm integer, total_fga integer, total_3pm integer, total_3pa integer, total_ftm integer, total_fta integer, total_pf integer, total_dd integer, total_td integer, avg_pts numeric, avg_reb numeric, avg_ast numeric, avg_stl numeric, avg_blk numeric, avg_tov numeric, avg_fgm numeric, avg_fga numeric, avg_3pm numeric, avg_3pa numeric, avg_ftm numeric, avg_fta numeric, avg_pf numeric, avg_min numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT lp.roster_slot, pss.*
  FROM league_players lp
  JOIN player_season_stats pss ON pss.player_id = lp.player_id
  WHERE lp.league_id = p_league_id
    AND lp.team_id = p_team_id
    AND is_league_member(p_league_id);
$function$;

-- 3. get_team_roster_stats — restrict to league members.
CREATE OR REPLACE FUNCTION public.get_team_roster_stats(p_league_id uuid, p_team_id uuid)
 RETURNS SETOF player_season_stats
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT pss.*
  FROM league_players lp
  JOIN player_season_stats pss ON pss.player_id = lp.player_id
  WHERE lp.league_id = p_league_id
    AND lp.team_id = p_team_id
    AND is_league_member(p_league_id);
$function$;

-- 4. get_league_roster_stats — restrict to league members.
CREATE OR REPLACE FUNCTION public.get_league_roster_stats(p_league_id uuid)
 RETURNS TABLE(team_id uuid, player_id uuid, name text, "position" text, sport text, pro_team text, status text, external_id_nba text, rookie boolean, season_added text, draft_year integer, birthdate date, games_played integer, total_pts integer, total_reb integer, total_ast integer, total_stl integer, total_blk integer, total_tov integer, total_fgm integer, total_fga integer, total_3pm integer, total_3pa integer, total_ftm integer, total_fta integer, total_pf integer, total_dd integer, total_td integer, avg_pts numeric, avg_reb numeric, avg_ast numeric, avg_stl numeric, avg_blk numeric, avg_tov numeric, avg_fgm numeric, avg_fga numeric, avg_3pm numeric, avg_3pa numeric, avg_ftm numeric, avg_fta numeric, avg_pf numeric, avg_min numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT lp.team_id, pss.*
  FROM league_players lp
  JOIN player_season_stats pss ON pss.player_id = lp.player_id
  WHERE lp.league_id = p_league_id
    AND lp.team_id IS NOT NULL
    AND is_league_member(p_league_id);
$function$;

-- 5. increment_team_count — a client caller must be a member of the league it is
--    bumping (service-role callers, auth.uid() NULL, are allowed for crons/edge).
CREATE OR REPLACE FUNCTION public.increment_team_count(league_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  new_count integer;
begin
  if (select auth.uid()) is not null
     and not exists (
       select 1 from teams
       where teams.league_id = increment_team_count.league_id
         and teams.user_id = (select auth.uid())
     ) then
    raise exception 'Not authorized';
  end if;

  update leagues
  set current_teams = current_teams + 1
  where id = increment_team_count.league_id
  returning current_teams into new_count;

  return new_count;
end;
$function$;

-- 6. decrement_team_count — same guard.
CREATE OR REPLACE FUNCTION public.decrement_team_count(lid uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  new_count integer;
begin
  if (select auth.uid()) is not null
     and not exists (
       select 1 from teams
       where teams.league_id = lid
         and teams.user_id = (select auth.uid())
     ) then
    raise exception 'Not authorized';
  end if;

  update leagues
  set current_teams = greatest(coalesce(current_teams, 0) - 1, 0)
  where id = lid
  returning current_teams into new_count;

  return new_count;
end;
$function$;
