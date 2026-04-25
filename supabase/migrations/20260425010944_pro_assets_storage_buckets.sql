-- Self-hosted pro team logos + player headshots, so we don't depend on
-- ESPN's CDN (a direct fantasy competitor) at runtime. The seed-pro-assets
-- Node script populates both buckets once; sync-headshots backfills new
-- players on cron.
--
-- Object paths:
--   pro-team-logos/{sport}/{tricode}.png       — e.g. pro-team-logos/nba/LAL.png
--   player-headshots/{sport}/{external_id}.png — keyed on players.external_id_nba

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('pro-team-logos',   'pro-team-logos',   true, 524288,  ARRAY['image/png','image/svg+xml']),
  ('player-headshots', 'player-headshots', true, 1048576, ARRAY['image/png'])
ON CONFLICT (id) DO NOTHING;

-- Public read (anyone can fetch logos + headshots — they're public assets).
-- Object writes go through the service role from the seeding script.
DROP POLICY IF EXISTS "Pro team logos public read" ON storage.objects;
CREATE POLICY "Pro team logos public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'pro-team-logos');

DROP POLICY IF EXISTS "Player headshots public read" ON storage.objects;
CREATE POLICY "Player headshots public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'player-headshots');
