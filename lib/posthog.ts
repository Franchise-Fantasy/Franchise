import PostHog from "posthog-react-native";

import { isExpoGo } from "@/utils/buildConfig";

export const posthog = new PostHog(
  process.env.EXPO_PUBLIC_POSTHOG_KEY || "",
  {
    host: process.env.EXPO_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
    captureAppLifecycleEvents: !isExpoGo,
    // Disable all tracking in Expo Go to keep dev sessions out of analytics
    disabled: isExpoGo,
  },
);

// User IDs that should be excluded from analytics (admins, testers).
// PostHog will still receive identify() calls but events are dropped client-side.
const ADMIN_USER_IDS: ReadonlySet<string> = new Set(
  (process.env.EXPO_PUBLIC_POSTHOG_ADMIN_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);

let _isAdmin = false;

/** Call once after auth to flag the current session as admin. */
export function setPostHogAdmin(userId: string | null) {
  _isAdmin = !!userId && ADMIN_USER_IDS.has(userId);
}

/** Capture an event, silently skipping admin users. */
export function capture(
  event: string,
  properties?: Record<string, unknown>,
) {
  if (_isAdmin) return;
  posthog.capture(event, properties as Record<string, string | number | boolean | null> | undefined);
}
