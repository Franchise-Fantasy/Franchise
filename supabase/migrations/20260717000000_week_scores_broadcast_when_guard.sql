-- week_scores_broadcast: only broadcast rows whose score actually changed.
--
-- get-week-scores upserts EVERY team's week_scores row each poll cycle with a
-- fresh updated_at, so every row is a genuine UPDATE and the old unconditional
-- trigger broadcast `teams × live-leagues` no-op messages per cycle — each one
-- fanned out to every subscribed client (matchup tab, roster tab, scoreboard)
-- and inserted into realtime.messages. During live games that was the bulk of
-- realtime fanout, ~all of it messages that changed nothing.
--
-- A WHEN clause on a shared INSERT-OR-UPDATE trigger can't reference OLD, so
-- the guard is two triggers: INSERT always broadcasts (first score of the
-- cycle), UPDATE only when score changed. The broadcast payload carries only
-- (schedule_id, team_id, score), so `score` is the complete change signal.
--
-- This migration also captures broadcast_week_score() itself: the function +
-- trigger were previously applied directly to the remote project and existed
-- in no migration (schema drift — a from-scratch replay would silently lose
-- live score delivery; clients would degrade to their polling fallbacks).

CREATE OR REPLACE FUNCTION public.broadcast_week_score()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  perform realtime.send(
    jsonb_build_object(
      'schedule_id', new.schedule_id,
      'team_id', new.team_id,
      'score', new.score
    ),
    'score_update',
    'scores:' || new.schedule_id::text,
    false  -- public channel (E3 will make it private)
  );
  return null;
end;
$function$;

DROP TRIGGER IF EXISTS week_scores_broadcast ON public.week_scores;
DROP TRIGGER IF EXISTS week_scores_broadcast_ins ON public.week_scores;
DROP TRIGGER IF EXISTS week_scores_broadcast_upd ON public.week_scores;

CREATE TRIGGER week_scores_broadcast_ins
AFTER INSERT ON public.week_scores
FOR EACH ROW
EXECUTE FUNCTION public.broadcast_week_score();

CREATE TRIGGER week_scores_broadcast_upd
AFTER UPDATE ON public.week_scores
FOR EACH ROW
WHEN (old.score IS DISTINCT FROM new.score)
EXECUTE FUNCTION public.broadcast_week_score();
