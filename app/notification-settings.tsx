import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useState } from 'react';
import {
  AppState,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LeagueNotificationModal } from '@/components/banners/LeagueNotificationModal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Section } from '@/components/ui/Section';
import { ThemedText } from '@/components/ui/ThemedText';
import { ToggleRow } from '@/components/ui/ToggleRow';
import { Fonts } from '@/constants/Colors';
import { NOTIFICATION_GROUPS } from '@/constants/NotificationCategories';
import { useAppState } from '@/context/AppStateProvider';
import { useSession } from '@/context/AuthProvider';
import { useColors } from '@/hooks/useColors';
import { useLeague } from '@/hooks/useLeague';
import {
  DEFAULT_PREFERENCES,
  PushPreferences,
  getPushPrefs,
  setMuteAll,
  updatePreferences,
} from '@/lib/notifications';
import { logger } from '@/utils/logger';
import { ms, s } from '@/utils/scale';

type PresetKey = 'recommended' | 'everything' | 'essentials';

const ALL_KEYS = Object.keys(DEFAULT_PREFERENCES) as (keyof PushPreferences)[];

// The smallest set that still keeps you from losing your team: your pick, a
// trade aimed at you, waiver outcomes, and anything a commissioner does to you.
const ESSENTIALS: (keyof PushPreferences)[] = [
  'draft',
  'trades',
  'waivers',
  'playoffs',
  'commissioner',
  'direct_messages',
];

function buildPreset(preset: PresetKey): PushPreferences {
  if (preset === 'recommended') return { ...DEFAULT_PREFERENCES };
  const on = preset === 'everything';
  return ALL_KEYS.reduce(
    (acc, key) => ({ ...acc, [key]: on || ESSENTIALS.includes(key) }),
    {} as PushPreferences,
  );
}

export default function NotificationSettingsScreen() {
  const session = useSession();
  const c = useColors();
  const userId = session?.user?.id;
  const { leagueId } = useAppState();
  const { data: league } = useLeague();

  const [prefs, setPrefs] = useState<PushPreferences>(DEFAULT_PREFERENCES);
  const [muteAll, setMuteAllState] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showLeagueNotifs, setShowLeagueNotifs] = useState(false);
  const [osBlocked, setOsBlocked] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getPushPrefs(userId)
      .then(({ preferences, muteAll: muted }) => {
        if (cancelled) return;
        setPrefs(preferences);
        setMuteAllState(muted);
        setLoaded(true);
      })
      .catch((err) => {
        logger.warn('getPushPrefs failed', err);
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Every toggle on this screen is inert if notifications are denied at the OS
  // level, so check it here and re-check on foreground — the user leaves to iOS
  // Settings to fix it and comes back expecting the banner to be gone.
  const checkOsPermission = useCallback(async () => {
    if (Platform.OS === 'web') return;
    try {
      const { granted } = await Notifications.getPermissionsAsync();
      setOsBlocked(!granted);
    } catch {
      // Permission API unavailable (Expo Go edge cases) — assume fine rather
      // than showing a banner we can't substantiate.
      setOsBlocked(false);
    }
  }, []);

  useEffect(() => {
    checkOsPermission();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkOsPermission();
    });
    return () => sub.remove();
  }, [checkOsPermission]);

  function handleMuteAll(value: boolean) {
    if (!userId) return;
    setMuteAllState(value);
    setMuteAll(userId, value);
  }

  // A child category is gated by its parent server-side (PARENT_OF in
  // _shared/push.ts), so switching a parent off never writes to its children —
  // their own setting survives and comes back when the parent returns.
  function toggle(key: keyof PushPreferences) {
    return (value: boolean) => {
      if (!userId) return;
      setPrefs((prev) => ({ ...prev, [key]: value }));
      updatePreferences(userId, { [key]: value });
    };
  }

  function applyPreset(preset: PresetKey) {
    if (!userId) return;
    const next = buildPreset(preset);
    setPrefs(next);
    updatePreferences(userId, next);
  }

  if (!loaded)
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: c.background }]}
        edges={['top']}
      />
    );

  const dimmed = { opacity: muteAll ? 0.4 : 1 } as const;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: c.background }]}
      edges={['top']}
    >
      <PageHeader title="Notifications" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {osBlocked && (
          <TouchableOpacity
            style={[styles.banner, { backgroundColor: c.card, borderColor: c.danger }]}
            onPress={() =>
              Linking.openSettings().catch((err) =>
                logger.warn('openSettings failed', err),
              )
            }
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Notifications are turned off in system settings"
            accessibilityHint="Opens the system settings for this app"
          >
            <Ionicons
              name="notifications-off-outline"
              size={ms(18)}
              color={c.danger}
              accessible={false}
            />
            <View style={styles.bannerText}>
              <ThemedText style={[styles.bannerTitle, { color: c.text }]}>
                Notifications are off for Franchise
              </ThemedText>
              <ThemedText style={[styles.bannerBody, { color: c.secondaryText }]}>
                Nothing below will be delivered until you allow notifications in
                your device settings. Tap to open them.
              </ThemedText>
            </View>
            <Ionicons
              name="chevron-forward"
              size={ms(16)}
              color={c.secondaryText}
              accessible={false}
            />
          </TouchableOpacity>
        )}

        <Section title="Master">
          <ToggleRow
            icon="volume-mute-outline"
            label="Mute All Notifications"
            description="Silences every push notification across all leagues"
            value={muteAll}
            onToggle={handleMuteAll}
            c={c}
            last
          />
        </Section>

        {leagueId && league?.name && (
          <TouchableOpacity
            style={[
              styles.leagueRow,
              { backgroundColor: c.card, borderColor: c.gold },
            ]}
            onPress={() => setShowLeagueNotifs(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Customize notifications for ${league.name}`}
            accessibilityHint="Opens per-league settings that override the defaults below"
          >
            <View style={[styles.leagueIcon, { backgroundColor: c.goldMuted }]}>
              <Ionicons
                name="notifications-outline"
                size={ms(18)}
                color={c.gold}
                accessible={false}
              />
            </View>
            <View style={styles.leagueText}>
              <ThemedText
                type="varsitySmall"
                style={[styles.leagueEyebrow, { color: c.gold }]}
              >
                LEAGUE OVERRIDE
              </ThemedText>
              <ThemedText
                style={[styles.leagueName, { color: c.text }]}
                numberOfLines={1}
              >
                {league.name}
              </ThemedText>
              <ThemedText style={[styles.leagueSub, { color: c.secondaryText }]}>
                Override the defaults below for this league only
              </ThemedText>
            </View>
            <Ionicons
              name="chevron-forward"
              size={ms(16)}
              color={c.secondaryText}
              accessible={false}
            />
          </TouchableOpacity>
        )}

        <ThemedText
          type="varsitySmall"
          style={[styles.explainer, { color: c.secondaryText }]}
        >
          {muteAll
            ? 'ALL NOTIFICATIONS MUTED · TOGGLE OFF TO RE-ENABLE'
            : 'GLOBAL DEFAULTS · APPLY TO EVERY LEAGUE YOU’RE IN'}
        </ThemedText>

        <View style={dimmed} pointerEvents={muteAll ? 'none' : 'auto'}>
          <View style={styles.presetRow}>
            {(
              [
                { key: 'essentials', label: 'Essentials' },
                { key: 'recommended', label: 'Recommended' },
                { key: 'everything', label: 'Everything' },
              ] as { key: PresetKey; label: string }[]
            ).map((preset) => (
              <TouchableOpacity
                key={preset.key}
                style={[styles.presetChip, { borderColor: c.border, backgroundColor: c.card }]}
                onPress={() => applyPreset(preset.key)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Apply ${preset.label} notification preset`}
                accessibilityHint="Replaces all category settings below"
              >
                <ThemedText
                  type="varsitySmall"
                  style={[styles.presetLabel, { color: c.text }]}
                >
                  {preset.label.toUpperCase()}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </View>

          {NOTIFICATION_GROUPS.map((group) => (
            <Section key={group.title} title={group.title}>
              {group.categories.map((cat, idx) => (
                <ToggleRow
                  key={cat.key}
                  icon={cat.icon}
                  label={cat.label}
                  description={cat.description}
                  value={prefs[cat.key]}
                  onToggle={toggle(cat.key)}
                  disabled={!!cat.parentKey && !prefs[cat.parentKey]}
                  indented={!!cat.parentKey}
                  c={c}
                  last={idx === group.categories.length - 1}
                />
              ))}
            </Section>
          ))}
        </View>
      </ScrollView>

      {leagueId && userId && (
        <LeagueNotificationModal
          visible={showLeagueNotifs}
          onClose={() => setShowLeagueNotifs(false)}
          userId={userId}
          leagueId={leagueId}
          leagueName={league?.name ?? 'League'}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: s(16),
    paddingTop: s(12),
    paddingBottom: s(40),
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(12),
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: s(14),
    paddingVertical: s(12),
    marginBottom: s(16),
  },
  bannerText: {
    flex: 1,
    minWidth: 0,
  },
  bannerTitle: {
    fontSize: ms(14),
    fontWeight: '600',
  },
  bannerBody: {
    fontSize: ms(12),
    lineHeight: ms(16),
    marginTop: s(2),
  },
  explainer: {
    fontSize: ms(10),
    letterSpacing: 1.4,
    textAlign: 'center',
    marginTop: -s(4),
    // Binds downward to the presets + category list it labels.
    marginBottom: s(10),
  },
  presetRow: {
    flexDirection: 'row',
    gap: s(8),
    marginBottom: s(16),
  },
  presetChip: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    // 44pt minimum touch target.
    minHeight: s(44),
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetLabel: {
    fontSize: ms(10),
    letterSpacing: 1.2,
  },
  leagueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(12),
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: s(14),
    paddingVertical: s(12),
    marginBottom: s(16),
  },
  leagueIcon: {
    width: s(36),
    height: s(36),
    borderRadius: s(18),
    alignItems: 'center',
    justifyContent: 'center',
  },
  leagueText: {
    flex: 1,
    minWidth: 0,
  },
  leagueEyebrow: {
    fontSize: ms(10),
    letterSpacing: 1.4,
    marginBottom: s(2),
  },
  leagueName: {
    fontFamily: Fonts.display,
    fontSize: ms(15),
    lineHeight: ms(18),
    letterSpacing: -0.1,
  },
  leagueSub: {
    fontSize: ms(12),
    lineHeight: ms(16),
    marginTop: s(2),
  },
});
