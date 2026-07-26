-- ============================================================
-- One-time repair: merge the duplicate `players` rows the 2026-07-25 prospect
-- CMS re-seed created.
--
-- What happened: the re-seed deleted every old `prospectProfile` entry and
-- created 320 fresh ones with NEW Contentful entry ids. sync-prospect upserted
-- on `contentful_entry_id`, so each re-created player minted a SECOND players
-- row — even though the original was already a real, drafted, rostered NBA
-- player (AJ Dybantsa WAS, Brayden Burries MIL, …). 58 of the 70 rows in the
-- 2026 class duplicate an existing player, and both copies showed up in every
-- league's rookie draft pool.
--
-- Fix: move the CMS identity (slug + entry id) onto the canonical player row
-- and delete the duplicate. The canonical row is the one to keep — it carries
-- the pro team, injury status, and every league_players / prospect_boards
-- reference. Verified before writing this: no duplicate row is referenced by
-- league_players, draft_picks, prospect_boards, draft_queue, watchlist,
-- keeper_declarations, daily_lineups, or news mentions.
--
-- The recurrence is fixed in sync-prospect (it now resolves an existing player
-- by entry id → slug → normalized name within the class before inserting).
-- ============================================================

DO $$
BEGIN
  -- Name key. Mirrors _shared/normalize.ts's normalizeName — the same
  -- normalizer sync-players matches incoming pro players on — so the CMS's
  -- "Morez Johnson Jr." and the pro feed's "Morez Johnson" are one player.
  -- Simplification vs the TS original: no accent folding (needs the unaccent
  -- extension) and suffixes are stripped only in trailing position. Neither
  -- matters for the rows this repairs; the edge function keeps the full logic.
  CREATE TEMP TABLE player_norm ON COMMIT DROP AS
  SELECT
    id, is_prospect, pro_team, draft_year, player_slug, contentful_entry_id, school,
    regexp_replace(
      btrim(regexp_replace(regexp_replace(lower(name), '[.''’-]', '', 'g'), '\s+', ' ', 'g')),
      '\s+(jr|sr|ii|iii|iv|v)$', ''
    ) AS norm
  FROM players
  WHERE sport = 'nba';

  CREATE TEMP TABLE prospect_dupes ON COMMIT DROP AS
  SELECT
    dup.id AS dup_id,
    dup.player_slug,
    dup.contentful_entry_id,
    dup.school,
    (
      SELECT canon.id
      FROM player_norm canon
      WHERE canon.id <> dup.id
        AND canon.is_prospect IS NOT TRUE
        AND canon.norm = dup.norm
        AND (canon.draft_year = dup.draft_year OR canon.draft_year IS NULL)
      -- Prefer the row that already has a pro team; it's the live one.
      ORDER BY canon.pro_team NULLS LAST
      LIMIT 1
    ) AS canon_id
  FROM player_norm dup
  WHERE dup.is_prospect IS TRUE
    AND dup.draft_year = 2026
    -- Never delete a row anything points at. All of these are empty today; the
    -- guard is here so a re-run — or a pick made in a live draft between now
    -- and this landing — can't take a rostered player with it.
    AND NOT EXISTS (SELECT 1 FROM league_players lp WHERE lp.player_id = dup.id)
    AND NOT EXISTS (SELECT 1 FROM draft_picks dp WHERE dp.player_id = dup.id)
    AND NOT EXISTS (SELECT 1 FROM prospect_boards pb WHERE pb.player_id = dup.id)
    AND NOT EXISTS (SELECT 1 FROM draft_queue dq WHERE dq.player_id = dup.id)
    AND NOT EXISTS (SELECT 1 FROM watchlist w WHERE w.player_id = dup.id);

  DELETE FROM prospect_dupes WHERE canon_id IS NULL;

  -- Two prospects of the same name in one class: don't guess which is which.
  DELETE FROM prospect_dupes d
  WHERE (SELECT count(*) FROM prospect_dupes x WHERE x.canon_id = d.canon_id) > 1;

  -- Delete first: `contentful_entry_id` is unique, so the id can't move to the
  -- canonical row while the duplicate still holds it.
  DELETE FROM players p USING prospect_dupes d WHERE p.id = d.dup_id;

  -- The canonical row keeps its own name: the pro feed owns it, and renaming
  -- it would break the name match sync-players uses to promote/update it.
  UPDATE players p
  SET player_slug         = d.player_slug,
      contentful_entry_id = d.contentful_entry_id,
      school              = COALESCE(p.school, d.school),
      is_prospect         = true,
      -- Some canonical rows came from the pro sync with no class year; the CMS
      -- entry is authoritative, and the rookie-draft pool filters on this.
      draft_year          = 2026,
      rookie              = true,
      updated_at          = now()
  FROM prospect_dupes d
  WHERE p.id = d.canon_id;
END $$;

-- The rookie draft board reads player_season_stats, not players.
SELECT refresh_player_season_stats();
