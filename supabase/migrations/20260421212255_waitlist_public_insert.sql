-- waitlist_signups: broaden INSERT policy target.
--
-- The prior policy was `TO anon` only. In practice, the landing form fails
-- with 42501 when the Next.js client uses the sb_publishable_* key: despite
-- the same key working for the mobile app's authenticated writes, PostgREST's
-- role resolution for unauthenticated publishable-key requests does not
-- match this policy's `TO anon` target for this project, so every signup
-- silently drops.
--
-- Switching `TO public` is safe: the WITH CHECK expression is unchanged, so
-- the same email-shape, length, and source caps still enforce data validity.
-- Public here means "any role, authenticated or not" — desirable anyway,
-- since a signed-in mobile user joining the waitlist from a share link
-- should also work.

DROP POLICY IF EXISTS "Allow anonymous inserts" ON public.waitlist_signups;
DROP POLICY IF EXISTS "Allow waitlist inserts" ON public.waitlist_signups;

CREATE POLICY "Allow waitlist inserts" ON public.waitlist_signups
  FOR INSERT
  TO public
  WITH CHECK (
    length(email) BETWEEN 5 AND 254
    AND email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    AND (source IS NULL OR length(source) <= 64)
  );
