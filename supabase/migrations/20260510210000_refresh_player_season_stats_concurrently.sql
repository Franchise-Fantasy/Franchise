-- player_season_stats is a materialized view backing usePlayerSeasonStats /
-- usePlayerRankings (and the FA list). The previous body did a non-concurrent
-- REFRESH, which takes an AccessExclusiveLock and blocks every read on the MV
-- for 700ms-5s while it runs. poll-injuries calls this on every cron tick that
-- finds an update, so any user reading the MV at that moment stalled — most
-- visibly on PlayerDetailModal opens for WNBA leagues, where the MV cache is
-- less likely to be warm in React Query and the modal is the first read.
--
-- The unique index player_season_stats_player_id_idx already exists for
-- exactly this purpose (see migration 20260425000041), so CONCURRENTLY is safe.

CREATE OR REPLACE FUNCTION public.refresh_player_season_stats()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY player_season_stats;
END;
$function$;
