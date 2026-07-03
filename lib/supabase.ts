import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";

import { Database } from "../types/database.types";

const isWeb = Platform.OS === "web";
// The Node static-export/prerender pass runs as web with no window — guard so we
// don't touch localStorage or try to parse a session URL there.
const hasWindow = typeof window !== "undefined";

export const supabase = createClient<Database>(
  process.env.EXPO_PUBLIC_SUPABASE_URL || "",
  process.env.EXPO_PUBLIC_SB_PUBLISHABLE_KEY || "",
  {
    auth: {
      // Native persists the session in AsyncStorage; the browser uses
      // localStorage (so reloads stay logged in). No storage during the
      // windowless export pass.
      storage: isWeb ? (hasWindow ? window.localStorage : undefined) : AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      // Google/Apple web OAuth redirect back with the session in the URL;
      // supabase-js must parse it. Native handles auth via deep links instead,
      // so it stays off there (unchanged behavior).
      detectSessionInUrl: isWeb && hasWindow,
      // PKCE for the web redirect flow only. Native is left on its existing
      // (implicit) flow so the deep-link recovery parser keeps working.
      ...(isWeb ? { flowType: "pkce" as const } : {}),
    },
  },
);

// Monotonic counter guarantees uniqueness even when Date.now() + Math.random()
// somehow collide within the same tick.
let channelCounter = 0;

/**
 * Builds a globally-unique realtime channel topic for `postgres_changes`/`presence`
 * subscriptions created inside React effects. Required because
 * `supabase.channel(topic)` returns an EXISTING channel if one with the same
 * topic is still in `realtime.channels` — which happens during fast remounts
 * (notification taps, auth refresh, concurrent renders) since `removeChannel`
 * is async. The old channel is still in `joined` state, so the next `.on()`
 * throws `cannot add 'postgres_changes' callbacks ... after subscribe()`.
 *
 * `Date.now()` alone (the prior convention) has ms resolution which is too
 * coarse for React render bursts. Combine with a counter + Math.random for
 * true uniqueness.
 *
 * Do NOT use this for broadcast or shared-presence channels — those need
 * deterministic names so peers can match. See `app/lottery-room.tsx` and
 * `hooks/chat/useReadReceipts.ts` for the exempt cases.
 */
export function uniqueChannelTopic(base: string): string {
  channelCounter = (channelCounter + 1) >>> 0;
  return `${base}-${Date.now()}-${channelCounter}-${Math.random().toString(36).slice(2, 8)}`;
}
