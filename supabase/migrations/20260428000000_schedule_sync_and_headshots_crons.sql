-- Schedule + headshot sync crons. Both functions exist and accept a sport
-- body param (or process both by default), but neither has had a scheduled
-- run until now — `game_schedule` and Storage portraits drift unless an
-- admin manually invokes them. Weekly cadence is plenty: BDL only adds new
-- games when the league publishes a schedule update, and headshots only
-- change when rookies are added or players are waived.

-- sync-game-schedule — one cron per sport, weekly Mon ~07:00 UTC.
-- The function upserts on (sport, game_id) and only overwrites scores
-- when status='Final', so re-running mid-season is safe.
SELECT cron.schedule(
  'sync-game-schedule',
  '0 7 * * 1',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1)
           || '/functions/v1/sync-game-schedule',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
    ),
    body := '{"sport":"nba"}'::jsonb
  );
  $$
);

-- 5 min offset so the two BDL syncs don't hit the upstream at the same
-- instant.
SELECT cron.schedule(
  'sync-game-schedule-wnba',
  '5 7 * * 1',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1)
           || '/functions/v1/sync-game-schedule',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
    ),
    body := '{"sport":"wnba"}'::jsonb
  );
  $$
);

-- sync-headshots — single cron, weekly Sun ~08:00 UTC. The function loops
-- over both sports when no `sport` body param is passed, so we don't need
-- a per-sport twin. Skips already-uploaded portraits.
SELECT cron.schedule(
  'sync-headshots',
  '0 8 * * 0',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1)
           || '/functions/v1/sync-headshots',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Heartbeat seed rows. Edge fns write to these via record_cron_heartbeat;
-- if a row doesn't pre-exist the write silently no-ops, so seeding here is
-- required for the cron-watchdog to pick up stale runs.
INSERT INTO public.cron_job_runs (job_name, expected_interval) VALUES
  ('sync-game-schedule:nba',  interval '7 days'),
  ('sync-game-schedule:wnba', interval '7 days'),
  ('sync-headshots',          interval '7 days')
ON CONFLICT (job_name) DO NOTHING;
