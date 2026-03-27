import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type ToastType = 'success' | 'error' | 'info';

interface ToastProps {
  type: ToastType;
  message: string;
  duration: number;
  onDismiss: () => void;
}

const ICON: Record<ToastType, keyof typeof Ionicons.glyphMap> = {
  success: 'checkmark-circle',
  error: 'alert-circle',
  info: 'information-circle',
};

export function Toast({ type, message, duration, onDismiss }: ToastProps) {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const BG: Record<ToastType, string> = {
    success: c.success,
    error: c.danger,
    info: c.link,
  };

  useEffect(() => {
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [duration, onDismiss]);

  return (
    <Animated.View
      entering={FadeInUp.duration(250)}
      exiting={FadeOutUp.duration(200)}
      style={[styles.container, { top: insets.top + 8 }]}
      pointerEvents="box-none"
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      accessibilityLabel={`${type}: ${message}`}
    >
      <View style={[styles.pill, { backgroundColor: BG[type] }]}>
        <Ionicons name={ICON[type]} size={18} color={c.statusText} style={styles.icon} />
        <Text style={[styles.text, { color: c.statusText }]} numberOfLines={2}>{message}</Text>
        <TouchableOpacity
          onPress={onDismiss}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Dismiss notification"
        >
          <Ionicons name="close" size={16} color={c.statusText} style={{ opacity: 0.8 }} />
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 9999,
    alignItems: 'center',
    pointerEvents: 'box-none',
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
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
    maxWidth: 500,
    width: '92%',
  },
  icon: { marginRight: 8 },
  text: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
});
