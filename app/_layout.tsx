import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

// Suppress notification banners when the app is in the foreground.
// The OS will show them normally when the app is backgrounded or closed.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false,
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

import { AppStateProvider } from '@/context/AppStateProvider';
import { AuthProvider } from '@/context/AuthProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { AppState } from 'react-native';

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
  const [loaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  if (!loaded) {
    // Async font loading only occurs in development.
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AuthProvider>
          <AppStateProvider>
            <Stack>
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="(tabs)" options={{ headerShown: false, gestureEnabled: false, animation: 'fade' }} />
              <Stack.Screen name="(setup)" options={{ headerShown: false, animation: 'fade' }} />
              <Stack.Screen name="draft-room/[id]" options={{ headerShown: false }} />
              <Stack.Screen name="trades" options={{ headerShown: false }} />
              <Stack.Screen name="activity" options={{ headerShown: false }} />
              <Stack.Screen name="scoreboard" options={{ headerShown: false }} />
              <Stack.Screen name="league-info" options={{ headerShown: false }} />
              <Stack.Screen name="team-roster/[id]" options={{ headerShown: false }} />
              <Stack.Screen name="create-league" options={{ headerShown: false }} />
              <Stack.Screen name="create-team" options={{ headerShown: false }} />
              <Stack.Screen name="join-league" options={{ headerShown: false }} />
              <Stack.Screen name="auth" options={{ headerShown: false }} />
              <Stack.Screen name="+not-found" />
            </Stack>
          </AppStateProvider>
          <StatusBar style="auto" />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
