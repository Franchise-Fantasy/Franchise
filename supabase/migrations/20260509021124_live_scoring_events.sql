-- Discrete scoring events derived from successive live_player_stats snapshots.
-- The poll-live-stats edge function diffs each new snapshot against the
-- previous one and inserts a row for each meaningful stat jump (3-pt make,
-- assist, double-double earned, etc.).
--
-- Consumers:
--   - In-app matchup ticker (subscribes to inserts, filters by current
--     roster player_ids client-side)
--   - Future Live Activity / push notification dispatch
--
-- The table stores `kind` + `value` rather than a precomputed fpts_delta —
-- per-league scoring is calculated client-side because each league has its
-- own weights and denormalizing would force one row per league.

CREATE TABLE IF NOT EXISTS public.live_scoring_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  player_name text NOT NULL,
  game_id text NOT NULL,
  sport text NOT NULL,
  kind text NOT NULL CHECK (kind IN (
    'MADE_3PT', 'MADE_2PT', 'MADE_FT',
    'AST', 'STL', 'BLK', 'TOV',
    'DD', 'TD'
  )),
  value integer NOT NULL DEFAULT 1,
  period integer,
  game_clock text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS live_scoring_events_player_occurred_idx
  ON public.live_scoring_events (player_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS live_scoring_events_occurred_idx
  ON public.live_scoring_events (occurred_at DESC);

ALTER TABLE public.live_scoring_events ENABLE ROW LEVEL SECURITY;

-- Public read — events are derived from public game data (BDL stats) and
-- carry no PII. Writes are restricted to the service role used by
-- poll-live-stats.
CREATE POLICY "live_scoring_events read"
  ON public.live_scoring_events
  FOR SELECT
  TO authenticated, anon
  USING (true);

-- Add to realtime publication so client postgres_changes subscriptions
-- receive INSERT events.
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_scoring_events;

-- TTL trim — events are only useful while a game is recent. Keep 36 hours
-- so yesterday's late games still have a recap when the user opens the app
-- in the morning. Runs at 4am ET (08:00 UTC).
SELECT cron.schedule(
  'live-scoring-events-trim',
  '0 8 * * *',
  $$DELETE FROM public.live_scoring_events WHERE occurred_at < now() - interval '36 hours'$$
);
