-- Resolve security-advisor lints surfaced 2026-04-25:
--   * rls_enabled_no_policy on public.rate_limits
--   * materialized_view_in_api on public.player_season_stats (partial fix)
--   * public_bucket_allows_listing on player-headshots, pro-team-logos, team-logos


-- ─── rate_limits: deny-all client policy ─────────────────────────
-- The table is touched ONLY by check_rate_limit() (SECURITY DEFINER),
-- which is invoked from edge functions via service_role. No client path
-- should read or write it. Add an explicit deny so the table's intent is
-- captured in schema (and the lint clears).

DROP POLICY IF EXISTS "rate_limits_no_client_access" ON public.rate_limits;
CREATE POLICY "rate_limits_no_client_access" ON public.rate_limits
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);


-- ─── player_season_stats: revoke anon access ─────────────────────
-- The MV currently grants `arwdDxtm` to anon AND authenticated. anon
-- has no business with anything (signed-out users don't see player pages
-- pre-signup). authenticated keeps SELECT — the data is publicly-known
-- NBA stats and refactoring 14 client call sites onto an RPC would be
-- pure churn. The advisor lint will remain as long as authenticated
-- has direct API access; that is an accepted trade-off documented here.

REVOKE ALL ON public.player_season_stats FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.player_season_stats FROM authenticated;

COMMENT ON MATERIALIZED VIEW public.player_season_stats IS
  'Aggregated NBA/WNBA season stats. SELECT granted to authenticated; '
  'data is publicly known (ESPN/NBA.com). Direct API access is an '
  'accepted trade-off vs. wrapping every read in an RPC.';


-- ─── storage: drop broad SELECT on public buckets ────────────────
-- Public buckets serve via /storage/v1/object/public/<bucket>/<path>
-- without needing a SELECT policy. The current policies allow .list()
-- which lets clients enumerate every object key. Dropping them keeps
-- direct CDN access working but disables enumeration.
-- (chat-media policy is correctly scoped to league members; leave it.)

DROP POLICY IF EXISTS "Player headshots public read"      ON storage.objects;
DROP POLICY IF EXISTS "Pro team logos public read"        ON storage.objects;
DROP POLICY IF EXISTS "Team logos are publicly readable"  ON storage.objects;
