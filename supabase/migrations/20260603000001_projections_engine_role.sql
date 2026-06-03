-- Least-privilege Postgres role for the projections engine (GitHub Actions),
-- replacing the use of a full-privilege connection string for PG_DSN.
--
-- The engine reads exactly four tables and writes one. This role can SELECT
-- only those read tables and INSERT/UPDATE only player_projections — no DELETE,
-- no DDL, no access to anything else (chat, payments, auth, league data…).
--
-- All five tables have RLS ENABLED and this role is NOT `authenticated`, so
-- table GRANTs alone are insufficient — we add RLS policies scoped
-- TO projections_engine. They are permissive (OR-combined with existing
-- policies), so authenticated/anon access is unchanged.
--
-- The role is created WITHOUT login. It cannot authenticate until you set a
-- password OUT OF BAND (never commit it):
--   ALTER ROLE projections_engine WITH LOGIN PASSWORD '<generated-strong-secret>';
-- Then build PG_DSN from the Supabase pooler string (see projections/README.md)
-- and store it as the GitHub `PG_DSN` repo secret.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'projections_engine') THEN
    CREATE ROLE projections_engine NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO projections_engine;

GRANT SELECT ON public.player_games   TO projections_engine;
GRANT SELECT ON public.players        TO projections_engine;
GRANT SELECT ON public.game_schedule  TO projections_engine;
GRANT SELECT ON public.season_config  TO projections_engine;
GRANT INSERT, UPDATE ON public.player_projections TO projections_engine;

-- Read policies (RLS is on; this role isn't `authenticated`).
DROP POLICY IF EXISTS "projections_engine reads player_games" ON public.player_games;
CREATE POLICY "projections_engine reads player_games"
  ON public.player_games FOR SELECT TO projections_engine USING (true);

DROP POLICY IF EXISTS "projections_engine reads players" ON public.players;
CREATE POLICY "projections_engine reads players"
  ON public.players FOR SELECT TO projections_engine USING (true);

DROP POLICY IF EXISTS "projections_engine reads game_schedule" ON public.game_schedule;
CREATE POLICY "projections_engine reads game_schedule"
  ON public.game_schedule FOR SELECT TO projections_engine USING (true);

DROP POLICY IF EXISTS "projections_engine reads season_config" ON public.season_config;
CREATE POLICY "projections_engine reads season_config"
  ON public.season_config FOR SELECT TO projections_engine USING (true);

-- Write policies for the one output table (upsert = INSERT + UPDATE).
DROP POLICY IF EXISTS "projections_engine inserts projections" ON public.player_projections;
CREATE POLICY "projections_engine inserts projections"
  ON public.player_projections FOR INSERT TO projections_engine WITH CHECK (true);

DROP POLICY IF EXISTS "projections_engine updates projections" ON public.player_projections;
CREATE POLICY "projections_engine updates projections"
  ON public.player_projections FOR UPDATE TO projections_engine USING (true) WITH CHECK (true);
