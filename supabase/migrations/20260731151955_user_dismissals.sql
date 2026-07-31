-- Cross-device "I've already seen this" state.
--
-- Every dismissable one-time surface in the app persisted its seen-set to
-- AsyncStorage, which on web is plain localStorage. That makes the state
-- per-device AND per-browser-profile, so a fresh web login replayed every
-- commissioner announcement, the latest matchup-result popup, the live CMS
-- banner, and every coach mark. Each key also capped itself at the last 20 ids,
-- so even on a single device old dismissals silently aged out and re-showed.
--
-- One table serves all four surfaces because every call site asks the identical
-- question: "has this user seen id X?".
--
--   announcement    commissioner_announcements.id  (AnnouncementBanner)
--   matchup_result  league_matchups.id             (MatchupResultModal)
--   home_banner     Contentful entry id            (HomeAnnouncementBanner)
--   coach_mark      hand-written slug              (CoachMark / roster tap hint)
--
-- `item_id` is text, not uuid: Contentful entry ids and coach-mark slugs aren't
-- uuids. No FK to the referenced rows for the same reason (and a dangling
-- dismissal is harmless — the surface it refers to is already gone).

CREATE TABLE IF NOT EXISTS public.user_dismissals (
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('announcement', 'matchup_result', 'home_banner', 'coach_mark')),
  item_id      text NOT NULL CHECK (length(item_id) BETWEEN 1 AND 200),
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, item_id)
);

COMMENT ON TABLE public.user_dismissals IS
  'Per-account seen/dismissed state for one-time UI surfaces (announcements, matchup-result popup, CMS banners, coach marks). Replaces the per-device AsyncStorage sets so dismissing on one platform sticks everywhere.';

-- The client reads the whole set for one user in a single query at boot; the PK
-- prefix (user_id) serves it, so no extra index is needed for reads. This one
-- exists only for the retention prune below, which scans by age.
CREATE INDEX IF NOT EXISTS idx_user_dismissals_prune
  ON public.user_dismissals (dismissed_at)
  WHERE kind <> 'coach_mark';

ALTER TABLE public.user_dismissals ENABLE ROW LEVEL SECURITY;

-- Own rows only. `(SELECT auth.uid())` rather than a bare call so the uid is
-- evaluated once per statement instead of once per row.
DROP POLICY IF EXISTS "Users manage their own dismissals" ON public.user_dismissals;
CREATE POLICY "Users manage their own dismissals" ON public.user_dismissals
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- Retention prune.
--
-- Not just housekeeping: PostgREST truncates any response at max_rows (1000)
-- with no error, so an unbounded set would eventually return a PARTIAL seen-set
-- and the oldest surfaces would quietly start re-showing — the same failure the
-- 20-id AsyncStorage cap produced, just later.
--
-- The three time-bound kinds only ever gate the single most-recent item, so a
-- months-old dismissal is dead weight. 180 days keeps a heavy user (10 leagues x
-- ~26 finalized weeks) at a few hundred rows. The tradeoff: someone who doesn't
-- open the app for >180 days sees their last matchup result once more.
--
-- Coach marks are exempt — they're permanent, and there are only a handful of
-- ids in the entire app.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prune_user_dismissals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.user_dismissals
  WHERE kind <> 'coach_mark'
    AND dismissed_at < now() - interval '180 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- Cron-only. REVOKE FROM anon, authenticated does NOT strip the implicit PUBLIC
-- grant (and PUBLIC covers anon), so the PUBLIC revoke is the one that actually
-- closes it — see 20260727010000_revoke_public_execute_secdef.sql.
REVOKE EXECUTE ON FUNCTION public.prune_user_dismissals() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prune_user_dismissals() FROM anon, authenticated;

-- Unschedule first so a re-apply can't fail on the duplicate job name. Most of
-- this migration is already idempotent (IF NOT EXISTS / OR REPLACE / DROP
-- POLICY IF EXISTS); cron.schedule is the one statement that isn't.
SELECT cron.unschedule('prune-user-dismissals-weekly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-user-dismissals-weekly');

SELECT cron.schedule(
  'prune-user-dismissals-weekly',
  '40 9 * * 0',
  $$SELECT public.prune_user_dismissals()$$
);
