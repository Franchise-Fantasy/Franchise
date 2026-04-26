/**
 * Retry helpers for outbound HTTP / async operations.
 *
 * Polling edge functions hit external APIs (BDL, Rotowire RSS) that have
 * transient flakes. Without retry, one timed-out tick produces a missed
 * cron cycle. With retry, transient 5xx/429s recover within the same tick.
 *
 * Retries are bounded:
 *   - Only retry retryable errors: network failures, 5xx, 429
 *   - Do NOT retry 4xx (other than 429) — those are caller bugs, retrying
 *     just wastes the cron tick budget
 *   - Cap at 3 attempts (1 + 2 retries)
 *   - Exponential backoff with jitter to avoid thundering herd
 */

export interface RetryOptions {
  attempts?: number;       // total tries including the first; default 3
  baseMs?: number;         // initial backoff; default 200ms
  maxMs?: number;          // cap on a single backoff; default 3000ms
  /** Override which errors are retryable. Defaults to network + 5xx + 429. */
  shouldRetry?: (err: unknown) => boolean;
}

const DEFAULTS: Required<Omit<RetryOptions, 'shouldRetry'>> = {
  attempts: 3,
  baseMs: 200,
  maxMs: 3000,
};

/**
 * Retry a fetch() call with exponential backoff + jitter on retryable errors.
 * The Response is parsed lazily — callers handle res.json() themselves.
 *
 * Throws either the last network Error, or a Response-shaped Error for non-2xx.
 */
export async function fetchWithRetry(
  input: string | URL,
  init?: RequestInit,
  opts?: RetryOptions,
): Promise<Response> {
  const o = { ...DEFAULTS, ...opts };
  let lastErr: unknown;

  for (let attempt = 1; attempt <= o.attempts; attempt++) {
    try {
      const res = await fetch(input, init);
      if (res.ok) return res;
      // Retryable HTTP failure: 5xx, 429
      if (res.status >= 500 || res.status === 429) {
        const text = await res.text().catch(() => '');
        lastErr = new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        (lastErr as any).status = res.status;
      } else {
        // Non-retryable: bubble up immediately
        const text = await res.text().catch(() => '');
        const err = new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        (err as any).status = res.status;
        throw err;
      }
    } catch (err) {
      lastErr = err;
      const retryable = opts?.shouldRetry
        ? opts.shouldRetry(err)
        : isRetryable(err);
      if (!retryable) throw err;
    }

    if (attempt < o.attempts) {
      await sleep(backoffMs(attempt, o.baseMs, o.maxMs));
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error(String(lastErr ?? 'fetchWithRetry failed'));
}

/** Generic async retry — useful for non-fetch operations (DB, push). */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: RetryOptions,
): Promise<T> {
  const o = { ...DEFAULTS, ...opts };
  let lastErr: unknown;

  for (let attempt = 1; attempt <= o.attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = opts?.shouldRetry
        ? opts.shouldRetry(err)
        : isRetryable(err);
      if (!retryable || attempt >= o.attempts) throw err;
      await sleep(backoffMs(attempt, o.baseMs, o.maxMs));
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const status = (err as any).status as number | undefined;
  if (typeof status === 'number') {
    return status >= 500 || status === 429;
  }
  // Network-layer failure — Deno surfaces these as TypeError or DOMException
  const name = err.name?.toLowerCase() ?? '';
  return name.includes('typeerror') || name.includes('aborterror') || name.includes('timeouterror');
}

function backoffMs(attempt: number, baseMs: number, maxMs: number): number {
  // Exponential: base * 2^(attempt-1), capped at maxMs, with ±50% jitter
  const exp = Math.min(baseMs * Math.pow(2, attempt - 1), maxMs);
  const jitter = exp * (0.5 + Math.random()); // 0.5x .. 1.5x
  return Math.floor(jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
