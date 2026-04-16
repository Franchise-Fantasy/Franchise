-- Clean up cron.job_run_details daily (keeps last 48 hours)
SELECT cron.schedule(
  'cleanup-job-run-details',
  '0 3 * * *',
  $$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '48 hours'$$
);

-- Clean up net._http_response daily (keeps last 24 hours)
SELECT cron.schedule(
  'cleanup-http-response',
  '5 3 * * *',
  $$DELETE FROM net._http_response WHERE created < now() - interval '24 hours'$$
);
