-- Pin search_path on SECURITY DEFINER functions that were missing it.
-- Prevents search_path manipulation attacks per Supabase advisory.
-- Only 3 functions were affected — the rest already had SET search_path.

ALTER FUNCTION public.ping_draft_presence(uuid, uuid, boolean)
  SET search_path = '';

ALTER FUNCTION public.set_autopick(uuid, uuid, boolean)
  SET search_path = '';

ALTER FUNCTION public.transfer_team_ownership(uuid, uuid, text)
  SET search_path = '';
