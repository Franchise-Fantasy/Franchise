-- RLS hygiene pass driven by Supabase performance advisor lints:
--   1) auth_rls_initplan: wrap `auth.uid()` / `auth.role()` in `(SELECT ...)` so
--      Postgres evaluates the function once per query instead of once per row.
--   2) multiple_permissive_policies: consolidate overlapping PERMISSIVE policies
--      into one policy per (role, command) pair. When multiple permissive policies
--      match, Postgres evaluates every one and ORs them — cheaper to express the
--      OR directly in a single policy.
--
-- Behavior is preserved: every consolidated policy grants access to the union
-- of principals that any of the original policies granted.

-- =====================================================================
-- prospect_boards: initplan fix
-- =====================================================================
DROP POLICY IF EXISTS "Users manage own board" ON public.prospect_boards;
CREATE POLICY "Users manage own board" ON public.prospect_boards
  FOR ALL
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- =====================================================================
-- prospect_news / prospect_news_mentions: initplan fix
-- =====================================================================
DROP POLICY IF EXISTS "Authenticated users read prospect news" ON public.prospect_news;
CREATE POLICY "Authenticated users read prospect news" ON public.prospect_news
  FOR SELECT
  USING ((SELECT auth.role()) = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users read prospect news mentions" ON public.prospect_news_mentions;
CREATE POLICY "Authenticated users read prospect news mentions" ON public.prospect_news_mentions
  FOR SELECT
  USING ((SELECT auth.role()) = 'authenticated');

-- =====================================================================
-- league_payments: consolidate 4 overlapping policies into 4 per-command policies
--
-- Principals granted before:
--   Commissioner      : all operations on any row in their league
--   League member     : SELECT any row in their league
--   Team owner        : SELECT/UPDATE/DELETE own team's rows;
--                       INSERT only when status='self_reported' for own team
-- =====================================================================
DROP POLICY IF EXISTS "Commissioner can manage payments" ON public.league_payments;
DROP POLICY IF EXISTS "League members can read payments" ON public.league_payments;
DROP POLICY IF EXISTS "Team owners can insert self-report" ON public.league_payments;
DROP POLICY IF EXISTS "Team owners can self-report payment" ON public.league_payments;

CREATE POLICY league_payments_select ON public.league_payments
  FOR SELECT
  USING (
    is_league_commissioner(league_id)
    OR EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.league_id = league_payments.league_id
        AND t.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY league_payments_insert ON public.league_payments
  FOR INSERT
  WITH CHECK (
    is_league_commissioner(league_id)
    OR (
      status = 'self_reported'
      AND EXISTS (
        SELECT 1 FROM public.teams t
        WHERE t.id = league_payments.team_id
          AND t.user_id = (SELECT auth.uid())
      )
    )
  );

CREATE POLICY league_payments_update ON public.league_payments
  FOR UPDATE
  USING (
    is_league_commissioner(league_id)
    OR EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = league_payments.team_id
        AND t.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    is_league_commissioner(league_id)
    OR (
      status = 'self_reported'
      AND EXISTS (
        SELECT 1 FROM public.teams t
        WHERE t.id = league_payments.team_id
          AND t.user_id = (SELECT auth.uid())
      )
    )
  );

CREATE POLICY league_payments_delete ON public.league_payments
  FOR DELETE
  USING (
    is_league_commissioner(league_id)
    OR EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = league_payments.team_id
        AND t.user_id = (SELECT auth.uid())
    )
  );

-- =====================================================================
-- survey_responses: consolidate 2 SELECT policies
-- =====================================================================
DROP POLICY IF EXISTS "Commissioner can read all survey responses" ON public.survey_responses;
DROP POLICY IF EXISTS "Members can read own survey responses" ON public.survey_responses;

CREATE POLICY survey_responses_select ON public.survey_responses
  FOR SELECT
  USING (
    survey_id IN (
      SELECT cs.id
      FROM public.commissioner_surveys cs
      JOIN public.leagues l ON l.id = cs.league_id
      WHERE l.created_by = (SELECT auth.uid())
    )
    OR team_id IN (
      SELECT t.id FROM public.teams t
      WHERE t.user_id = (SELECT auth.uid())
    )
  );

-- =====================================================================
-- draft_team_status: split "ALL" + "SELECT" into command-scoped policies
-- so SELECT has exactly one permissive policy.
--
-- Before: "League members can read ..." (SELECT) + "Team owners manage ..." (ALL).
-- After:  SELECT policy = league-members-can-read (team owners are league
--         members, so no behavior loss). INSERT/UPDATE/DELETE restricted to
--         the row's team owner.
-- =====================================================================
DROP POLICY IF EXISTS "League members can read draft team status" ON public.draft_team_status;
DROP POLICY IF EXISTS "Team owners manage own draft status" ON public.draft_team_status;

CREATE POLICY draft_team_status_select ON public.draft_team_status
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.drafts d
      JOIN public.teams t ON t.league_id = d.league_id
      WHERE d.id = draft_team_status.draft_id
        AND t.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY draft_team_status_insert ON public.draft_team_status
  FOR INSERT
  WITH CHECK (
    team_id IN (
      SELECT t.id FROM public.teams t
      WHERE t.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY draft_team_status_update ON public.draft_team_status
  FOR UPDATE
  USING (
    team_id IN (
      SELECT t.id FROM public.teams t
      WHERE t.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    team_id IN (
      SELECT t.id FROM public.teams t
      WHERE t.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY draft_team_status_delete ON public.draft_team_status
  FOR DELETE
  USING (
    team_id IN (
      SELECT t.id FROM public.teams t
      WHERE t.user_id = (SELECT auth.uid())
    )
  );
