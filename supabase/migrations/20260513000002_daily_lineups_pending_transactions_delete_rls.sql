-- Add missing DELETE policies on daily_lineups and pending_transactions.
--
-- Both tables had RLS enabled with INSERT/SELECT (and UPDATE for daily_lineups)
-- policies but no DELETE policy. PostgreSQL silently rejects DELETEs in that
-- case — 0 rows affected, no error — which broke the drop flow in two places:
--
--   1. handleDropPlayer / handleDropAndActivateFromIR / locked-day add/drop
--      all call `.delete().gt('lineup_date', today)` to wipe future
--      daily_lineups rows for the dropped player. Without a DELETE policy,
--      pre-set future lineups for the dropped player remain visible on the
--      matchup page even after the drop completes.
--
--   2. The locked-day add-and-drop rollback path calls `.delete().eq('id',
--      queuedDrop.id)` on pending_transactions when addFreeAgent throws after
--      the drop is queued. Without a DELETE policy, a failed add leaves the
--      queued drop stranded.
--
-- Both policies use the same predicate as the existing UPDATE/SELECT-team
-- policies: the user can delete rows for their own team in a league they're
-- a member of. Service-role traffic (crons, edge fns) bypasses RLS entirely.

CREATE POLICY "daily_lineups_delete" ON public.daily_lineups
  FOR DELETE
  USING (
    is_league_member(league_id)
    AND team_id = my_team_id(league_id)
  );

CREATE POLICY "pending_transactions_delete" ON public.pending_transactions
  FOR DELETE
  USING (team_id = my_team_id(league_id));
