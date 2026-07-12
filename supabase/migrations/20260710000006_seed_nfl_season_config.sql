-- NFL season_config rows (single-year season labels like WNBA).
--
-- end_date semantics for NFL: the MONDAY that closes the last fantasy week.
-- NFL fantasy weeks are Tue–Mon (weekEndDow=1); week 18's real games end
-- Sat/Sun but their fantasy week runs through Monday, and computeMaxWeeks
-- drops any week whose endDate is past this cap — a Sunday end_date would
-- silently cap NFL leagues at 17 of 18 weeks. (For NBA/WNBA the last game
-- day and the fantasy-week end are both Sundays, so this distinction only
-- exists for NFL.)
--
-- 2025 (completed season): opener Thu 2025-09-04, week 18 games ended Sun
-- 2026-01-04 (verified against BDL /nfl/v1/games — playoffs began Jan 10);
-- fantasy-week end Mon 2026-01-05. The 2025 row exists to (a) anchor the
-- current-season floor for the player_season_stats matview (floor = prev
-- season's end_date) and (b) label the 2025 backfill in player_historical_stats.
--
-- 2026 (current): opener Wed 2026-09-09 (NE@SEA 8:20pm ET per BDL), week 18
-- games end Sat 2027-01-09; fantasy-week end Mon 2027-01-11. creation_opens_at
-- is now — creation is additionally admin-gated by the leagues_nfl_admin_gate
-- trigger, so this only opens the window for admin accounts. No merge_windows
-- (NFL has no mid-season break; byes are per-team).

INSERT INTO public.season_config (sport, season, start_date, end_date, creation_opens_at, is_current)
VALUES
  ('nfl', '2025', '2025-09-04', '2026-01-05', NULL, false),
  ('nfl', '2026', '2026-09-09', '2027-01-11', '2026-07-10T00:00:00Z', true)
ON CONFLICT (sport, season) DO UPDATE
  SET start_date = EXCLUDED.start_date,
      end_date = EXCLUDED.end_date,
      creation_opens_at = EXCLUDED.creation_opens_at,
      is_current = EXCLUDED.is_current;
