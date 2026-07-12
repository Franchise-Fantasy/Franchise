import React from "react";

/**
 * Native passthrough for the web-only private-beta gate. No hooks, so iOS/Android
 * bundles are completely unaffected — the real gate lives in BetaGate.web.tsx.
 */
export function BetaGate({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
