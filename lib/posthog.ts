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
