import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { useLatestAnnouncement } from '@/hooks/useAnnouncements';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useDismissals } from '@/hooks/useDismissals';
import { ms, s } from '@/utils/scale';

export function AnnouncementBanner() {
  const { leagueId } = useAppState();
  const scheme = useColorScheme() ?? 'light';
  const router = useRouter();
  const { data: latest } = useLatestAnnouncement(leagueId ?? null);
  const { ready, isDismissed, dismiss } = useDismissals();
  const insets = useSafeAreaInsets();

  const shown = !!latest && ready && !isDismissed('announcement', latest.id);

  const handleDismiss = useCallback(() => {
    if (!latest?.id) return;
    dismiss('announcement', latest.id);
  }, [latest?.id, dismiss]);

  // Auto-dismiss after 8 seconds
  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => {
      handleDismiss();
    }, 8000);
    return () => clearTimeout(timer);
  }, [shown, handleDismiss]);

  // Don't render if no announcement, already dismissed, or the seen-set is
  // still loading — showing early would flash a banner the user killed days ago.
  if (!latest || !shown) return null;

  const c = Colors[scheme];

  return (
    <View style={[styles.container, { top: insets.top, backgroundColor: c.card, borderBottomColor: c.warning }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Ionicons name="megaphone" size={16} color={c.warning} style={styles.icon} accessible={false} />
      <TouchableOpacity style={styles.textWrap} onPress={() => router.push('/league-info')} accessibilityRole="link" accessibilityLabel={`Announcement: ${latest.content}. Tap for details`}>
        <Text style={[styles.text, { color: c.text }]} numberOfLines={2}>
          {latest.content}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={handleDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Dismiss announcement">
        <Ionicons name="close" size={18} color={c.secondaryText} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 999,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: s(14),
    paddingVertical: s(12),
    borderBottomWidth: 2,
  },
  icon: { marginRight: s(8) },
  textWrap: { flex: 1 },
  text: { fontSize: ms(13), fontWeight: '600' },
});
