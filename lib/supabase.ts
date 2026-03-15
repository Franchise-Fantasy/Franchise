import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";
import { Database } from "../types/database.types";

// Check if we are running in a 'browser' or 'mobile' environment
// During 'expo export', this will effectively be false for the Node process
const isClient = typeof window !== "undefined" || Platform.OS !== "web";

export const supabase = createClient<Database>(
  process.env.EXPO_PUBLIC_SUPABASE_URL || "",
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "",
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
