-- Draft slot columns for rookie projection priors (2026-08-03).
--
-- The projections engine's rookie slot-prior model (projections/rookie_priors
-- .py, franchise-v1.6) projects incoming rookies from where they were drafted:
-- measured on our own 2019-2025 NBA classes, draft slot has a clean monotone
-- relationship with rookie fantasy production (picks 1-3 median 30.4 fpg vs
-- round 2's 10.6; spearman -0.52) and a leave-future-out slot-prior backtest
-- scores ~5-6 MAE — veteran-model-grade — against the ~16 MAE of projecting
-- rookies as nothing, which is what happened before this.
--
-- Source: BDL /v1/players draft_round/draft_number (NBA). Backfilled by
-- backend/seed_nba_draft_slots.py; kept current for new players by
-- sync-players. NULL = undrafted (or WNBA, where BDL carries no draft fields
-- and the seeder for a future WNBA path is a manual annual job).
--
-- Nullable ints, no DEFAULT: metadata-only ALTER (no rewrite, no long lock).
-- Grants on players are table-level for anon/authenticated/projections_engine
-- (verified 2026-08-03), so the new columns are readable everywhere without
-- new GRANTs, and RLS is row-level — unchanged by added columns.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS draft_round smallint,
  ADD COLUMN IF NOT EXISTS draft_number smallint;

COMMENT ON COLUMN public.players.draft_round IS
  'Real-league draft round (BDL). NULL = undrafted or unknown/unseeded sport.';
COMMENT ON COLUMN public.players.draft_number IS
  'Real-league overall draft pick (BDL). Feeds rookie slot-prior projections.';
