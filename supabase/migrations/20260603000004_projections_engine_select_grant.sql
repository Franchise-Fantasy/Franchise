-- Let projections_engine upsert into player_projections.
--
-- The engine writes via INSERT ... ON CONFLICT (...) DO UPDATE (idempotent
-- re-runs — see franchise_db.write_projections). The original role migration
-- (0001) granted only INSERT + UPDATE, which misses TWO requirements of an
-- upsert under RLS — both of which surface ONLY at the final write (the model
-- fits first, ~5 min, then the write 500s):
--
--   1. TABLE GRANT — ON CONFLICT DO UPDATE needs SELECT on the target table,
--      not just INSERT/UPDATE, else: permission denied for table player_projections.
--
--   2. RLS SELECT POLICY — ON CONFLICT DO UPDATE reads the target to arbitrate
--      conflicts, so under RLS the role needs a SELECT *policy* as well (the
--      table grant alone is not enough), else: new row violates row-level
--      security policy for table player_projections — even on an empty table.
--      0001 created INSERT + UPDATE policies for the role but no SELECT policy.
--
-- Reading back its own output is harmless — player_projections is already
-- authenticated-readable reference data — so the least-privilege posture is
-- intact: the role still touches only its 5 tables, no DELETE/DDL.
GRANT SELECT ON public.player_projections TO projections_engine;

DROP POLICY IF EXISTS "projections_engine reads projections" ON public.player_projections;
CREATE POLICY "projections_engine reads projections"
  ON public.player_projections FOR SELECT TO projections_engine USING (true);
