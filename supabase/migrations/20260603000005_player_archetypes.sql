-- Player role archetypes — k-means clustering on per-36 box-score rates, used as
-- the projection model's hierarchical prior. Mirrors the source engine's
-- `player_archetypes` table, but Franchise-native (UUID player_id + sport).
--
-- Without archetypes every player collapses into one league-wide pool, so the
-- Bayesian shrinkage drags starters toward the bench average (the ~20-30% low
-- bias we observed). Real role tiers let a scorer shrink toward the scorer mean,
-- a glass-eater toward the glass-eater mean, etc.
--
-- Written by projections/franchise_archetype.py (the projections_engine role),
-- read by the model via franchise_db.load_box_scores.

CREATE TABLE IF NOT EXISTS public.player_archetypes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id            uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  sport                text NOT NULL,
  season               text NOT NULL,
  archetype            text NOT NULL,
  archetype_confidence numeric,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT player_archetypes_unique UNIQUE (player_id, sport, season)
);

CREATE INDEX IF NOT EXISTS player_archetypes_lookup_idx
  ON public.player_archetypes (sport, season, player_id);

ALTER TABLE public.player_archetypes ENABLE ROW LEVEL SECURITY;

-- Read: authenticated (global reference data, same posture as player_projections).
DROP POLICY IF EXISTS "Authenticated users can read archetypes" ON public.player_archetypes;
CREATE POLICY "Authenticated users can read archetypes"
  ON public.player_archetypes FOR SELECT TO authenticated USING (true);

-- projections_engine read + write. The engine upserts via ON CONFLICT DO UPDATE,
-- which needs a SELECT policy AND grant on the target (same lesson as
-- player_projections, migration 0004), in addition to INSERT/UPDATE.
DROP POLICY IF EXISTS "projections_engine reads archetypes" ON public.player_archetypes;
CREATE POLICY "projections_engine reads archetypes"
  ON public.player_archetypes FOR SELECT TO projections_engine USING (true);
DROP POLICY IF EXISTS "projections_engine inserts archetypes" ON public.player_archetypes;
CREATE POLICY "projections_engine inserts archetypes"
  ON public.player_archetypes FOR INSERT TO projections_engine WITH CHECK (true);
DROP POLICY IF EXISTS "projections_engine updates archetypes" ON public.player_archetypes;
CREATE POLICY "projections_engine updates archetypes"
  ON public.player_archetypes FOR UPDATE TO projections_engine USING (true) WITH CHECK (true);

GRANT SELECT ON public.player_archetypes TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.player_archetypes TO projections_engine;
GRANT ALL ON public.player_archetypes TO service_role;
