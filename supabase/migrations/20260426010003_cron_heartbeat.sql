-- Cron heartbeat / dead-man-switch.
--
-- We have ~9 cron-triggered edge function invocations (NBA + WNBA polling +
-- queue-worker) that hit a vault-stored CRON_SECRET. When that secret drifts
-- (the canonical 2026-04 incident) every cron call silently 401s and we
-- only notice when downstream visible state breaks.
--
-- This migration adds:
--   1. cron_job_runs        per-job last-run / last-success snapshot
--   2. record_cron_heartbeat RPC the edge functions call at the top + bottom
--      of each invocation
--   3. cron_watchdog        SECURITY DEFINER fn that scans for stale jobs
--      and inserts dead_letter_alerts rows so the existing admin UI surfaces
--      them
--   4. daily cron at 06:30 UTC that calls cron_watchdog
--
-- The job_name format is "<edge-fn>" or "<edge-fn>:<sport>" — the edge
-- function code constructs the key based on its sport-awareness.

CREATE TABLE IF NOT EXISTS public.cron_job_runs (
  job_name          text PRIMARY KEY,
  last_run_at       timestamptz,
  last_success_at   timestamptz,
  last_status       text NOT NULL DEFAULT 'unknown' CHECK (last_status IN ('ok', 'error', 'unknown')),
  last_error        text,
  expected_interval interval NOT NULL
);

ALTER TABLE public.cron_job_runs ENABLE ROW LEVEL SECURITY;

-- Read access: admins only (matches dead_letter_alerts pattern).
DROP POLICY IF EXISTS "Admins can read cron heartbeats" ON public.cron_job_runs;
CREATE POLICY "Admins can read cron heartbeats" ON public.cron_job_runs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.is_admin = true
    )
  );

-- record_cron_heartbeat: called from every cron-triggered edge function. We
-- never INSERT from the edge fn — only UPDATE — to keep the seeded set of
-- jobs canonical. An unknown job_name silently no-ops (drop edge fn = drop
-- heartbeat row, no zombie heartbeats).
CREATE OR REPLACE FUNCTION public.record_cron_heartbeat(
  p_job text,
  p_status text,
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.cron_job_runs
  SET last_run_at     = now(),
      last_success_at = CASE WHEN p_status = 'ok' THEN now() ELSE last_success_at END,
      last_status     = p_status,
      last_error      = CASE WHEN p_status = 'error' THEN p_error ELSE last_error END
  WHERE job_name = p_job;
$$;

REVOKE EXECUTE ON FUNCTION public.record_cron_heartbeat(text, text, text) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.record_cron_heartbeat(text, text, text) TO service_role;

-- cron_watchdog: scans cron_job_runs and inserts dead_letter_alerts rows for
-- any job whose last_success_at is older than 3× expected_interval. Existing
-- admin UI / queries on dead_letter_alerts surface these — no new UI needed.
-- Idempotent within a 24h window (we only alert once per stale job per day).
CREATE OR REPLACE FUNCTION public.cron_watchdog()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_inserted integer := 0;
BEGIN
  WITH stale AS (
    SELECT job_name,
           last_success_at,
           expected_interval,
           last_status,
           last_error
    FROM cron_job_runs
    WHERE last_success_at IS NULL
       OR last_success_at < now() - (expected_interval * 3)
  ),
  to_alert AS (
    SELECT s.*
    FROM stale s
    WHERE NOT EXISTS (
      SELECT 1 FROM dead_letter_alerts d
      WHERE d.original_queue = 'cron-watchdog'
        AND d.function_name = s.job_name
        AND d.created_at > now() - interval '24 hours'
        AND d.resolved_at IS NULL
    )
  ),
  ins AS (
    INSERT INTO dead_letter_alerts (
      original_queue, original_msg_id, function_name, reason, payload
    )
    SELECT
      'cron-watchdog',
      0,
      job_name,
      CASE
        WHEN last_success_at IS NULL
          THEN 'Cron job has never reported a successful run'
        ELSE 'Cron job last succeeded at ' || last_success_at::text
             || ' (expected interval: ' || expected_interval::text || ')'
      END,
      jsonb_build_object(
        'last_status', last_status,
        'last_error', last_error,
        'last_success_at', last_success_at,
        'expected_interval', expected_interval::text
      )
    FROM to_alert
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM ins;
  RETURN v_inserted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cron_watchdog() FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.cron_watchdog() TO service_role;

-- Schedule: 06:30 UTC daily. Off-peak so we don't tangle with the existing
-- 06:00 / 08:00 / 09:00 jobs from 20260412_enable_pgmq_queues.sql.
SELECT cron.schedule(
  'cron-watchdog-daily',
  '30 6 * * *',
  $$SELECT public.cron_watchdog();$$
);

-- Seed expected intervals. Edge functions write to these rows from inside
-- their handlers — they won't auto-create rows, so a typo in the edge fn
-- silently no-ops rather than spawning ghost heartbeats.
INSERT INTO public.cron_job_runs (job_name, expected_interval) VALUES
  ('poll-live-stats:nba',  interval '1 minute'),
  ('poll-live-stats:wnba', interval '1 minute'),
  ('poll-injuries:nba',    interval '15 minutes'),
  ('poll-injuries:wnba',   interval '15 minutes'),
  ('poll-news:nba',        interval '1 minute'),
  ('poll-news:wnba',       interval '1 minute'),
  ('sync-players:nba',     interval '1 day'),
  ('sync-players:wnba',    interval '1 day'),
  ('queue-worker',         interval '1 minute')
ON CONFLICT (job_name) DO NOTHING;
