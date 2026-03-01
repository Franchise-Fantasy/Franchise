import { useAppState } from '@/context/AppStateProvider';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLatestAnnouncement } from '@/hooks/useAnnouncements';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

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

  const bgColor = scheme === 'dark' ? '#3D3520' : '#FFF3CD';
  const textColor = scheme === 'dark' ? '#FFD866' : '#856404';

  return (
    <View style={styles.container} pointerEvents="box-none">
      <View style={[styles.toast, { backgroundColor: bgColor }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
        <Ionicons name="megaphone" size={16} color={textColor} style={styles.icon} accessible={false} />
        <TouchableOpacity style={styles.textWrap} onPress={() => router.push('/league-info')} accessibilityRole="link" accessibilityLabel={`Announcement: ${latest.content}. Tap for details`}>
          <Text style={[styles.text, { color: textColor }]} numberOfLines={2}>
            {latest.content}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Dismiss announcement">
          <Ionicons name="close" size={18} color={textColor} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 90, // above tab bar
    left: 0,
    right: 0,
    zIndex: 999,
    alignItems: 'center',
    pointerEvents: 'box-none',
  },
  toast: {
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
    maxWidth: 500,
    width: '92%',
  },
  icon: { marginRight: 8 },
  textWrap: { flex: 1 },
  text: { fontSize: 13, fontWeight: '600' },
});
