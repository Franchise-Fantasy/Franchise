-- Close the NFL cron monitoring blind spot.
--
-- `record_cron_heartbeat` was UPDATE-only, so a job with no row in
-- `cron_job_runs` wrote to nothing and failed completely silently. Only
-- `poll-news:nfl` was seeded when NFL shipped, so sync-players:nfl,
-- sync-game-schedule:nfl, poll-injuries:nfl and poll-live-stats:nfl had zero
-- coverage. `cron_watchdog` only scans rows that exist, so it could never
-- alert on them either — sync-players:nfl broke on 2026-07-13 (PostgREST's
-- silent 1000-row cap) and went unnoticed for six days.
--
-- Two changes: seed the four missing rows, and make the heartbeat
-- self-registering so a future job can't reintroduce the blind spot.

-- 1. expected_interval is NOT NULL with no default, which is the only reason
--    the heartbeat couldn't upsert. Give it a conservative default so an
--    auto-registered job is watched loosely (1 day) rather than not at all.
--    Jobs seeded explicitly below still get their real cadence.
ALTER TABLE public.cron_job_runs
  ALTER COLUMN expected_interval SET DEFAULT interval '1 day';

-- 2. Seed the four missing NFL jobs with cadences matching their pg_cron
--    schedules. last_success_at stays NULL so the watchdog reports any that
--    are genuinely not running, rather than starting them off as healthy.
INSERT INTO public.cron_job_runs (job_name, expected_interval, last_status)
VALUES
  ('sync-players:nfl',       interval '1 day',    'unknown'),  -- cron: 10 19 * * *
  ('sync-game-schedule:nfl', interval '1 day',    'unknown'),  -- cron: 12 19 * * * (daily, unlike the weekly NBA/WNBA jobs)
  ('poll-injuries:nfl',      interval '15 minutes','unknown'), -- cron: 5-59/15 * * * *
  ('poll-live-stats:nfl',    interval '1 minute', 'unknown')   -- cron: * * * * *
ON CONFLICT (job_name) DO NOTHING;

-- 3. Make the heartbeat upsert. An unknown job now registers itself on first
--    beat instead of silently no-opping. expected_interval is deliberately
--    only set on INSERT — the UPDATE path must never clobber a cadence that
--    was tuned here.
CREATE OR REPLACE FUNCTION public.record_cron_heartbeat(
  p_job text,
  p_status text,
  p_error text DEFAULT NULL::text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  INSERT INTO public.cron_job_runs AS c (
    job_name, last_run_at, last_success_at, last_status, last_error
  )
  VALUES (
    p_job,
    now(),
    CASE WHEN p_status = 'ok' THEN now() END,
    p_status,
    CASE WHEN p_status = 'error' THEN p_error END
  )
  ON CONFLICT (job_name) DO UPDATE
  SET last_run_at     = now(),
      last_success_at = CASE WHEN p_status = 'ok' THEN now() ELSE c.last_success_at END,
      last_status     = p_status,
      last_error      = CASE WHEN p_status = 'error' THEN p_error ELSE c.last_error END;
$function$;

-- Internal helper: only ever called by edge functions holding the service
-- role. No auth check of its own, so keep it away from client roles.
REVOKE ALL ON FUNCTION public.record_cron_heartbeat(text, text, text) FROM anon, authenticated;
