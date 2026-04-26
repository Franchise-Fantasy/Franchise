-- Public, key/value config readable by all clients on launch. Today this just
-- holds `min_supported_version`, which the React Native app fetches before
-- routing into the main stack so it can hard-block clients running older
-- builds when a breaking schema or RPC change ships.
--
-- Bumping the value is the operator's "abandon old clients" lever — used
-- ahead of any migration that would brick last-quarter's binary in the wild.

CREATE TABLE IF NOT EXISTS public.app_config (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- Readable by everyone, including unauthenticated clients (the version check
-- happens before sign-in too, in case a stale guest install opens the app).
DROP POLICY IF EXISTS "app_config public read" ON public.app_config;
CREATE POLICY "app_config public read" ON public.app_config
  FOR SELECT TO anon, authenticated
  USING (true);

-- Writes are admin-only. There's no in-app UI for this — admins update via
-- the Supabase SQL editor or a one-off psql session.
DROP POLICY IF EXISTS "app_config admin write" ON public.app_config;
CREATE POLICY "app_config admin write" ON public.app_config
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.is_admin = true
    )
  );

-- Seed: current shipping version is 1.1.6, so set the floor there. The next
-- time a breaking change ships, bump these values to that release's version.
INSERT INTO public.app_config (key, value)
VALUES ('min_supported_version', '{"ios":"1.1.6","android":"1.1.6"}'::jsonb)
ON CONFLICT (key) DO NOTHING;
