-- Player lock is now "individual" everywhere: each player locks at their own
-- game's start, and the rest of the roster stays movable. The Daily/Individual
-- league setting was removed from the app (new clients no longer read
-- player_lock_type), but builds that predate the removal still read this
-- column and enforce whole-lineup daily locks from it. Backfill every league
-- to 'individual' and flip the default so rows created by writers that don't
-- set it explicitly (the league import edge functions rely on the default)
-- also land on the one remaining behavior.
--
-- The column itself stays for now: old builds still SELECT it, and dropping
-- it would 400 their entire league query (same rollout bridge as
-- pick_conditions_enabled). Drop it once no installed build predates this.

ALTER TABLE public.leagues ALTER COLUMN player_lock_type SET DEFAULT 'individual';

UPDATE public.leagues
SET player_lock_type = 'individual'
WHERE player_lock_type IS DISTINCT FROM 'individual';
