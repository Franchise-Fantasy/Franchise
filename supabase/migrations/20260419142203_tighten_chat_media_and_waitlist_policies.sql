-- chat-media: replace broad public-read with league-member-scoped read.
-- Paths are `{league_id}/{uuid}.jpg` (see upload-chat-media edge function),
-- so the first folder segment is the league UUID. Members of that league
-- (i.e. users with a team in it) can LIST/SELECT their league's objects.
-- Public object URLs still resolve for anyone with the direct URL because
-- the bucket itself remains public — this only limits enumeration.
DROP POLICY IF EXISTS chat_media_public_read ON storage.objects;

CREATE POLICY chat_media_league_member_read ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.league_id::text = (storage.foldername(name))[1]
        AND t.user_id = (SELECT auth.uid())
    )
  );

-- waitlist_signups: tighten anonymous INSERT.
-- Before: WITH CHECK (true) — any row accepted, no limits, flagged by linter.
-- After:  email shape + length caps + source cap. Blocks obvious bot fills;
--         stronger protection (Turnstile, rate-limit trigger) can be layered
--         on later if spam ever materializes.
DROP POLICY IF EXISTS "Allow anonymous inserts" ON public.waitlist_signups;

CREATE POLICY "Allow anonymous inserts" ON public.waitlist_signups
  FOR INSERT
  TO anon
  WITH CHECK (
    length(email) BETWEEN 5 AND 254
    AND email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    AND (source IS NULL OR length(source) <= 64)
  );
