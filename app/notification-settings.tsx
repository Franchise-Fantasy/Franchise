import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { PageHeader } from '@/components/ui/PageHeader';
import { ToggleRow } from '@/components/ToggleRow';
import { Colors } from '@/constants/Colors';
import { useSession } from '@/context/AuthProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import {
  getPushPrefs,
  PushPreferences,
  DEFAULT_PREFERENCES,
  updatePreferences,
} from '@/lib/notifications';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

export default function NotificationSettingsScreen() {
  const session = useSession();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const userId = session?.user?.id;

  const [prefs, setPrefs] = useState<PushPreferences>(DEFAULT_PREFERENCES);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!userId) return;
    getPushPrefs(userId).then(({ preferences }) => {
      setPrefs(preferences);
      setLoaded(true);
    });
  }, [userId]);

  function toggle(key: keyof PushPreferences) {
    return (value: boolean) => {
      if (!userId) return;
      const patch: Partial<PushPreferences> = { [key]: value };
      // Turn off sub-toggle when parent is disabled
      if (key === 'matchups' && !value) patch.matchup_daily = false;
      setPrefs((prev) => ({ ...prev, ...patch }));
      updatePreferences(userId, patch);
    };
  }

  if (!loaded) return <ThemedView style={styles.container} />;

  return (
    <ThemedView style={styles.container}>
      <PageHeader title="Notifications" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >

        {/* Core Alerts */}
        <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
          <ThemedText type="defaultSemiBold" style={styles.sectionTitle} accessibilityRole="header">
            Core Alerts
          </ThemedText>
          <ToggleRow
            icon="basketball-outline"
            label="Draft"
            description="Your pick, draft started & completed, autopick"
            value={prefs.draft}
            onToggle={toggle('draft')}
            c={c}
          />
          <ToggleRow
            icon="swap-horizontal-outline"
            label="Trades"
            description="Proposed, accepted, completed, vetoed"
            value={prefs.trades}
            onToggle={toggle('trades')}
            c={c}
          />
          <ToggleRow
            icon="stats-chart-outline"
            label="Matchup Results"
            description="Final scores and weekly results"
            value={prefs.matchups}
            onToggle={toggle('matchups')}
            c={c}
          />
          <ToggleRow
            icon="trending-up-outline"
            label="Daily Score Updates"
            description="Daily matchup progress during the week"
            value={prefs.matchup_daily}
            onToggle={toggle('matchup_daily')}
            disabled={!prefs.matchups}
            c={c}
            indented
          />
          <ToggleRow
            icon="hourglass-outline"
            label="Waiver Results"
            description="Claim won or lost, FAAB bid results"
            value={prefs.waivers}
            onToggle={toggle('waivers')}
            c={c}
          />
          <ToggleRow
            icon="medkit-outline"
            label="Injury Updates"
            description="Your rostered player status changes"
            value={prefs.injuries}
            onToggle={toggle('injuries')}
            c={c}
          />
        </View>

        {/* Playoffs & Lottery */}
        <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
          <ThemedText type="defaultSemiBold" style={styles.sectionTitle} accessibilityRole="header">
            Playoffs & Lottery
          </ThemedText>
          <ToggleRow
            icon="trophy-outline"
            label="Playoff Alerts"
            description="Seed pick turn, championship"
            value={prefs.playoffs}
            onToggle={toggle('playoffs')}
            c={c}
          />
          <ToggleRow
            icon="dice-outline"
            label="Lottery Results"
            description="Draft position and lottery draws"
            value={prefs.lottery}
            onToggle={toggle('lottery')}
            c={c}
          />
        </View>

        {/* Other */}
        <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
          <ThemedText type="defaultSemiBold" style={styles.sectionTitle} accessibilityRole="header">
            Other
          </ThemedText>
          <ToggleRow
            icon="chatbubbles-outline"
            label="Chat Messages"
            description="New messages in league chat and DMs"
            value={prefs.chat}
            onToggle={toggle('chat')}
            c={c}
          />
          <ToggleRow
            icon="shield-outline"
            label="Commissioner Actions"
            description="Force add/drop/move on your team"
            value={prefs.commissioner}
            onToggle={toggle('commissioner')}
            c={c}
          />
          <ToggleRow
            icon="people-outline"
            label="League Activity"
            description="New team joins, season starts"
            value={prefs.league_activity}
            onToggle={toggle('league_activity')}
            c={c}
          />
          <ToggleRow
            icon="clipboard-outline"
            label="Roster Reminders"
            description="Pending drops executed, locked players"
            value={prefs.roster_reminders}
            onToggle={toggle('roster_reminders')}
            c={c}
          />
          <ToggleRow
            icon="person-add-outline"
            label="League Roster Moves"
            description="When other teams add or drop players"
            value={prefs.roster_moves}
            onToggle={toggle('roster_moves')}
            c={c}
          />
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  title: {
    fontSize: 20,
  },
  section: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 2,
    marginBottom: 16,
  },
  sectionTitle: {
    marginBottom: 8,
  },
});
