-- Fix: commissioners could not read back the draft row during league creation
-- because drafts_select only checked is_league_member, but the commissioner
-- has no team yet at that point. Allow commissioners to read drafts too.
DROP POLICY IF EXISTS drafts_select ON public.drafts;
CREATE POLICY drafts_select ON public.drafts
  FOR SELECT
  USING (is_league_member(league_id) OR is_league_commissioner(league_id));
