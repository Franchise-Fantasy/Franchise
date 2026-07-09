import { AlfaSlabOne_400Regular } from "@expo-google-fonts/alfa-slab-one";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import {
  Oswald_500Medium,
  Oswald_700Bold,
} from "@expo-google-fonts/oswald";
import NetInfo from "@react-native-community/netinfo";
import {
  focusManager,
  MutationCache,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import Constants from "expo-constants";
import { useFonts } from "expo-font";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider,
  usePathname,
  useRouter,
} from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as Updates from "expo-updates";
import {
  PostHogProvider,
  PostHogSurveyProvider,
  usePostHog,
} from "posthog-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Animated, AppState, Easing, Platform, StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";


import { AnnouncementBanner } from "@/components/banners/AnnouncementBanner";
import { MatchupResultModal } from "@/components/banners/MatchupResultModal";
import { OfflineBanner } from "@/components/banners/OfflineBanner";
import { ForceUpdateScreen } from "@/components/ForceUpdateScreen";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { WebShell } from "@/components/web/WebShell";
import { Colors } from "@/constants/Colors";
import { AppStateProvider, useAppState } from "@/context/AppStateProvider";
import {
  AuthProvider,
  useAuthInitialized,
  useSession,
} from "@/context/AuthProvider";
import { CompareSelectionProvider } from "@/context/CompareSelectionProvider";
import { ConfirmProvider, useConfirm } from "@/context/ConfirmProvider";
import { globalToastRef, ToastProvider } from "@/context/ToastProvider";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useSeasonConfig } from "@/hooks/useSeasonConfig";
import { isDraftRoomOpen } from "@/lib/activeScreen";
import { setPendingDeepLink } from "@/lib/pendingNav";
import { posthog, setPostHogAdmin } from "@/lib/posthog";
import { registerSplashReadyHandler } from "@/lib/splashReady";
import { supabase } from "@/lib/supabase";
import { isExpoGo } from "@/utils/buildConfig";
import { KeyboardProvider } from "@/utils/keyboardController";
import { logger } from "@/utils/logger";

// Keep the native splash screen visible until we explicitly hide it.
SplashScreen.preventAutoHideAsync();

// Compare two dot-separated semver-ish strings ("1.2.3" vs "1.2.10"). Returns
// negative if a < b, 0 if equal, positive if a > b. Inline because we only
// need numeric comparison — no prerelease handling, no need for the full
// `semver` package.
function compareVersions(a: string, b: string): number {
  const aParts = a.split('.').map((n) => parseInt(n, 10) || 0);
  const bParts = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const av = aParts[i] ?? 0;
    const bv = bParts[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

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
  home: "/(tabs)", // the index tab (home hero) — NOT matchup; lifecycle pushes
  // (draft scheduled, advance-season, create-rookie-draft, finalize-keepers)
  // all use screen:'home' to land on the hero. Matchup-intent uses `matchup`.
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
  news: "/news",
};

/**
 * On launch: surface any error expo-updates logged on the PREVIOUS run, then
 * check for / download an update and offer to install it (reloadAsync).
 *
 * The error surfacing is deliberate instrumentation. Update-apply failures used
 * to roll back invisibly (expo-updates' ErrorRecovery aborts the process and
 * the next launch quietly runs the embedded bundle), so a broken update looked
 * like a random crash. Reading the prior run's log entries and toasting any
 * error/fatal makes the real cause visible on-device instead of needing a
 * TestFlight crash log every time.
 *
 * Root cause found for the update-apply crashes: SDK 56 turns ON bsdiff bundle
 * patching by default (`enableBsdiffPatchSupport`), delivering the JS bundle as
 * a binary diff against a prior download. A bad patch yields corrupt Hermes
 * bytecode that faults the instant modules install (`installExpoModulesHostObject`)
 * — which only ever touches OTA bundles, never the embedded one, matching the
 * "cold launch fine, update crashes, relaunch fine" pattern. Disabled in app.json.
 */
function OtaUpdateChecker() {
  const confirm = useConfirm();
  useEffect(() => {
    if (isExpoGo) return;
    (async () => {
      // Report any update error from the previous launch so rollbacks aren't silent.
      try {
        const logs = await Updates.readLogEntriesAsync(120_000);
        const failure = [...logs]
          .reverse()
          .find(
            (l) =>
              l.level === Updates.UpdatesLogEntryLevel.ERROR ||
              l.level === Updates.UpdatesLogEntryLevel.FATAL,
          );
        if (failure) {
          logger.warn("expo-updates error on previous launch", {
            code: failure.code,
            message: failure.message,
          });
          globalToastRef.current?.(
            "error",
            `Update error [${failure.code}]: ${failure.message}`.slice(0, 180),
          );
        }
      } catch {
        // Log API unavailable — ignore.
      }

      try {
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) {
          await Updates.fetchUpdateAsync();
          confirm({
            title: "Update Available",
            message: "A new version is ready to install.",
            cancelLabel: "Later",
            action: { label: "Install", onPress: () => Updates.reloadAsync() },
          });
        }
      } catch {
        // No-op if the Updates API isn't available.
      }
    })();
  }, [confirm]);
  return null;
}

/** Switch league/team context when a league_id is provided via notification or deep link.
 *  Returns true if the user has a team in the league (membership confirmed). */
async function switchLeagueContext(
  leagueId: string,
  userId: string,
  switchLeague: (leagueId: string, teamId: string) => void,
): Promise<boolean> {
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
    return true;
  }
  return false;
}

/**
 * Keep the native splash visible until:
 *   1. Auth state has resolved
 *   2. AppState has finished loading
 *   3. Either a signed-in user hasn't mounted the home screen yet, OR
 *      the home screen has called `markSplashReady()` — whichever comes
 *      first. Prevents the hero flashing an intermediate variant while
 *      downstream queries (activeDraft, playoff bracket, etc.) settle.
 *
 * Fallback: if nothing reports ready within `HOME_READY_TIMEOUT_MS` of
 * auth + app-state being done, we hide the splash anyway so a broken
 * query never strands the user on the splash indefinitely.
 */
const HOME_READY_TIMEOUT_MS = 3000;

// Minimum time the splash stays up regardless of how fast the app is ready.
// Without this the splash can vanish near-instantly on a warm cache, cutting
// off the breathing animation and exposing the home screen while downstream
// content is still painting in. A short floor lets at least one breath leg
// play and gives late-settling UI a moment to land before the fade.
const MIN_SPLASH_MS = 1600;

function SplashGate() {
  const authReady = useAuthInitialized();
  const { loading } = useAppState();
  const session = useSession();
  const [homeReady, setHomeReady] = useState(false);
  const [minElapsed, setMinElapsed] = useState(false);

  // Hold the splash for at least MIN_SPLASH_MS from first mount.
  useEffect(() => {
    const t = setTimeout(() => setMinElapsed(true), MIN_SPLASH_MS);
    return () => clearTimeout(t);
  }, []);

  // Signed-out users have no home data to wait on — skip the gate.
  const needsHomeData = !!session?.user;
  const canHide =
    authReady && !loading && (!needsHomeData || homeReady) && minElapsed;

  // Register the handler consumers (home screen) can call once their
  // queries resolve. Unregister on unmount so a stale setter can't fire.
  useEffect(() => {
    return registerSplashReadyHandler(() => setHomeReady(true));
  }, []);

  // Reset home-ready when the session changes — a fresh sign-in should
  // re-arm the gate so the new user's data gets the same treatment.
  useEffect(() => {
    setHomeReady(false);
  }, [session?.user?.id]);

  // Fallback only: the JS overlay normally hides the native splash early (on
  // its own onLayout) so it can breathe during the wait. This catches the edge
  // case where that never fires — hideAsync is idempotent, so a double-call is
  // a no-op.
  useEffect(() => {
    if (canHide) SplashScreen.hideAsync();
  }, [canHide]);

  // Safety net — hide the splash even if the home screen never reports in.
  useEffect(() => {
    if (authReady && !loading && needsHomeData && !homeReady) {
      const t = setTimeout(() => setHomeReady(true), HOME_READY_TIMEOUT_MS);
      return () => clearTimeout(t);
    }
  }, [authReady, loading, needsHomeData, homeReady]);

  return <SplashFadeOverlay visible={!canHide} />;
}

/**
 * JS-side splash overlay that takes over from the native splash and breathes
 * the F patch while the app boots, then fades out to reveal the home screen.
 *
 * Seamless hand-off: the native splash (expo-splash-screen in app.json) shows a
 * still F patch on the turf-green bg. This overlay renders the SAME patch on the
 * SAME bg, and we hide the native splash only once this overlay has painted an
 * identical still frame (`onLayout`) — so the swap is still-frame → still-frame
 * with no pop. The patch then begins breathing, and the whole overlay stays
 * opaque (covering any intermediate app state) until `canHide`, when it fades.
 *
 * Kept in lockstep with app.json's expo-splash-screen config:
 *   - same artwork — native points at F_patch@3x.png (600px) so it downscales
 *     to imageWidth sharply instead of upscaling the 200px base and blurring;
 *     this overlay's require('F_patch.png') resolves to the same @3x asset.
 *     Same backgroundColor (#1B3D2F).
 *   - native `imageWidth` (216) === SPLASH_LOGO_WIDTH (200) × SPLASH_BREATH_MAX
 *     (1.08), because the hand-off frame is the breath's expanded extreme.
 * If any of those change here, change them there too.
 */
const SPLASH_BG = '#1B3D2F';
const SPLASH_LOGO_WIDTH = 200;
// F_patch source art is 200×188 — preserve that ratio so the patch never squashes.
const SPLASH_LOGO_ASPECT = 200 / 188;
const SPLASH_FADE_DURATION = 300;
// Breathing loop per the designer's SwiftUI spec: scale 1.0↔1.08, opacity
// 0.85↔1.0 (in sync), easeInOut, 1.8s per direction, repeating forever.
const SPLASH_BREATH_DURATION = 1800;
const SPLASH_BREATH_MAX = 1.08;

function SplashFadeOverlay({ visible }: { visible: boolean }) {
  const opacity = useRef(new Animated.Value(1)).current;
  // Start at the expanded/bright extreme (1) so the first painted frame matches
  // the native splash exactly; breathing eases away from it once it starts.
  const breath = useRef(new Animated.Value(1)).current;
  const [mounted, setMounted] = useState(true);
  const [breathing, setBreathing] = useState(false);
  const handedOff = useRef(false);

  // Hide the native splash the instant our identical still frame has laid out,
  // then start breathing. Guarded so it only fires once.
  const handleLayout = useCallback(() => {
    if (handedOff.current) return;
    handedOff.current = true;
    SplashScreen.hideAsync().finally(() => setBreathing(true));
  }, []);

  useEffect(() => {
    if (!visible && mounted) {
      Animated.timing(opacity, {
        toValue: 0,
        duration: SPLASH_FADE_DURATION,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, mounted, opacity]);

  // Breathe only after the native→JS hand-off, so the seam shows the matched
  // still frame (breath === 1) before any motion. First leg exhales (1→0).
  useEffect(() => {
    if (!breathing) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 0,
          duration: SPLASH_BREATH_DURATION,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 1,
          duration: SPLASH_BREATH_DURATION,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breathing, breath]);

  if (!mounted) return null;

  const scale = breath.interpolate({ inputRange: [0, 1], outputRange: [1, SPLASH_BREATH_MAX] });
  const breathOpacity = breath.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] });

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      onLayout={handleLayout}
      accessibilityLabel="Franchise, loading"
      accessibilityRole="progressbar"
      style={[StyleSheet.absoluteFill, splashStyles.overlay, { opacity }]}
    >
      <Animated.Image
        source={require('../assets/images/F_patch.png')}
        style={{
          width: SPLASH_LOGO_WIDTH,
          aspectRatio: SPLASH_LOGO_ASPECT,
          opacity: breathOpacity,
          transform: [{ scale }],
        }}
        resizeMode="contain"
      />
    </Animated.View>
  );
}

const splashStyles = StyleSheet.create({
  overlay: {
    backgroundColor: SPLASH_BG,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
});

/** Identify users and set league/team context as super properties. */
function PostHogIdentifier() {
  const ph = usePostHog();
  const session = useSession();
  const { leagueId, teamId } = useAppState();

  useEffect(() => {
    if (session?.user) {
      ph.identify(session.user.id, { email: session.user.email ?? null });
      setPostHogAdmin(session.user.id);
    } else {
      ph.reset();
      setPostHogAdmin(null);
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

// Hydrates the season-config cache (current season + opening-night dates) from
// the DB so the values can be updated without an app deploy. No-op render.
function SeasonConfigHydrator() {
  useSeasonConfig();
  return null;
}

function NotificationAndLinkHandler() {
  const router = useRouter();
  const session = useSession();
  const { switchLeague, loading } = useAppState();

  // Track loading state via ref so async callbacks see the latest value
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const pendingNavRef = useRef<(() => void) | null>(null);

  // When AppState finishes loading, fire any deferred navigation
  useEffect(() => {
    if (!loading && pendingNavRef.current) {
      pendingNavRef.current();
      pendingNavRef.current = null;
    }
  }, [loading]);

  // Track which notification response we've already handled so we don't
  // double-navigate from both getLastNotificationResponseAsync and the listener.
  const handledResponseIdRef = useRef<string | null>(null);

  const handleNotificationResponse = useCallback(
    async (response: Notifications.NotificationResponse) => {
      const responseId = response.notification.request.identifier;
      if (handledResponseIdRef.current === responseId) return;
      handledResponseIdRef.current = responseId;

      const data = response.notification.request.content.data as
        | Record<string, string>
        | undefined;
      if (!data?.screen) return;

      // Claim the launch navigation so the index screen's auth redirect
      // doesn't replace our target on cold start — both effects fire in the
      // same tick when AppState finishes loading. Released once we navigate.
      setPendingDeepLink(true);

      // A league-invite push targets a user who isn't a member yet, so the
      // membership switch would (correctly) fail and bail — skip it for the
      // claim flow, which handles a non-member landing on the league itself.
      if (data.screen !== "claim-team" && data.league_id && session?.user) {
        const ok = await switchLeagueContext(
          data.league_id,
          session.user.id,
          switchLeague,
        );
        if (!ok) {
          setPendingDeepLink(false);
          return; // user doesn't belong to this league
        }
      }

      const navigate = () => {
        const screen = data.screen!;
        let go: (() => void) | null = null;

        if (screen === "draft-room" && data.draft_id) {
          go = () => router.navigate(`/draft-room/${data.draft_id}` as any);
        } else if (screen.startsWith("chat/")) {
          const conversationId = screen.split("/")[1];
          if (conversationId) {
            go = () =>
              router.navigate({
                pathname: "/chat/[id]",
                params: data.message_id
                  ? { id: conversationId, messageId: data.message_id }
                  : { id: conversationId },
              } as any);
          }
        } else if (screen === "trades" && data.proposal_id) {
          go = () =>
            router.navigate({
              pathname: "/trades",
              params: { proposalId: data.proposal_id },
            } as any);
        } else if (screen === "matchup" && (data.matchupId || data.prompt_live_activity)) {
          // Direct-to-matchup deep link: pass matchupId so the matchup screen
          // snaps to the right week + selection, and prompt_live_activity so
          // it highlights the Go Live CTA (used by Sunday close-matchup pushes).
          const params: Record<string, string> = {};
          if (data.matchupId) params.matchupId = data.matchupId;
          if (data.prompt_live_activity) params.promptLiveActivity = data.prompt_live_activity;
          go = () =>
            router.navigate({
              pathname: "/(tabs)/matchup",
              params,
            } as any);
        } else if (screen === "claim-team" && data.league_id) {
          // League invite: route the (not-yet-member) invitee into the claim
          // flow to pick up the team the commissioner assigned them.
          go = () =>
            router.navigate({
              pathname: "/claim-team",
              params: { leagueId: data.league_id!, isCommissioner: "false" },
            } as any);
        } else if (NOTIF_ROUTES[screen]) {
          go = () => router.navigate(NOTIF_ROUTES[screen] as any);
        }

        if (!go) {
          // Nothing to navigate to — release the guard so the index screen
          // performs its normal redirect instead of stranding the user.
          if (__DEV__) {
            logger.warn(`Notification screen has no route mapping: ${screen}`);
          }
          setPendingDeepLink(false);
          return;
        }

        go();
        // Release on the next tick — after the same-tick index effect has
        // already seen the guard and bailed.
        setTimeout(() => setPendingDeepLink(false), 0);
      };

      // Defer navigation if AppState hasn't finished loading
      if (loadingRef.current) {
        pendingNavRef.current = navigate;
      } else {
        navigate();
      }
    },
    [router, session?.user, switchLeague],
  );

  // Cold-start: check if a notification response launched the app
  useEffect(() => {
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) handleNotificationResponse(response);
      })
      .catch((err) => {
        logger.warn("getLastNotificationResponseAsync failed", err);
      });
  }, [handleNotificationResponse]);

  // Handle notification taps while app is running
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(
      handleNotificationResponse,
    );
    return () => sub.remove();
  }, [handleNotificationResponse]);

  // Handle deep link URLs:
  // 1. Password recovery: extract tokens from # fragment before Expo Router strips it
  // 2. League context: switch league if ?league_id= is present
  useEffect(() => {
    function handleUrl({ url }: { url: string }) {
      // Password recovery: Supabase redirects with #access_token=...&type=recovery
      // This doesn't need AppState — handle immediately. Native only: on web,
      // supabase-js owns URL auth params (detectSessionInUrl consumes fragments
      // and PKCE recovery links arrive as ?code=), so this manual parser must
      // not race it.
      const fragment = Platform.OS !== "web" ? url.split("#")[1] : undefined;
      if (fragment) {
        const params = new URLSearchParams(fragment);
        if (params.get("type") === "recovery") {
          const accessToken = params.get("access_token");
          const refreshToken = params.get("refresh_token");
          if (accessToken && refreshToken) {
            supabase.auth
              .setSession({
                access_token: accessToken,
                refresh_token: refreshToken,
              })
              .then(({ error }) => {
                if (error) {
                  Alert.alert(
                    "Session error",
                    error.message ?? "Could not restore session.",
                  );
                } else {
                  router.replace("/reset-password");
                }
              })
              .catch((err) => {
                logger.warn("setSession (recovery) failed", err);
              });
            return;
          }
        }
      }

      if (!session?.user) return;
      const parsed = Linking.parse(url);

      // Invite deep link — doesn't need AppState
      const inviteCode = parsed.queryParams?.code;
      if (parsed.hostname === "join" && typeof inviteCode === "string") {
        router.replace({
          pathname: "/join-league",
          params: { code: inviteCode },
        });
        return;
      }

      const leagueId = parsed.queryParams?.league_id;
      if (typeof leagueId === "string") {
        switchLeagueContext(leagueId, session.user.id, switchLeague);
      }
    }

    // URL that launched the app (cold start)
    Linking.getInitialURL()
      .then((url) => {
        if (url) handleUrl({ url });
      })
      .catch((err) => {
        logger.warn("Linking.getInitialURL failed", err);
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
    AlfaSlabOne_400Regular,
    Oswald_500Medium,
    Oswald_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_700Bold,
  });


  // Forced-upgrade gate: query the public app_config table for the minimum
  // supported version. If the installed binary is below it, render
  // ForceUpdateScreen instead of the normal app — gives operators a "kill
  // old clients" lever before shipping a breaking schema/RPC change. Fails
  // open: any error (network, RLS, missing row) lets the app boot normally.
  const [forcedUpdate, setForcedUpdate] = useState<{ installed: string; minimum: string } | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const installed = Constants.expoConfig?.version ?? '0.0.0';
        const { data } = await supabase
          .from('app_config')
          .select('value')
          .eq('key', 'min_supported_version')
          .maybeSingle();
        const cfg = data?.value as { ios?: string; android?: string } | null;
        const platformKey: 'ios' | 'android' = Platform.OS === 'ios' ? 'ios' : 'android';
        const minimum = cfg?.[platformKey];
        if (!minimum) return;
        if (compareVersions(installed, minimum) < 0) {
          setForcedUpdate({ installed, minimum });
        }
      } catch (err) {
        logger.warn('min_supported_version check failed (failing open)', err);
      }
    })();
  }, []);

  if (!loaded) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: Colors[colorScheme ?? "dark"].background }}>
      <KeyboardProvider>
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
                    <ConfirmProvider>
                    <OtaUpdateChecker />
                    <PostHogIdentifier />
                    <ScreenTracker />
                    <SeasonConfigHydrator />
                    <NotificationAndLinkHandler />
                    <OfflineBanner />
                    <AnnouncementBanner />
                    <MatchupResultModal />
                    <ErrorBoundary>
                    <CompareSelectionProvider>
                    <WebShell>
                    {forcedUpdate ? (
                      <ForceUpdateScreen
                        installedVersion={forcedUpdate.installed}
                        minimumVersion={forcedUpdate.minimum}
                      />
                    ) : (
                    <Stack
                      screenOptions={{
                        contentStyle: {
                          backgroundColor:
                            Colors[colorScheme ?? "dark"].background,
                        },
                        animation: "slide_from_right",
                        gestureEnabled: true,
                        gestureDirection: "horizontal",
                      }}>
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
                        name="survey/[id]"
                        options={{ headerShown: false }}
                      />
                      <Stack.Screen
                        name="standings"
                        options={{ headerShown: false }}
                      />
                      <Stack.Screen
                        name="trades"
                        options={{ headerShown: false }}
                      />
                      <Stack.Screen
                        name="cms-test"
                        options={{ headerShown: false }}
                      />
                      <Stack.Screen
                        name="news"
                        options={{ headerShown: false }}
                      />
                      <Stack.Screen
                        name="schedule"
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
                        name="prospects"
                        options={{ headerShown: false }}
                      />
                      <Stack.Screen
                        name="prospect/[id]"
                        options={{ headerShown: false }}
                      />
                      <Stack.Screen
                        name="prospect-board"
                        options={{ headerShown: false }}
                      />
                      <Stack.Screen
                        name="playoff-bracket"
                        options={{ headerShown: false }}
                      />
                      <Stack.Screen
                        name="playoff-archive"
                        options={{ headerShown: false }}
                      />
                      <Stack.Screen
                        name="franchise/[id]"
                        options={{ headerShown: false }}
                      />
                      <Stack.Screen
                        name="playoff-archive-nhl"
                        options={{ headerShown: false }}
                      />
                      <Stack.Screen
                        name="playoff-archive-nfl"
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
                        name="claim-team"
                        options={{ headerShown: false }}
                      />
                      <Stack.Screen
                        name="add-league-history"
                        options={{ headerShown: false }}
                      />
                      <Stack.Screen
                        name="notification-settings"
                        options={{ headerShown: false }}
                      />
                      <Stack.Screen
                        name="blocked-users"
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
                      <Stack.Screen
                        name="player-compare"
                        options={{ headerShown: false }}
                      />
                      <Stack.Screen name="+not-found" />
                    </Stack>
                    )}
                    </WebShell>
                    </CompareSelectionProvider>
                    </ErrorBoundary>
                    {/* Splash overlay lives at the end so it renders on
                        top of the Stack — gives us the cross-fade from
                        native splash → JS UI without a hard cut. */}
                    <SplashGate />
                    </ConfirmProvider>
                  </AppStateProvider>
                  <StatusBar style="auto" />
                </AuthProvider>
              </ToastProvider>
            </ThemeProvider>
          </QueryClientProvider>
        </PostHogSurveyProvider>
      </PostHogProvider>
    </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
