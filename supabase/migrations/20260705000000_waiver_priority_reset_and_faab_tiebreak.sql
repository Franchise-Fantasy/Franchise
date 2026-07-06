-- Two new commissioner-configurable waiver settings.
--
-- 1. waiver_priority_reset — what happens to Standard waiver priority order at
--    each season rollover (advance-season). Standard priority is *rolling*
--    during the season (a claim drops the winner to the back), so by season's
--    end the order reflects recent activity, not standings. This setting picks
--    how it re-seeds:
--      reverse_standings (default) — worst finisher gets first priority (the
--                                    historical, behavior-preserving default)
--      keep                        — carry the end-of-season order into the new season
--      random                      — shuffle 1..N each new season
--    Only meaningful for leagues that actually consult waiver priority, i.e.
--    Standard leagues and FAAB leagues whose faab_tiebreak = 'waiver_priority'.
--
-- 2. faab_tiebreak — how process-waivers breaks an EXACT equal-bid tie in a
--    FAAB league:
--      earliest_bid (default) — the bid submitted first wins (historical behavior)
--      waiver_priority        — the team with better waiver priority wins
--
-- Both default to the pre-existing behavior, so every current league is
-- untouched until a commissioner opts in.

ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS waiver_priority_reset TEXT NOT NULL DEFAULT 'reverse_standings'
    CHECK (waiver_priority_reset IN ('reverse_standings', 'keep', 'random')),
  ADD COLUMN IF NOT EXISTS faab_tiebreak TEXT NOT NULL DEFAULT 'earliest_bid'
    CHECK (faab_tiebreak IN ('earliest_bid', 'waiver_priority'));
