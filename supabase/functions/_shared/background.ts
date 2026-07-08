// Fire-and-guarantee for non-critical post-response work — push fan-out, matview
// refreshes, best-effort logging. Uses the Supabase edge runtime's
// `EdgeRuntime.waitUntil` to keep the worker alive until the promise settles, so
// the HTTP response can return immediately without the caller awaiting it. Falls
// back to a plain unawaited `.catch()` when EdgeRuntime is absent (e.g. running
// `supabase functions serve` locally).
//
// ONLY pass work whose failure is non-fatal to the request: errors are caught
// and logged here, never surfaced to the client. Evaluate the promise's inputs
// BEFORE calling deferWork (they're captured when the promise is created).
export function deferWork(promise: Promise<unknown>, label = 'deferred work'): void {
  const settled = promise.catch((err) => console.warn(`${label} failed (non-fatal):`, err));
  // @ts-ignore - EdgeRuntime is a Supabase edge-runtime global (typed via edge-runtime.d.ts)
  const rt: { waitUntil?: (p: Promise<unknown>) => void } | undefined =
    // @ts-ignore
    typeof EdgeRuntime !== 'undefined' ? EdgeRuntime : undefined;
  rt?.waitUntil?.(settled);
}
