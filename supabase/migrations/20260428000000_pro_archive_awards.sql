-- Phase 2 / Stage A: Finals MVP + regular-season awards.
--
-- Adds Finals MVP fields to pro_playoff_year and a new pro_season_award table
-- for individual awards (MVP/DPOY/ROY/Sixth Man/MIP) and selection teams
-- (All-NBA / All-Defense / All-Rookie). Awards are pulled into the UI via a
-- new pro_archive_awards(season) RPC; the existing pro_archive_bracket RPC
-- automatically picks up the new finals_mvp_* columns since it serialises
-- the year row with to_jsonb.

BEGIN;

-- ── 1. Finals MVP on pro_playoff_year ──────────────────────────────────────
ALTER TABLE public.pro_playoff_year
  ADD COLUMN finals_mvp_player_name  text,
  ADD COLUMN finals_mvp_bbref_id     text,
  ADD COLUMN finals_mvp_franchise_id text REFERENCES public.pro_franchise(id),
  ADD COLUMN finals_mvp_stat_line    text;

-- ── 2. pro_season_award ────────────────────────────────────────────────────
-- One row per (season, award_type, rank). Solo awards use rank=1; selection
-- teams use rank=1..5 to slot the five players on each tier (e.g. All-NBA
-- First has 5 ranked rows). franchise_id may be NULL for historical awards
-- where the player's team isn't worth resolving.
CREATE TABLE public.pro_season_award (
  season         int  NOT NULL REFERENCES public.pro_playoff_year(season) ON DELETE CASCADE,
  award_type     text NOT NULL CHECK (award_type IN (
    'mvp', 'dpoy', 'roy', 'sixth_man', 'mip',
    'all_nba_first', 'all_nba_second', 'all_nba_third',
    'all_defense_first', 'all_defense_second',
    'all_rookie_first', 'all_rookie_second'
  )),
  rank           int  NOT NULL DEFAULT 1,
  player_name    text NOT NULL,
  bbref_player_id text,
  franchise_id   text REFERENCES public.pro_franchise(id),
  stat_line      text,
  PRIMARY KEY (season, award_type, rank)
);

CREATE INDEX idx_pro_season_award_franchise
  ON public.pro_season_award(season, franchise_id);

-- ── 3. RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.pro_season_award ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read pro_season_award"
  ON public.pro_season_award FOR SELECT TO authenticated USING (true);

-- ── 4. RPC: pro_archive_awards(season) ─────────────────────────────────────
-- Returns all awards for a season grouped by award_type.
-- Result shape: { mvp: [row], dpoy: [row], all_nba_first: [row, row, ...], ... }
-- Each row carries player_name, bbref_player_id, franchise_id, rank, stat_line.
CREATE OR REPLACE FUNCTION public.pro_archive_awards(p_season int)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT COALESCE(
    jsonb_object_agg(
      award_type,
      rows
    ),
    '{}'::jsonb
  )
  FROM (
    SELECT
      a.award_type,
      jsonb_agg(
        jsonb_build_object(
          'rank', a.rank,
          'player_name', a.player_name,
          'bbref_player_id', a.bbref_player_id,
          'franchise_id', a.franchise_id,
          'stat_line', a.stat_line
        )
        ORDER BY a.rank
      ) AS rows
    FROM public.pro_season_award a
    WHERE a.season = p_season
    GROUP BY a.award_type
  ) grouped;
$$;

GRANT EXECUTE ON FUNCTION public.pro_archive_awards(int) TO authenticated;

COMMIT;
