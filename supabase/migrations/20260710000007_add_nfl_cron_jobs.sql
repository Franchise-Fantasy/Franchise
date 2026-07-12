-- NFL cron twins, mirroring 20260425000042_add_wnba_cron_jobs.sql. Each
-- polling edge function accepts a `sport` body param (default 'nba'), so the
-- existing NBA/WNBA entries are untouched — these just pass {"sport":"nfl"}.
--
-- Applied AFTER the functions' NFL branches were deployed and manually
-- verified (2026-07-11): sync-game-schedule (272 games, 18 weeks),
-- sync-players (955 skill + 32 D/ST), poll-injuries (21/21 matched),
-- poll-live-stats (off-day skip confirmed).
--
-- Out-of-season cost: poll-live-stats-nfl short-circuits on a cheap
-- game_schedule head-count when the sport has no games that day (verified);
-- the daily syncs are idempotent. NFL games only happen Thu/Sun/Mon (plus
-- scattered Sat/holiday slates) — the schedule gate handles that, no cron
-- day-of-week gating needed.
--
-- poll-news has no NFL feed configured — intentionally not scheduled.

-- NFL: poll-injuries every 15 min (offset 5 min from the NBA/WNBA runs)
SELECT cron.schedule(
  'poll-injuries-nfl',
  '5-59/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://iuqbossmnsezzgocpcbo.supabase.co/functions/v1/poll-injuries',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
    ),
    body := '{"sport":"nfl"}'::jsonb
  );
  $$
);

-- NFL: poll-live-stats every minute (self-gates on off-days/off-hours)
SELECT cron.schedule(
  'poll-live-stats-nfl',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://iuqbossmnsezzgocpcbo.supabase.co/functions/v1/poll-live-stats',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
    ),
    body    := '{"sport":"nfl"}'::jsonb
  );
  $$
);

-- NFL: sync-players daily at 19:10 UTC (2 min after the WNBA sync so the
-- three BDL syncs don't hit at the same instant)
SELECT cron.schedule(
  'sync-players-nfl',
  '10 19 * * *',
  $$
  SELECT net.http_post(
    url := 'https://iuqbossmnsezzgocpcbo.supabase.co/functions/v1/sync-players',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
    ),
    body := '{"sport":"nfl"}'::jsonb
  );
  $$
);

-- NFL: sync-game-schedule daily at 19:12 UTC (kickoff-time changes, flex
-- scheduling, and score/status reconciliation)
SELECT cron.schedule(
  'sync-game-schedule-nfl',
  '12 19 * * *',
  $$
  SELECT net.http_post(
    url := 'https://iuqbossmnsezzgocpcbo.supabase.co/functions/v1/sync-game-schedule',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
    ),
    body := '{"sport":"nfl"}'::jsonb
  );
  $$
);
