-- Fix process-waivers cron timing (was resolving every waiver a full day late).
--
-- Waiver expiry (league_waivers.on_waivers_until) is anchored to the 5am-ET
-- slate rollover, which is 09:00 UTC in EDT and 10:00 UTC in EST (see
-- utils/leagueTime.ts -> nextSlateRollover). The resolving cron ran at 06:00
-- UTC -- 3-4 hours BEFORE that rollover -- so it always missed the target
-- morning and picked the waiver up on the NEXT day's run. Net effect: every
-- standard/FAAB waiver sat on the wire ~1 full day longer than its configured
-- waiver_period_days (a 1-day waiver took 2 days to clear).
--
-- Move the daily run to 10:15 UTC so it fires after the rollover in both DST
-- regimes (after 09:00 EDT and after 10:00 EST), aligning resolution with the
-- on_waivers_until time the client already displays to GMs.
SELECT cron.unschedule('enqueue-process-waivers');
SELECT cron.schedule(
  'enqueue-process-waivers',
  '15 10 * * *',
  $$SELECT pgmq.send('process_waivers', '{"function":"process-waivers"}'::jsonb);$$
);
