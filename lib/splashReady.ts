// Shared hand-off between screens that have "critical data" the native
// splash should wait on and the SplashGate in app/_layout.tsx.
//
// The gate registers a setter at mount; screens call `markSplashReady()`
// once their own data has settled. The gate is still responsible for
// holding on auth + app-state readiness and for falling back to hiding
// the splash after a timeout if nothing ever reports in.

let markFn: (() => void) | null = null;

export function registerSplashReadyHandler(fn: () => void): () => void {
  markFn = fn;
  return () => {
    if (markFn === fn) markFn = null;
  };
}

export function markSplashReady(): void {
  markFn?.();
}
