-- Scoring-side prevention for the duplicate-slot data-integrity bug.
--
-- Background: a per-day lineup edit can leave more players active in a position
-- than the league allows (two players both 'UTIL2', or three 'G' when G's
-- slot_count is 2). finalize-week and live scoring sum every active-slot game
-- with no per-position cap, so a surplus occupant who played inflates the score.
-- PR1 healed the existing rows; the readers were made dup-tolerant (positional
-- fill can't double-book a seat). This closes the remaining gap on the SCORING
-- side without touching the scoring math: keep daily_lineups legal so the
-- scorers never see an over-capacity day.
--
-- `dedup_active_lineup_slots(start, end)` benches the surplus active occupant in
-- any (team, day, base position) over capacity within the date range, keeping
-- the occupants who played the most that day (minutes, then points, then
-- player_id for determinism). Idempotent — a second run benches nothing.
-- Returns the number of rows benched.
--
-- Callers: (1) finalize-week invokes it for the week being finalized BEFORE it
-- loads team data, so a finalized (standings-affecting) score is always computed
-- on legal data regardless of cron timing; (2) an hourly pg_cron run keeps the
-- live week's daily_lineups legal so in-progress scores/standings don't drift.
-- Service-role / definer only — never client-callable.

CREATE OR REPLACE FUNCTION public.dedup_active_lineup_slots(
  p_start_date date,
  p_end_date date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
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
    WHERE dl.lineup_date BETWEEN p_start_date AND p_end_date
      AND dl.roster_slot NOT IN ('BE', 'IR', 'TAXI', 'DROPPED')
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
  ),
  upd AS (
    UPDATE daily_lineups d
    SET roster_slot = 'BE'
    FROM ranked r
    WHERE d.id = r.id
      AND r.seat_rank > r.slot_count
    RETURNING d.id
  )
  SELECT count(*) INTO v_count FROM upd;

  RETURN v_count;
END;
$$;

-- Definer + service-role only: cron and finalize-week (service role) call it;
-- clients never should.
REVOKE ALL ON FUNCTION public.dedup_active_lineup_slots(date, date) FROM anon, authenticated;

-- Hourly sweep keeps the live week legal (cheap: only over-capacity rows are
-- touched, normally zero). The finalize-time call is the gap-free guarantee for
-- settled scores; this just keeps in-progress scores honest between finalizes.
-- A ±1 day window absorbs the 5am-ET slate boundary vs UTC.
SELECT cron.schedule(
  'dedup-active-lineup-slots-hourly',
  '17 * * * *',
  $$SELECT public.dedup_active_lineup_slots((current_date - 1)::date, (current_date + 1)::date)$$
);
