-- NFL kinds for the live event tape.
--
-- live_scoring_events.kind is CHECK-constrained to a fixed list, and rows are
-- inserted as ONE batch across every live game — so a single unlisted kind
-- aborts the entire INSERT and silently drops every event in that poll cycle.
-- That exact bug already cost us most of the basketball tape once (see
-- 20260510184500), so the NFL kinds go in BEFORE poll-live-stats starts
-- emitting them.
--
-- The kinds mirror NFL_EVENT_DEFS in utils/scoring/nflStatLine.ts, which is the
-- shared zero-dep module both the edge derivation and the client ticker read.
-- Each kind is deliberately named after the league's scoring stat_name, so the
-- client's per-event fpts is just `value × weight(kind)`.
--
-- Football only gets the plays that MOVE a fantasy score — touchdowns,
-- turnovers, kicks, D/ST takeaways. Yardage is not an event: it would fire on
-- nearly every snap.
--
-- Note 'TD' (basketball triple-double) and the NFL touchdown kinds coexist
-- without collision precisely because the NFL ones are qualified (PASS_TD, …).

ALTER TABLE public.live_scoring_events
  DROP CONSTRAINT IF EXISTS live_scoring_events_kind_check;

ALTER TABLE public.live_scoring_events
  ADD CONSTRAINT live_scoring_events_kind_check
  CHECK (kind IN (
    -- basketball (unchanged)
    'MADE_3PT', 'MADE_2PT', 'MADE_FT',
    'MISSED_3PT', 'MISSED_2PT', 'MISSED_FT',
    'REB', 'AST', 'STL', 'BLK', 'TOV', 'PF',
    'DD', 'TD',
    -- NFL
    'PASS_TD', 'RUSH_TD', 'REC_TD', 'RET_TD', 'DST_TD',
    'PASS_INT', 'FUM_LOST',
    'FG', 'XP',
    'DST_SACK', 'DST_INT', 'DST_FUM_REC'
  ));
