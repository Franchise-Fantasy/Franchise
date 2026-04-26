import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LeagueNotificationModal } from '@/components/banners/LeagueNotificationModal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Section } from '@/components/ui/Section';
import { ThemedText } from '@/components/ui/ThemedText';
import { ToggleRow } from '@/components/ui/ToggleRow';
import { Fonts } from '@/constants/Colors';
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
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  function handleMuteAll(value: boolean) {
    if (!userId) return;
    setMuteAllState(value);
    setMuteAll(userId, value);
  }

  function toggle(key: keyof PushPreferences) {
    return (value: boolean) => {
      if (!userId) return;
      const patch: Partial<PushPreferences> = { [key]: value };
      // Turn off sub-toggles when parent is disabled
      if (key === 'matchups' && !value) patch.matchup_daily = false;
      if (key === 'trades' && !value) {
        patch.trade_block = false;
        patch.trade_rumors = false;
      }
      setPrefs((prev) => ({ ...prev, ...patch }));
      updatePreferences(userId, patch);
    };
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

        <ThemedText
          type="varsitySmall"
          style={[styles.explainer, { color: c.secondaryText }]}
        >
          {muteAll
            ? 'ALL NOTIFICATIONS MUTED · TOGGLE OFF TO RE-ENABLE'
            : 'GLOBAL DEFAULTS · APPLY TO EVERY LEAGUE YOU’RE IN'}
        </ThemedText>

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
            </View>
            <Ionicons
              name="chevron-forward"
              size={ms(16)}
              color={c.secondaryText}
              accessible={false}
            />
          </TouchableOpacity>
        )}

        <View style={dimmed} pointerEvents={muteAll ? 'none' : 'auto'}>
          <Section title="Core Alerts">
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
              icon="hand-left-outline"
              label="Trade Block Interest"
              description="When someone expresses interest in your player"
              value={prefs.trade_block}
              onToggle={toggle('trade_block')}
              disabled={!prefs.trades}
              c={c}
              indented
            />
            <ToggleRow
              icon="ear-outline"
              label="Trade Rumors"
              description="Leaked and auto-generated trade rumors in chat"
              value={prefs.trade_rumors}
              onToggle={toggle('trade_rumors')}
              disabled={!prefs.trades}
              c={c}
              indented
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
            <ToggleRow
              icon="newspaper-outline"
              label="Player News"
              description="News articles about players on your roster"
              value={prefs.player_news}
              onToggle={toggle('player_news')}
              c={c}
              last
            />
          </Section>

          <Section title="Playoffs & Lottery">
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
              last
            />
          </Section>

          <Section title="Other">
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
              last
            />
          </Section>
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
  explainer: {
    fontSize: ms(10),
    letterSpacing: 1.4,
    textAlign: 'center',
    marginTop: -s(6),
    marginBottom: s(16),
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
});
