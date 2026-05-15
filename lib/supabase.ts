import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";

import { Database } from "../types/database.types";

// Check if we are running in a 'browser' or 'mobile' environment
// During 'expo export', this will effectively be false for the Node process
const isClient = typeof window !== "undefined" || Platform.OS !== "web";

export const supabase = createClient<Database>(
  process.env.EXPO_PUBLIC_SUPABASE_URL || "",
  process.env.EXPO_PUBLIC_SB_PUBLISHABLE_KEY || "",
  {
    auth: {
      // Only assign AsyncStorage if we are on the client
      storage: isClient ? AsyncStorage : undefined,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
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
