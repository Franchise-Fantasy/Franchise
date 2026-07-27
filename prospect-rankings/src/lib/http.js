// Polite fetch wrapper: honest user-agent, timeout, one retry, delay between calls.
const UA = "FranchiseFantasyBot/1.0 (weekly prospect rankings; contact: noahgordon2021@outlook.com)";
const DELAY_MS = 4000;

// GitHub Actions runner IPs sit on Cloudflare/Akamai bot-manager deny lists:
// from CI, nbadraft.net answers 403 and espn.com answers 200 with a challenge
// page (no ranking table — the scraper reads it as an empty board), while the
// same request from a normal IP returns the real page. When SCRAPE_PROXY_URL is
// set, page fetches go through the scrape-proxy edge function instead, which
// makes the request from Supabase's egress. Unset (local runs) → fetch direct.
const PROXY_URL = process.env.SCRAPE_PROXY_URL || null;

let lastFetch = 0;

export async function fetchPage(url) {
  const wait = lastFetch + DELAY_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetch = Date.now();

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return PROXY_URL ? await fetchViaProxy(url) : await fetchDirect(url);
    } catch (err) {
      if (attempt === 2) throw err;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

async function fetchDirect(url) {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html" },
    signal: AbortSignal.timeout(30000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// Longer timeout than fetchDirect so the proxy's own 30s upstream timeout is the
// one that fires — a proxy-side failure gives a far more specific error message.
async function fetchViaProxy(url) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SCRAPE_PROXY_URL is set but SUPABASE_SERVICE_ROLE_KEY is not");

  const res = await fetch(PROXY_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(45000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`proxy ${res.status}: ${body.error ?? "unknown error"} for ${url}`);
  return body.html;
}
