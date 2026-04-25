import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState, useCallback } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ToggleRow } from '@/components/ToggleRow';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import {
  getLeagueNotifPrefs,
  getPushPrefs,
  PushPreferences,
  DEFAULT_PREFERENCES,
  updateLeagueNotifPrefs,
  resetLeagueNotifPref,
} from '@/lib/notifications';
import { ms, s } from '@/utils/scale';

interface Props {
  visible: boolean;
  onClose: () => void;
  userId: string;
  leagueId: string;
  leagueName: string;
}

// Each notification category with its display info
const CATEGORIES: {
  key: keyof PushPreferences;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  parentKey?: keyof PushPreferences;
}[] = [
  { key: 'draft', icon: 'basketball-outline', label: 'Draft' },
  { key: 'trades', icon: 'swap-horizontal-outline', label: 'Trades' },
  { key: 'trade_block', icon: 'hand-left-outline', label: 'Trade Block Interest', parentKey: 'trades' },
  { key: 'trade_rumors', icon: 'ear-outline', label: 'Trade Rumors', parentKey: 'trades' },
  { key: 'matchups', icon: 'stats-chart-outline', label: 'Matchup Results' },
  { key: 'matchup_daily', icon: 'trending-up-outline', label: 'Daily Score Updates', parentKey: 'matchups' },
  { key: 'waivers', icon: 'hourglass-outline', label: 'Waiver Results' },
  { key: 'injuries', icon: 'medkit-outline', label: 'Injury Updates' },
  { key: 'player_news', icon: 'newspaper-outline', label: 'Player News' },
  { key: 'playoffs', icon: 'trophy-outline', label: 'Playoff Alerts' },
  { key: 'lottery', icon: 'dice-outline', label: 'Lottery Results' },
  { key: 'chat', icon: 'chatbubbles-outline', label: 'Chat Messages' },
  { key: 'commissioner', icon: 'shield-outline', label: 'Commissioner Actions' },
  { key: 'league_activity', icon: 'people-outline', label: 'League Activity' },
  { key: 'roster_reminders', icon: 'clipboard-outline', label: 'Roster Reminders' },
  { key: 'roster_moves', icon: 'person-add-outline', label: 'League Roster Moves' },
];

export function LeagueNotificationModal({ visible, onClose, userId, leagueId, leagueName }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const [globalPrefs, setGlobalPrefs] = useState<PushPreferences>(DEFAULT_PREFERENCES);
  const [overrides, setOverrides] = useState<Partial<PushPreferences>>({});
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const [global, league] = await Promise.all([
      getPushPrefs(userId),
      getLeagueNotifPrefs(userId, leagueId),
    ]);
    setGlobalPrefs(global.preferences);
    setOverrides(league);
    setLoaded(true);
  }, [userId, leagueId]);

  useEffect(() => {
    if (visible) {
      setLoaded(false);
      load();
    }
  }, [visible, load]);

  // Resolved value: league override if set, else global
  function resolvedValue(key: keyof PushPreferences): boolean {
    if (key in overrides) return overrides[key]!;
    return globalPrefs[key];
  }

  // Whether this category has a league-level override
  function hasOverride(key: keyof PushPreferences): boolean {
    return key in overrides;
  }

  // Toggle: if no override exists, create one with the opposite of global.
  // If override exists, flip it.
  function handleToggle(key: keyof PushPreferences) {
    return (value: boolean) => {
      const patch: Partial<PushPreferences> = { [key]: value };
      // Turn off sub-toggles when parent is disabled
      if (key === 'matchups' && !value) patch.matchup_daily = false;
      if (key === 'trades' && !value) { patch.trade_block = false; patch.trade_rumors = false; }
      setOverrides(prev => ({ ...prev, ...patch }));
      updateLeagueNotifPrefs(userId, leagueId, patch);
    };
  }

  // Reset to global default
  function handleReset(key: keyof PushPreferences) {
    setOverrides(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    resetLeagueNotifPref(userId, leagueId, key);
  }

  // Is this toggle disabled? (parent is off at resolved level)
  function isDisabled(cat: typeof CATEGORIES[number]): boolean {
    if (!cat.parentKey) return false;
    return !resolvedValue(cat.parentKey);
  }

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[styles.container, { backgroundColor: c.background }]} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={24} color={c.text} accessible={false} />
          </TouchableOpacity>
          <ThemedText type="defaultSemiBold" style={styles.headerTitle} numberOfLines={1}>
            {leagueName} Notifications
          </ThemedText>
          <View style={{ width: 24 }} />
        </View>

        <ThemedText style={[styles.hint, { color: c.secondaryText }]}>
          Override your global defaults for this league. Tap the dot to reset a category back to global.
        </ThemedText>

        {loaded && (
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {CATEGORIES.map((cat, idx) => {
              const resolved = resolvedValue(cat.key);
              const overridden = hasOverride(cat.key);
              const disabled = isDisabled(cat);
              const globalOff = !globalPrefs[cat.key];
              const isLast = idx === CATEGORIES.length - 1;

              return (
                <View key={cat.key} style={[styles.row, cat.parentKey && styles.indented]}>
                  {/* Override indicator — tap to reset */}
                  <TouchableOpacity
                    onPress={() => overridden ? handleReset(cat.key) : undefined}
                    disabled={!overridden}
                    hitSlop={8}
                    style={styles.dotWrap}
                    accessibilityRole="button"
                    accessibilityLabel={overridden ? `Reset ${cat.label} to global default` : `${cat.label} using global default`}
                  >
                    <View
                      style={[
                        styles.dot,
                        { backgroundColor: overridden ? c.accent : c.border },
                      ]}
                    />
                  </TouchableOpacity>

                  <View style={styles.toggleWrap}>
                    <ToggleRow
                      icon={cat.icon}
                      label={cat.label}
                      description={
                        globalOff
                          ? 'Disabled globally'
                          : overridden
                            ? 'Custom for this league'
                            : 'Using global default'
                      }
                      value={resolved}
                      onToggle={handleToggle(cat.key)}
                      disabled={disabled || globalOff}
                      c={c}
                      last={isLast}
                    />
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: s(16),
    paddingVertical: s(12),
  },
  headerTitle: { fontSize: ms(17), flex: 1, textAlign: 'center' },
  hint: {
    fontSize: ms(13),
    textAlign: 'center',
    paddingHorizontal: s(24),
    marginBottom: s(8),
  },
  scrollContent: {
    paddingHorizontal: s(16),
    paddingBottom: s(40),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  indented: {
    paddingLeft: s(20),
  },
  dotWrap: {
    width: s(20),
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: s(8),
    height: s(8),
    borderRadius: 4,
  },
  toggleWrap: {
    flex: 1,
  },
});
