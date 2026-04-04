-- Schedule poll-injuries to run every 15 minutes via BDL API
SELECT cron.schedule(
  'poll-injuries',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://iuqbossmnsezzgocpcbo.supabase.co/functions/v1/poll-injuries',
    headers := jsonb_build_object(
      'Authorization', 'Bearer 14a7e6c1cd509bad3721c142ca219abb42c3007f519a90aef31ab9bd4a9eba96',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);