-- Stalled-draft sweeper. The draft clock is a chain of QStash delayed
-- messages; if a single publish fails (start-draft / make-draft-pick /
-- autodraft all treat that as non-fatal), the chain dies and the draft sits
-- in_progress with an expired clock forever — nobody notices in a 2-hour live
-- draft, but a slow draft (30 min – 1 day per pick) spans days and a silent
-- stall is fatal. Every 5 minutes, poke the sweep-stalled-drafts edge
-- function, which finds in_progress drafts whose implicit deadline
-- (current_pick_timestamp + current_pick_time_limit) passed more than a grace
-- period ago (i.e. the QStash message never landed), skips archived leagues,
-- and republishes the autodraft message. autodraft is idempotent, so a sweep
-- racing a late QStash delivery is harmless.
SELECT cron.schedule(
  'sweep-stalled-drafts',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1)
           || '/functions/v1/sweep-stalled-drafts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
