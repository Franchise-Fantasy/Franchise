-- The original CHECK constraint on live_scoring_events.kind only listed 9
-- kinds, but poll-live-stats emits 14 (REB, PF, MISSED_3PT/2PT/FT were
-- missing). Because rows are inserted as a single batch across all live
-- games, ONE forbidden kind aborts the entire INSERT — silently dropping
-- every event in that poll cycle. Most polls contain a REB, so events
-- only landed when the diff happened to be a lone made-shot/assist/etc.
-- That's why the ticker has been showing a fraction of plays.

ALTER TABLE public.live_scoring_events
  DROP CONSTRAINT IF EXISTS live_scoring_events_kind_check;

ALTER TABLE public.live_scoring_events
  ADD CONSTRAINT live_scoring_events_kind_check
  CHECK (kind IN (
    'MADE_3PT', 'MADE_2PT', 'MADE_FT',
    'MISSED_3PT', 'MISSED_2PT', 'MISSED_FT',
    'REB', 'AST', 'STL', 'BLK', 'TOV', 'PF',
    'DD', 'TD'
  ));
