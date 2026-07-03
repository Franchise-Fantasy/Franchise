-- PR 1 of the roster-slot data-integrity fix: HEAL existing data.
--
-- Problem: daily_lineups can hold MORE active players in a position than the
-- league allows (e.g. two players both stamped 'UTIL2', or three 'G' rows when
-- G slot_count = 2). finalize-week scores every active-slot game with no
-- capacity cap, so a surplus occupant who played inflates the matchup score.
-- Root cause is upstream (per-day lineup writes with no eviction + no DB guard);
-- PR 2 (numbering) and PR 3 (unique index) make it impossible. This migration
-- only repairs the rows that already exist.
--
-- Fix: for each (team, day, base position) over capacity, KEEP the occupants who
-- contributed most that day and bench the surplus (roster_slot -> 'BE'). We never
-- delete a row — the player was rostered, just shouldn't have been ACTIVE. This
-- matches what the UI already displayed (the render layer only ever showed
-- slot_count occupants), so no manager's intended lineup changes.
--
-- "base position" strips the numeric seat index: 'UTIL2' -> 'UTIL', 'G1' -> 'G',
-- bare 'G'/'PG'/'C' unchanged. Bench/IR/TAXI/DROPPED are exempt (many allowed).
--
-- Ranking (who to KEEP, highest first): minutes played that day, then points,
-- then player_id for a deterministic tiebreak. A player with no game that day
-- (injured -> no player_games row, or a 0-min DNP) sorts last, so the surplus
-- benched is one who didn't contribute. The exact tiebreak doesn't matter for
-- correctness — it only decides which surplus row on a historical day is
-- benched; the settled (frozen) scores are untouched either way. The point of
-- this migration is to make the data legal so PR 3's unique index can be built.
--
-- Scope: ALL leagues (incl. archived) so PR 3's global unique index can be built.
-- Idempotent: a second run finds nothing over capacity and updates 0 rows.
-- Does NOT touch finalized scores — re-finalizing the 3 affected matchups is a
-- separate, optional step.

WITH active AS (
  SELECT
    dl.id,
    dl.league_id,
    dl.team_id,
    dl.lineup_date,
    dl.player_id,
    CASE WHEN dl.roster_slot ~ '[0-9]+$'
         THEN regexp_replace(dl.roster_slot, '[0-9]+$', '')
         ELSE dl.roster_slot END AS base_slot
  FROM daily_lineups dl
  WHERE dl.roster_slot NOT IN ('BE', 'IR', 'TAXI', 'DROPPED')
),
ranked AS (
  SELECT
    a.id,
    c.slot_count,
    row_number() OVER (
      PARTITION BY a.team_id, a.lineup_date, a.base_slot
      ORDER BY g.tot_min DESC, g.tot_pts DESC, a.player_id ASC
    ) AS seat_rank
  FROM active a
  JOIN league_roster_config c
    ON c.league_id = a.league_id AND c.position = a.base_slot
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(pg.min), -1) AS tot_min,
           COALESCE(SUM(pg.pts),  0) AS tot_pts
    FROM player_games pg
    WHERE pg.player_id = a.player_id AND pg.game_date = a.lineup_date
  ) g ON true
)
UPDATE daily_lineups d
SET roster_slot = 'BE'
FROM ranked r
WHERE d.id = r.id
  AND r.seat_rank > r.slot_count;

-- Self-verify: fail loudly if any (team, day, base position) is still over
-- capacity, so a partial/incorrect run can never silently pass.
DO $$
DECLARE
  remaining int;
BEGIN
  SELECT count(*) INTO remaining
  FROM (
    SELECT 1
    FROM daily_lineups dl
    JOIN league_roster_config c
      ON c.league_id = dl.league_id
     AND c.position = CASE WHEN dl.roster_slot ~ '[0-9]+$'
                           THEN regexp_replace(dl.roster_slot, '[0-9]+$', '')
                           ELSE dl.roster_slot END
    WHERE dl.roster_slot NOT IN ('BE', 'IR', 'TAXI', 'DROPPED')
    GROUP BY dl.team_id, dl.lineup_date,
             CASE WHEN dl.roster_slot ~ '[0-9]+$'
                  THEN regexp_replace(dl.roster_slot, '[0-9]+$', '')
                  ELSE dl.roster_slot END,
             c.slot_count
    HAVING count(*) > c.slot_count
  ) q;

  IF remaining > 0 THEN
    RAISE EXCEPTION 'cleanup incomplete: % (team, day, base-slot) group(s) still over capacity', remaining;
  END IF;
END $$;
