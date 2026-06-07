-- Break-aware "double week" scheduling.
--
-- Some calendar weeks have very few real games (NBA/WNBA All-Star break) and
-- some have multi-week zero-game gaps (WNBA FIBA World Cup break). Head-to-head
-- matchups decided over a tiny, unbalanced slate are unfair, so the schedule
-- generator collapses the overlapping fantasy week(s) of a defined "merge
-- window" into a single longer matchup (a "double week"). A merge window flagged
-- `terminal` (the WNBA FIBA World Cup break, which sits at the very end of the
-- season) instead walls off the end: the fantasy season — regular season AND
-- playoffs — finishes before it, so the championship can't straddle the break.
--
-- The merge calendar lives on season_config (the established edit-via-SQL,
-- no-deploy reference-data pattern). generate-schedule reads it authoritatively;
-- the create-league wizard mirrors it from the client cache for its preview.

-- 1. Per sport+season merge calendar. Array of
--    {start, end, label, optional}. `optional` merges (NBA Cup) only apply when
--    a league opts in via leagues.combine_cup_week.
alter table public.season_config
  add column if not exists merge_windows jsonb not null default '[]'::jsonb;

-- 2. Per-league opt-in for combining the optional NBA Cup knockout week.
alter table public.leagues
  add column if not exists combine_cup_week boolean not null default false;

-- 3. Flag merged schedule rows so the UI can badge them as double weeks.
alter table public.league_schedule
  add column if not exists is_double_week boolean not null default false;

-- Seed the known windows. These dates are SQL-editable later without a deploy
-- once the exact game-stop/resume boundaries are confirmed against the synced
-- game_schedule (see the verification step in the plan).
update public.season_config
set merge_windows = '[
  {"start": "2026-02-09", "end": "2026-02-22", "label": "All-Star Break", "optional": false},
  {"start": "2025-12-08", "end": "2025-12-21", "label": "NBA Cup Knockouts", "optional": true}
]'::jsonb
where sport = 'nba' and season = '2025-26';

update public.season_config
set merge_windows = '[
  {"start": "2026-07-20", "end": "2026-08-02", "label": "All-Star Break", "optional": false},
  {"start": "2026-08-31", "end": "2026-09-24", "label": "FIBA World Cup Break", "optional": false, "terminal": true}
]'::jsonb
where sport = 'wnba' and season = '2026';

-- Correct the stale WNBA 2026 season dates. The released 30th-season schedule
-- runs May 8 -> Sep 24 (it was seeded with an earlier May 15 / Sep 13 estimate).
update public.season_config
set start_date = '2026-05-08', end_date = '2026-09-24'
where sport = 'wnba' and season = '2026';
