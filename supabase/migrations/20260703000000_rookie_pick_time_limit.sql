-- Slow drafts: pick clocks can now run up to 1 day (86400s).
--
-- 1) leagues.rookie_pick_time_limit — the rookie draft's per-pick clock.
--    create-rookie-draft previously hardcoded time_limit: 120 with no league
--    setting and no pre-draft edit surface. Follows the rookie_draft_rounds
--    pattern: set from EditDraftSettingsModal, read by create-rookie-draft at
--    insert time. NULL = default (120s) so no backfill is needed.
ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS rookie_pick_time_limit integer;

ALTER TABLE leagues
  ADD CONSTRAINT leagues_rookie_pick_time_limit_range
  CHECK (rookie_pick_time_limit IS NULL OR (rookie_pick_time_limit BETWEEN 15 AND 86400));

COMMENT ON COLUMN leagues.rookie_pick_time_limit IS
  'Per-pick clock (seconds) for rookie drafts; NULL = 120. >= 1800 is a slow (async) draft.';

-- 2) drafts.time_limit never had a range constraint (the column pre-dates the
--    repo migrations); accelerated_time_limit is already CHECKed 5–300. Now
--    that the UI writes values up to a day, bound the base clock too.
--    NOT VALID: applies to new writes only, no scan of existing rows.
ALTER TABLE drafts
  ADD CONSTRAINT drafts_time_limit_range
  CHECK (time_limit BETWEEN 5 AND 86400) NOT VALID;
