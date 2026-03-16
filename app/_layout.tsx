import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { useFonts } from "expo-font";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Updates from "expo-updates";
import "react-native-reanimated";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { isExpoGo } from "@/utils/buildConfig";

// Keep the native splash screen visible until we explicitly hide it.
SplashScreen.preventAutoHideAsync();

// Sentry requires native modules — only initialize in TestFlight / production builds.
if (!isExpoGo) {
  try {
    const Sentry = require("@sentry/react-native");
    if (process.env.EXPO_PUBLIC_SENTRY_DSN) {
      Sentry.init({ dsn: process.env.EXPO_PUBLIC_SENTRY_DSN });
    }
  } catch {
    // Sentry native module not available — skip silently
  }
}

// Show foreground alerts for high-priority channels; suppress others.
import { isDraftRoomOpen } from "@/lib/activeScreen";

const FOREGROUND_CHANNELS = ["draft", "trades", "playoffs", "commissioner"];

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const channelId =
      (notification.request.content.data as any)?.channelId ??
      (notification.request.trigger as any)?.channelId;

    // Don't show draft alerts when the user is already in the draft room
    if (channelId === "draft" && isDraftRoomOpen()) {
      return {
        shouldShowAlert: false,
        shouldShowBanner: false,
        shouldShowList: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
      };
    }

    const show = FOREGROUND_CHANNELS.includes(channelId);
    return {
      shouldShowAlert: show,
      shouldShowBanner: show,
      shouldShowList: true,
      shouldPlaySound: show,
      shouldSetBadge: false,
    };
  },
});

import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { OfflineBanner } from "@/components/OfflineBanner";
import { AppStateProvider, useAppState } from "@/context/AppStateProvider";
import { AuthProvider, useAuthInitialized, useSession } from "@/context/AuthProvider";
import { globalToastRef, ToastProvider } from "@/context/ToastProvider";
import { useColorScheme } from "@/hooks/useColorScheme";
import { posthog } from "@/lib/posthog";
import { supabase } from "@/lib/supabase";
import NetInfo from "@react-native-community/netinfo";
import {
  focusManager,
  MutationCache,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { usePathname, useRouter } from "expo-router";
import {
  PostHogProvider,
  PostHogSurveyProvider,
  usePostHog,
} from "posthog-react-native";
import { useEffect } from "react";
import { Alert, AppState } from "react-native";

// Sync React Query's online state with actual device connectivity
onlineManager.setEventListener((setOnline) => {
  return NetInfo.addEventListener((state) => {
    setOnline(!!state.isConnected);
  });
});

// Single stable instance for the lifetime of the app
const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      // Mutations with their own onError handle feedback themselves
      if (mutation.options.onError) return;
      globalToastRef.current?.(
        "error",
        (error as Error).message || "Something went wrong",
      );
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 min
      gcTime: 10 * 60 * 1000, // 10 min
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
    },
    mutations: {
      retry: 1,
    },
  },
});

// Tell React Query to treat app foreground as a focus event
// so refetchOnWindowFocus works correctly in React Native
focusManager.setEventListener((handleFocus) => {
  const sub = AppState.addEventListener("change", (state) => {
    handleFocus(state === "active");
  });
  return () => sub.remove();
});

const NOTIF_ROUTES: Record<string, string> = {
  home: "/(tabs)/matchup",
  roster: "/(tabs)/roster",
  matchup: "/(tabs)/matchup",
  "free-agents": "/(tabs)/free-agents",
  trades: "/trades",
  "playoff-bracket": "/playoff-bracket",
  scoreboard: "/scoreboard",
  "league-info": "/league-info",
  activity: "/activity",
  chat: "/chat",
  "lottery-room": "/lottery-room",
};

/** Switch league/team context when a league_id is provided via notification or deep link. */
async function switchLeagueContext(
  leagueId: string,
  userId: string,
  switchLeague: (leagueId: string, teamId: string) => void,
) {
  const { data: team } = await supabase
    .from("teams")
    .select("id, league_id")
    .eq("user_id", userId)
    .eq("league_id", leagueId)
    .maybeSingle();
  if (team) {
    switchLeague(team.league_id, team.id);
    queryClient.removeQueries({
      predicate: (q: { queryKey: readonly unknown[] }) => {
        const key = q.queryKey[0];
        return key !== "user-leagues" && key !== "userProfile";
      },
    });
  }
}

/** Keep the native splash visible until auth + app state are resolved. */
function SplashGate() {
  const authReady = useAuthInitialized();
  const { loading } = useAppState();

  useEffect(() => {
    if (authReady && !loading) {
      SplashScreen.hideAsync();
    }
  }, [authReady, loading]);

  return null;
}

/** Identify users and set league/team context as super properties. */
function PostHogIdentifier() {
  const ph = usePostHog();
  const session = useSession();
  const { leagueId, teamId } = useAppState();

  useEffect(() => {
    if (session?.user) {
      ph.identify(session.user.id, { email: session.user.email ?? null });
    } else {
      ph.reset();
    }
  }, [session?.user?.id]);

  useEffect(() => {
    if (leagueId || teamId) {
      ph.register({ league_id: leagueId, team_id: teamId });
    }
  }, [leagueId, teamId]);

  return null;
}

/** Track screen views using Expo Router's pathname (PostHog autocapture is incompatible with Expo Router). */
function ScreenTracker() {
  const ph = usePostHog();
  const pathname = usePathname();

  useEffect(() => {
    if (pathname) {
      ph.screen(pathname);
    }
  }, [pathname]);

  return null;
}

function NotificationAndLinkHandler() {
  const router = useRouter();
  const session = useSession();
  const { switchLeague } = useAppState();

  // Handle notification taps → navigate + switch context
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(
      async (response) => {
        const data = response.notification.request.content.data as
          | Record<string, string>
          | undefined;
        if (!data?.screen) return;

        if (data.league_id && session?.user) {
          await switchLeagueContext(
            data.league_id,
            session.user.id,
            switchLeague,
          );
        }

        if (data.screen === "draft-room" && data.draft_id) {
          router.navigate(`/draft-room/${data.draft_id}` as any);
        } else if (data.screen.startsWith("chat/")) {
          const conversationId = data.screen.split("/")[1];
          if (conversationId) {
            router.navigate(`/chat/${conversationId}` as any);
          }
        } else if (NOTIF_ROUTES[data.screen]) {
          router.navigate(NOTIF_ROUTES[data.screen] as any);
        }
      },
    );
    return () => sub.remove();
  }, [router, session?.user, switchLeague]);

  // Handle deep link URLs:
  // 1. Password recovery: extract tokens from # fragment before Expo Router strips it
  // 2. League context: switch league if ?league_id= is present
  useEffect(() => {
    function handleUrl({ url }: { url: string }) {
      // Password recovery: Supabase redirects with #access_token=...&type=recovery
      const fragment = url.split("#")[1];
      if (fragment) {
        const params = new URLSearchParams(fragment);
        if (params.get("type") === "recovery") {
          const accessToken = params.get("access_token");
          const refreshToken = params.get("refresh_token");
          if (accessToken && refreshToken) {
            supabase.auth
              .setSession({ access_token: accessToken, refresh_token: refreshToken })
              .then(({ error }) => {
                if (error) {
                  Alert.alert("Session error", error.message);
                } else {
                  router.replace("/reset-password");
                }
              });
            return;
          }
        }
      }

      if (!session?.user) return;
      const parsed = Linking.parse(url);

      // Invite deep link: franchisev2://join?code=ABCD1234
      const inviteCode = parsed.queryParams?.code;
      if (parsed.hostname === "join" && typeof inviteCode === "string") {
        router.replace({ pathname: "/join-league", params: { code: inviteCode } });
        return;
      }

      const leagueId = parsed.queryParams?.league_id;
      if (typeof leagueId === "string") {
        switchLeagueContext(leagueId, session.user.id, switchLeague);
      }
    }

    // URL that launched the app (cold start)
    Linking.getInitialURL().then((url) => {
      if (url) handleUrl({ url });
    });

    // URLs received while the app is already open
    const sub = Linking.addEventListener("url", handleUrl);
    return () => sub.remove();
  }, [session?.user, switchLeague]);

  return null;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [loaded] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });

  // Check for OTA updates when the app launches (only in TestFlight / production)
  useEffect(() => {
    if (isExpoGo) return;
    (async () => {
      try {
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) {
          Alert.alert(
            "Update Available",
            "A new version is ready to install.",
            [
              { text: "Later" },
              {
                text: "Install",
                onPress: async () => {
                  await Updates.fetchUpdateAsync();
                  await Updates.reloadAsync();
                },
              },
            ],
          );
        }
      } catch {
        // No-op in case Updates API isn't available
      }
    })();
  }, []);

  if (!loaded) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <PostHogProvider
      client={posthog}
      autocapture={{ captureScreens: false, captureTouches: false }}
    >
      <PostHogSurveyProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider
            value={colorScheme === "dark" ? DarkTheme : DefaultTheme}
          >
            <ToastProvider>
              <AuthProvider>
                <AppStateProvider>
                  <SplashGate />
                  <PostHogIdentifier />
                  <ScreenTracker />
                  <NotificationAndLinkHandler />
                  <OfflineBanner />
                  <AnnouncementBanner />
                  <Stack>
                    <Stack.Screen
                      name="index"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="(tabs)"
                      options={{
                        headerShown: false,
                        gestureEnabled: false,
                        animation: "fade",
                      }}
                    />
                    <Stack.Screen
                      name="(setup)"
                      options={{ headerShown: false, animation: "fade" }}
                    />
                    <Stack.Screen
                      name="draft-room/[id]"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="trades"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="activity"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="scoreboard"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="analytics"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="matchup-detail/[id]"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="import-league"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="league-info"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="draft-hub"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="playoff-bracket"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="lottery-room"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="chat"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="chat/[id]"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="team-roster/[id]"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="league-history"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="create-league"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="create-team"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="join-league"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="notification-settings"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="auth"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="reset-password"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="legal"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen name="+not-found" />
                  </Stack>
                </AppStateProvider>
                <StatusBar style="auto" />
              </AuthProvider>
            </ToastProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </PostHogSurveyProvider>
    </PostHogProvider>
    </GestureHandlerRootView>
  );
}
