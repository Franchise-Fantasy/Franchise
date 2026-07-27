// Fetches a public HTML page from Supabase's egress and returns the markup.
//
// Why this exists: GitHub Actions runner IPs sit on Cloudflare/Akamai bot-manager
// deny lists, so the weekly prospect-rankings scrape (.github/workflows/prospect-rankings.yml)
// gets a 403 from nbadraft.net and a challenge page (HTTP 200 with no ranking
// table, which the scraper reads as an empty board) from espn.com when it runs
// there — while the exact same request from Supabase's egress returns the real
// page. The Action routes its page fetches through here instead.
//
// Service-key only, plus a host allowlist so this can never be turned into an
// open SSRF relay.

import { corsResponse } from '../_shared/cors.ts';
import { handleError, HttpError, jsonResponse } from '../_shared/http.ts';
import { parseBody, z } from '../_shared/validate.ts';

// Same honest bot user-agent the scraper sends when it fetches directly.
const UA =
  'FranchiseFantasyBot/1.0 (weekly prospect rankings; contact: noahgordon2021@outlook.com)';

const ALLOWED_HOSTS = new Set([
  'www.nbadraft.net',
  'www.tankathon.com',
  'www.rotoballer.com',
  'www.espn.com',
]);

const Body = z.object({ url: z.string().url() });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  try {
    const secret = Deno.env.get('SB_SECRET_KEY');
    if (!secret || req.headers.get('Authorization') !== `Bearer ${secret}`) {
      throw new HttpError('Unauthorized', 401);
    }

    const { url } = parseBody(Body, await req.json());
    const target = new URL(url);
    if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) {
      throw new HttpError(`Host not allowed: ${target.hostname}`, 403);
    }

    const res = await fetch(target, {
      headers: { 'user-agent': UA, accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });
    // 502 not 500: the failure is upstream, and the caller retries on it.
    if (!res.ok) throw new HttpError(`HTTP ${res.status} for ${url}`, 502);

    return jsonResponse({ html: await res.text() });
  } catch (error) {
    return handleError(error, 'scrape-proxy');
  }
});
