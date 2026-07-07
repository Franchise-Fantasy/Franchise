-- Security review 2026-07-07 — MEDIUM: ownership-free INSERT policies.
--
-- These INSERT policies checked only is_league_member(league_id) with no
-- binding to the caller's own team / proposal, letting a member write rows on
-- behalf of other teams (tamper with another team's trade proposal, put an
-- arbitrary player on waivers, forge activity-feed entries, seed waiver
-- priority). Bind each WITH CHECK to caller ownership. Service-role edge writes
-- (process-waivers, commissioner-action, reverse-trade, imports) bypass RLS and
-- are unaffected.

-- Only the proposal's proposer may add items/teams to it.
DROP POLICY IF EXISTS trade_proposal_items_insert ON public.trade_proposal_items;
CREATE POLICY trade_proposal_items_insert ON public.trade_proposal_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM trade_proposals tp
    WHERE tp.id = proposal_id AND tp.proposed_by_team_id = my_team_id(tp.league_id)
  ));

DROP POLICY IF EXISTS trade_proposal_teams_insert ON public.trade_proposal_teams;
CREATE POLICY trade_proposal_teams_insert ON public.trade_proposal_teams
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM trade_proposals tp
    WHERE tp.id = proposal_id AND tp.proposed_by_team_id = my_team_id(tp.league_id)
  ));

-- A team may only put its OWN drop on waivers.
DROP POLICY IF EXISTS "League members can insert league waivers" ON public.league_waivers;
CREATE POLICY "Teams put their own drops on waivers" ON public.league_waivers
  FOR INSERT TO authenticated
  WITH CHECK (is_league_member(league_id) AND dropped_by_team_id = my_team_id(league_id));

-- A team may only insert its OWN waiver-priority row.
DROP POLICY IF EXISTS "League members can insert waiver priority" ON public.waiver_priority;
CREATE POLICY "Teams insert their own waiver priority" ON public.waiver_priority
  FOR INSERT TO authenticated
  WITH CHECK (is_league_member(league_id) AND team_id = my_team_id(league_id));

-- A member may only log a transaction for their OWN team.
DROP POLICY IF EXISTS league_transactions_insert ON public.league_transactions;
CREATE POLICY league_transactions_insert ON public.league_transactions
  FOR INSERT TO authenticated
  WITH CHECK (is_league_member(league_id) AND team_id = my_team_id(league_id));
