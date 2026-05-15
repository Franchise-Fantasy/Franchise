-- Switch pending_transactions.execute_after from `date` to `timestamptz`.
--
-- The old `date` column couldn't represent the actual moment a queued drop
-- should fire — `lte(execute_after, today_utc)` fired at UTC midnight, which
-- for users west of UTC is hours before their local "tomorrow" begins. The
-- cron now compares against `now()` and the client supplies the exact UTC
-- moment (next 5am ET rollover via utils/leagueTime.nextSlateRollover).
--
-- Backfill: existing date values are widened to that date at 09:00 UTC
-- (≈ 5am ET during EDT). Close enough for any in-flight rows; new writes
-- supply a precise timestamp.

ALTER TABLE public.pending_transactions
  ALTER COLUMN execute_after TYPE timestamptz
  USING (execute_after::timestamp AT TIME ZONE 'UTC' + interval '9 hours');

COMMENT ON COLUMN public.pending_transactions.execute_after IS
  'Exact UTC moment the queued action should fire. For locked-day drops this is the next 5am ET slate rollover (anchored to America/New_York). The cron fires within its 15-minute tick of this moment.';
