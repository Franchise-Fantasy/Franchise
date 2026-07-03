import React from "react";

// Native no-op. The desktop web shell (sidebar navigation + content framing)
// is web-only — see WebShell.web.tsx, which metro resolves on web. This variant
// carries no hooks or logic, so the iOS/Android render tree is untouched.
export function WebShell({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
