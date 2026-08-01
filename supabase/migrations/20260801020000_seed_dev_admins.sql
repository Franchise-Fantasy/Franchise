-- Grant profiles.is_admin to the remaining app devs, so all four can create
-- NFL leagues during internal testing (leagues_nfl_admin_gate BEFORE INSERT
-- trigger + the useIsAdmin client tile filter both key on this flag).
--
-- Note is_admin is NOT NFL-only — it also grants app_config writes, the
-- cron_heartbeat read, cross-league message_reports/user_blocks moderation
-- reads, and subscribes the account to dead-letter pager pushes. That is
-- intended here: these are the app devs.
--
-- Same email-keyed, idempotent shape as the original bootstrap in
-- 20260426000002_admin_flag_and_dead_letter_alerts.sql. Runs as postgres, so
-- the profiles_guard_is_admin trigger allows the column change.

UPDATE public.profiles
   SET is_admin = true
 WHERE email IN (
         'brycechurch7@gmail.com',
         'noahgordon2021@outlook.com',
         'samuel.goldman14@gmail.com'
       )
   AND NOT is_admin;
