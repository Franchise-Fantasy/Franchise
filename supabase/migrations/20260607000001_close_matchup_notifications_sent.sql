-- Dedup table for the Sunday close-matchup notification. The scanner runs once
-- a week and writes one row per qualifying matchup; the unique constraint on
-- (matchup_id) guarantees a single user-visible push per matchup per season.
-- Cron retries / manual invocations stay safe because the insert uses
-- ON CONFLICT DO NOTHING.

CREATE TABLE IF NOT EXISTS public.close_matchup_notifications_sent (
  matchup_id uuid PRIMARY KEY REFERENCES public.league_matchups(id) ON DELETE CASCADE,
  schedule_id uuid NOT NULL REFERENCES public.league_schedule(id) ON DELETE CASCADE,
  league_id uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_close_matchup_notifications_sent_schedule
  ON public.close_matchup_notifications_sent (schedule_id);

ALTER TABLE public.close_matchup_notifications_sent ENABLE ROW LEVEL SECURITY;

-- No client access — this table is written by the edge function only and never
-- queried from the app.
