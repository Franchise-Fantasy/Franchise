-- WNBA player props (sportsbook lines) for the next-game projection.
--
-- The market line for points/rebounds/assists/threes already prices in the
-- opponent, pace, injuries and current form, so blending it into next_game
-- makes that horizon matchup-specific AND accurate (this is what the original
-- engine did via a 0.65*model + 0.35*line blend). Franchise dropped it in the
-- port; this restores it.
--
-- One row per (player, game date, stat) holding the MEDIAN line across books,
-- written by projections/franchise_props.py from BDL's /wnba/v1/odds/player_props
-- endpoint. Read by the model via franchise_db.load_vegas_props.

CREATE TABLE IF NOT EXISTS public.player_props (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  sport       text NOT NULL,
  game_date   date NOT NULL,
  stat        text NOT NULL,          -- 'pts' | 'reb' | 'ast' | '3pm'
  line_value  numeric NOT NULL,       -- median O/U line across books
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT player_props_unique UNIQUE (player_id, sport, game_date, stat)
);

CREATE INDEX IF NOT EXISTS player_props_lookup_idx
  ON public.player_props (sport, game_date, player_id);

ALTER TABLE public.player_props ENABLE ROW LEVEL SECURITY;

-- Read: authenticated (so the app could surface a line later if wanted).
DROP POLICY IF EXISTS "Authenticated users can read props" ON public.player_props;
CREATE POLICY "Authenticated users can read props"
  ON public.player_props FOR SELECT TO authenticated USING (true);

-- projections_engine read + write (the props job upserts via ON CONFLICT, which
-- needs SELECT + INSERT + UPDATE grants AND matching policies — same lesson as
-- player_projections / player_archetypes).
DROP POLICY IF EXISTS "projections_engine reads props" ON public.player_props;
CREATE POLICY "projections_engine reads props"
  ON public.player_props FOR SELECT TO projections_engine USING (true);
DROP POLICY IF EXISTS "projections_engine inserts props" ON public.player_props;
CREATE POLICY "projections_engine inserts props"
  ON public.player_props FOR INSERT TO projections_engine WITH CHECK (true);
DROP POLICY IF EXISTS "projections_engine updates props" ON public.player_props;
CREATE POLICY "projections_engine updates props"
  ON public.player_props FOR UPDATE TO projections_engine USING (true) WITH CHECK (true);

GRANT SELECT ON public.player_props TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.player_props TO projections_engine;
GRANT ALL ON public.player_props TO service_role;
