-- Add covering indexes for foreign keys flagged by the Supabase performance
-- advisor (lint 0001_unindexed_foreign_keys). An FK without a covering index
-- makes the referenced-side lookup (and any ON DELETE/UPDATE check or join on
-- the FK column) do a sequential scan. All targets here are single-column FKs.
--
-- Two groups:
--   (1) Live tables — real write/join wins today.
--   (2) Pro-sport scaffold tables (nfl_/nhl_/pro_) that aren't live yet — cheap
--       and future-proof; the tables are tiny so a plain CREATE INDEX is fine.
--
-- IF NOT EXISTS keeps this idempotent under the manual per-file apply workflow.

-- (1) Live tables
CREATE INDEX IF NOT EXISTS idx_close_matchup_notifications_sent_league_id
  ON public.close_matchup_notifications_sent (league_id);

CREATE INDEX IF NOT EXISTS idx_dead_letter_alerts_resolved_by
  ON public.dead_letter_alerts (resolved_by);

CREATE INDEX IF NOT EXISTS idx_leagues_archived_by
  ON public.leagues (archived_by);

CREATE INDEX IF NOT EXISTS idx_message_reports_reporter_id
  ON public.message_reports (reporter_id);

CREATE INDEX IF NOT EXISTS idx_message_reports_resolved_by
  ON public.message_reports (resolved_by);

-- (2) Pro-sport scaffold tables (not yet live)
CREATE INDEX IF NOT EXISTS idx_nfl_playoff_year_sb_mvp_franchise_id
  ON public.nfl_playoff_year (sb_mvp_franchise_id);

CREATE INDEX IF NOT EXISTS idx_nfl_season_award_franchise_id
  ON public.nfl_season_award (franchise_id);

CREATE INDEX IF NOT EXISTS idx_nhl_playoff_year_conn_smythe_franchise_id
  ON public.nhl_playoff_year (conn_smythe_franchise_id);

CREATE INDEX IF NOT EXISTS idx_nhl_season_award_franchise_id
  ON public.nhl_season_award (franchise_id);

CREATE INDEX IF NOT EXISTS idx_pro_franchise_season_player_stats_franchise_id
  ON public.pro_franchise_season_player_stats (franchise_id);

CREATE INDEX IF NOT EXISTS idx_pro_playoff_year_finals_mvp_franchise_id
  ON public.pro_playoff_year (finals_mvp_franchise_id);

CREATE INDEX IF NOT EXISTS idx_pro_season_award_franchise_id
  ON public.pro_season_award (franchise_id);
