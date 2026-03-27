import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { Ionicons } from '@expo/vector-icons';
import { useNetInfo } from '@react-native-community/netinfo';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

export function OfflineBanner() {
  const { isConnected } = useNetInfo();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  // null means unknown (still loading), don't show banner
  if (isConnected !== false) return null;

  return (
    <View style={styles.container} pointerEvents="none">
      <Animated.View
        entering={FadeIn.duration(250)}
        exiting={FadeOut.duration(200)}
        style={[styles.pill, { backgroundColor: c.danger }]}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
      >
        <Ionicons name="cloud-offline-outline" size={14} color={c.statusText} style={styles.icon} />
        <Text style={[styles.text, { color: c.statusText }]}>No internet connection</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 90,
    left: 0,
    right: 0,
    zIndex: 998,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginHorizontal: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
  },
  icon: { marginRight: 8 },
  text: {
    fontSize: 13,
    fontWeight: '600',
  },
});
