-- Atomic per-matchup finalize. finalize-week previously ran four separate steps:
--   1. bulk claim   UPDATE league_matchups SET is_finalized=true  (stats_flushed stays false)
--   2. per-matchup  UPDATE ... home_score/away_score/winner_team_id
--   3. bulk         increment_team_stats (additive W/L) + week_scores upsert
--   4. bulk         UPDATE ... stats_flushed=true
-- Each is its own commit, which opened two permanent-corruption windows:
--
--   A) Crash/timeout AFTER (1) but before (2) scores a matchup. home_score and
--      away_score are NOT NULL DEFAULT 0 and winner_team_id defaults NULL, so the
--      row is byte-identical to a genuine 0-0 tie. The next run's recovery block
--      read those defaults, recorded a 0-0 TIE, incremented ties for both teams,
--      and set stats_flushed — and the matchup was never re-scored (the claim only
--      selects is_finalized=false). The real result was destroyed for good.
--
--   B) Crash AFTER (3) but before (4). The next run's recovery re-ran
--      increment_team_stats on an already-counted matchup → W/L double-counted.
--      Only PF/PA self-heals (it is recomputed absolutely); W/L is purely additive.
--
-- Both are amplified by pgmq at-least-once redelivery and the ~70s edge wall clock.
--
-- This function inverts the order: the edge function computes the score FIRST (that
-- work is pure TS and can't move into SQL), then calls this to CLAIM and PERSIST in
-- one transaction. Consequences:
--   * A crash mid-computation claims nothing → the matchup stays is_finalized=false
--     and is simply re-scored on the next run. No unscored-but-claimed row exists.
--   * The claim, the score, and the W/L increment commit together → no double count.
--   * Two concurrent runs both compute, but the conditional UPDATE means only one
--     wins the row; the loser gets claimed=false and applies nothing.
--
-- Byes (away_team_id IS NULL) are finalized by the caller in a single bulk UPDATE —
-- they have no opponent, score, or W/L, so there is nothing to make atomic.
--
-- Returns { claimed: true } or { claimed: false } (already finalized by another run).

CREATE OR REPLACE FUNCTION public.finalize_matchup_atomic(
  p_matchup_id uuid,
  p_league_id uuid,
  p_schedule_id uuid,
  p_home_team_id uuid,
  p_away_team_id uuid,
  p_home_score numeric,
  p_away_score numeric,
  p_winner_team_id uuid,
  p_home_category_wins integer,
  p_away_category_wins integer,
  p_category_ties integer,
  p_category_results jsonb,
  p_home_player_scores jsonb,
  p_away_player_scores jsonb,
  p_is_playoff boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Claim + write the result together. Only an unfinalized matchup matches, so a
  -- concurrent run can never apply W/L for the same matchup twice.
  UPDATE league_matchups
  SET is_finalized       = true,
      stats_flushed      = true,
      home_score         = p_home_score,
      away_score         = p_away_score,
      winner_team_id     = p_winner_team_id,
      home_category_wins = p_home_category_wins,
      away_category_wins = p_away_category_wins,
      category_ties      = p_category_ties,
      category_results   = p_category_results,
      home_player_scores = p_home_player_scores,
      away_player_scores = p_away_player_scores
  WHERE id = p_matchup_id AND is_finalized = false;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false);
  END IF;

  IF p_is_playoff THEN
    UPDATE playoff_bracket SET winner_id = p_winner_team_id WHERE matchup_id = p_matchup_id;
  END IF;

  INSERT INTO week_scores (league_id, schedule_id, team_id, score, updated_at)
  VALUES (p_league_id, p_schedule_id, p_home_team_id, p_home_score, now()),
         (p_league_id, p_schedule_id, p_away_team_id, p_away_score, now())
  ON CONFLICT (league_id, schedule_id, team_id)
  DO UPDATE SET score = EXCLUDED.score, updated_at = EXCLUDED.updated_at;

  -- Standings W/L is regular-season only. PF/PA is deliberately passed as 0 here:
  -- the caller recomputes it absolutely from league_matchups afterwards (that pass
  -- is self-healing, so counting it additively here would double it).
  IF NOT p_is_playoff THEN
    IF p_winner_team_id = p_home_team_id THEN
      PERFORM increment_team_stats(p_home_team_id, 1, 0, 0, 0, 0);
      PERFORM increment_team_stats(p_away_team_id, 0, 1, 0, 0, 0);
    ELSIF p_winner_team_id = p_away_team_id THEN
      PERFORM increment_team_stats(p_away_team_id, 1, 0, 0, 0, 0);
      PERFORM increment_team_stats(p_home_team_id, 0, 1, 0, 0, 0);
    ELSE
      PERFORM increment_team_stats(p_home_team_id, 0, 0, 1, 0, 0);
      PERFORM increment_team_stats(p_away_team_id, 0, 0, 1, 0, 0);
    END IF;
  END IF;

  RETURN jsonb_build_object('claimed', true);
END;
$$;

-- Service-role / definer only (cron owns the auth). REVOKE from public AND from
-- anon/authenticated — stripping only one leaves the other reachable.
GRANT EXECUTE ON FUNCTION public.finalize_matchup_atomic(uuid, uuid, uuid, uuid, uuid, numeric, numeric, uuid, integer, integer, integer, jsonb, jsonb, jsonb, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.finalize_matchup_atomic(uuid, uuid, uuid, uuid, uuid, numeric, numeric, uuid, integer, integer, integer, jsonb, jsonb, jsonb, boolean) FROM public;
REVOKE ALL ON FUNCTION public.finalize_matchup_atomic(uuid, uuid, uuid, uuid, uuid, numeric, numeric, uuid, integer, integer, integer, jsonb, jsonb, jsonb, boolean) FROM anon, authenticated;
