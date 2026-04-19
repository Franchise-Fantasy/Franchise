-- Remove week_scores from the supabase_realtime publication.
--
-- Context: week_scores is the hottest write-target on the publication —
-- the poll-live-stats cron updates it every minute during live games,
-- producing ~99% of publication WAL volume. But no client subscribes to
-- it via `postgres_changes`; useWeekScores uses Broadcast (`score_update`
-- event) for live score pushes, emitted directly by the edge function.
--
-- Keeping the table on the publication was pure overhead: every row UPDATE
-- emitted a WAL entry that realtime decoded and replicated to zero
-- listeners. Dropping it reclaims the decoding cost (most of the
-- `SELECT wal->>... FROM pg_logical_slot_...` workload, which was 75%+
-- of total DB exec time).

ALTER PUBLICATION supabase_realtime DROP TABLE public.week_scores;
