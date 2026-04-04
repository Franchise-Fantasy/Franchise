import { useAppState } from '@/context/AppStateProvider';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLatestAnnouncement } from '@/hooks/useAnnouncements';
import { ms, s } from '@/utils/scale';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const DISMISSED_KEY = '@dismissed_announcements';

async function getDismissedIds(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(DISMISSED_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function dismissAnnouncement(id: string): Promise<void> {
  const ids = await getDismissedIds();
  // Keep only last 20 to prevent unbounded growth
  const updated = [...ids.slice(-19), id];
  await AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify(updated));
}

export function AnnouncementBanner() {
  const { leagueId } = useAppState();
  const scheme = useColorScheme() ?? 'light';
  const router = useRouter();
  const { data: latest } = useLatestAnnouncement(leagueId ?? null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [checkedId, setCheckedId] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  // Check if latest announcement has been dismissed
  useEffect(() => {
    if (!latest?.id) return;
    if (latest.id === checkedId) return; // already checked this one
    let cancelled = false;
    getDismissedIds().then((ids) => {
      if (cancelled) return;
      setCheckedId(latest.id);
      if (ids.includes(latest.id)) {
        setDismissed(latest.id);
      } else {
        setDismissed(null);
      }
    });
    return () => { cancelled = true; };
  }, [latest?.id, checkedId]);

  const handleDismiss = useCallback(async () => {
    if (!latest?.id) return;
    setDismissed(latest.id);
    await dismissAnnouncement(latest.id);
  }, [latest?.id]);

  // Auto-dismiss after 8 seconds
  useEffect(() => {
    if (!latest?.id || dismissed === latest.id || checkedId !== latest.id) return;
    const timer = setTimeout(() => {
      handleDismiss();
    }, 8000);
    return () => clearTimeout(timer);
  }, [latest?.id, dismissed, checkedId, handleDismiss]);

  // Don't render if no announcement, already dismissed, or still checking
  if (!latest || dismissed === latest.id || checkedId !== latest.id) return null;

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
