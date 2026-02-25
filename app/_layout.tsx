import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import * as Updates from 'expo-updates';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

// Sentry requires a custom dev build (not Expo Go). Initialize it only in production.
// After running `eas build`, uncomment these lines:
// import * as Sentry from '@sentry/react-native';
// Sentry.init({ dsn: process.env.EXPO_PUBLIC_SENTRY_DSN });

// Show foreground alerts for high-priority channels; suppress others.
const FOREGROUND_CHANNELS = ['draft', 'trades', 'playoffs', 'commissioner'];

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const channelId =
      (notification.request.content.data as any)?.channelId ??
      (notification.request.trigger as any)?.channelId;
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

import { OfflineBanner } from '@/components/OfflineBanner';
import { AppStateProvider } from '@/context/AppStateProvider';
import { AuthProvider } from '@/context/AuthProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Alert, AppState } from 'react-native';

// Single stable instance for the lifetime of the app
const queryClient = new QueryClient();

// Tell React Query to treat app foreground as a focus event
// so refetchOnWindowFocus works correctly in React Native
focusManager.setEventListener((handleFocus) => {
  const sub = AppState.addEventListener('change', (state) => {
    handleFocus(state === 'active');
  });
  return () => sub.remove();
});

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const [loaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  // Check for OTA updates when the app launches
  useEffect(() => {
    (async () => {
      try {
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) {
          Alert.alert('Update Available', 'A new version is ready to install.', [
            { text: 'Later' },
            {
              text: 'Install',
              onPress: async () => {
                await Updates.fetchUpdateAsync();
                await Updates.reloadAsync();
              },
            },
          ]);
        }
      } catch {
        // No-op: Updates API throws in dev / Expo Go
      }
    })();
  }, []);

  // Navigate to the relevant screen when user taps a notification
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, string> | undefined;
      if (!data?.screen) return;

      const routes: Record<string, string> = {
        roster: '/(tabs)/roster',
        matchup: '/(tabs)/matchup',
        'free-agents': '/(tabs)/free-agents',
        trades: '/trades',
        'playoff-bracket': '/playoff-bracket',
        scoreboard: '/scoreboard',
        'league-info': '/league-info',
        activity: '/activity',
      };

      if (data.screen === 'draft-room' && data.draft_id) {
        router.push(`/draft-room/${data.draft_id}` as any);
      } else if (routes[data.screen]) {
        router.push(routes[data.screen] as any);
      }
    });
    return () => sub.remove();
  }, [router]);

  if (!loaded) {
    // Async font loading only occurs in development.
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AuthProvider>
          <AppStateProvider>
            <OfflineBanner />
            <Stack>
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="(tabs)" options={{ headerShown: false, gestureEnabled: false, animation: 'fade' }} />
              <Stack.Screen name="(setup)" options={{ headerShown: false, animation: 'fade' }} />
              <Stack.Screen name="draft-room/[id]" options={{ headerShown: false }} />
              <Stack.Screen name="trades" options={{ headerShown: false }} />
              <Stack.Screen name="activity" options={{ headerShown: false }} />
              <Stack.Screen name="scoreboard" options={{ headerShown: false }} />
              <Stack.Screen name="league-info" options={{ headerShown: false }} />
              <Stack.Screen name="playoff-bracket" options={{ headerShown: false }} />
              <Stack.Screen name="lottery-room" options={{ headerShown: false }} />
              <Stack.Screen name="chat" options={{ headerShown: false }} />
              <Stack.Screen name="chat/[id]" options={{ headerShown: false }} />
              <Stack.Screen name="team-roster/[id]" options={{ headerShown: false }} />
              <Stack.Screen name="create-league" options={{ headerShown: false }} />
              <Stack.Screen name="create-team" options={{ headerShown: false }} />
              <Stack.Screen name="join-league" options={{ headerShown: false }} />
              <Stack.Screen name="notification-settings" options={{ headerShown: false }} />
              <Stack.Screen name="auth" options={{ headerShown: false }} />
              <Stack.Screen name="reset-password" options={{ headerShown: false }} />
              <Stack.Screen name="legal" options={{ headerShown: false }} />
              <Stack.Screen name="+not-found" />
            </Stack>
          </AppStateProvider>
          <StatusBar style="auto" />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
