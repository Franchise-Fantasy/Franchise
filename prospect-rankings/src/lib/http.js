// Polite fetch wrapper: honest user-agent, timeout, one retry, delay between calls.
const UA = "FranchiseFantasyBot/1.0 (weekly prospect rankings; contact: noahgordon2021@outlook.com)";
const DELAY_MS = 4000;

let lastFetch = 0;

export async function fetchPage(url) {
  const wait = lastFetch + DELAY_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetch = Date.now();

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "text/html" },
        signal: AbortSignal.timeout(30000),
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      if (attempt === 2) throw err;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
