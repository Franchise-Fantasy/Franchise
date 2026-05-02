-- Revert search_path from '' to 'public' on functions whose bodies use
-- unqualified table references. The 2026-04-12 hardening pass set these
-- to '' but missed that the bodies reference `teams`, `draft_team_status`,
-- `leagues`, and `profiles` without schema prefixes, causing every call to
-- throw "relation does not exist" at runtime.
--
-- Same fix pattern as 20260419141156_search_path_hardening_phase2_fix.sql.
-- 'public' still blocks search_path-injection (no extension shadows possible)
-- but preserves the function body's lookup assumptions.

ALTER FUNCTION public.set_autopick(uuid, uuid, boolean)
  SET search_path = public;

ALTER FUNCTION public.ping_draft_presence(uuid, uuid, boolean)
  SET search_path = public;

ALTER FUNCTION public.transfer_team_ownership(uuid, uuid, text)
  SET search_path = public;
