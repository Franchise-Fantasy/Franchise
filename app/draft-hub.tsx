import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ByTeamTab } from '@/components/draft-hub/ByTeamTab';
import { ByYearTab } from '@/components/draft-hub/ByYearTab';
import { ProspectsTab } from '@/components/draft-hub/ProspectsTab';
import { LotteryResolutionSummary } from '@/components/lottery/LotteryResolutionSummary';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useDraftHub } from '@/hooks/useDraftHub';
import { useLeague } from '@/hooks/useLeague';
import { ms, s } from '@/utils/scale';

const TABS = ['By Year', 'By Team', 'Prospects'] as const;

export default function DraftHub() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const { leagueId } = useAppState();
  const { data: league } = useLeague();
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();

  const [tab, setTab] = useState(tabParam === 'prospects' ? 2 : 0);
  const { data, isLoading } = useDraftHub(leagueId);

  if (league && (league.league_type ?? 'dynasty') !== 'dynasty') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.cardAlt }]}>
        <PageHeader title="Draft Hub" />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
          <ThemedText style={{ color: c.secondaryText, textAlign: 'center', fontSize: ms(15) }}>
            Draft Hub is only available for dynasty leagues.
          </ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.cardAlt }]}>
      <PageHeader
        title="Draft Hub"
        rightAction={
          tab === 2 ? (
            <TouchableOpacity
              onPress={() => router.push('/prospect-board' as any)}
              accessibilityRole="button"
              accessibilityLabel="My Board"
            >
              <ThemedText style={[styles.boardLink, { color: c.accent }]}>My Board</ThemedText>
            </TouchableOpacity>
          ) : undefined
        }
      />

      {/* On web, hold the dense single-column tabs to a reading-width column so
          they don't stretch across the full content area (which leaves big empty
          gutters). No effect on native. */}
      <View style={styles.body}>
      {/* Tabs */}
      <View style={styles.tabBar}>
        <SegmentedControl options={TABS} selectedIndex={tab} onSelect={setTab} />
      </View>

      {/* Content */}
      {tab === 2 ? (
        <ProspectsTab />
      ) : isLoading || !data ? (
        <View style={styles.loading}>
          <LogoSpinner />
        </View>
      ) : tab === 0 ? (
        <>
          {leagueId && league?.season ? (
            <View style={styles.resolutionWrap}>
              <LotteryResolutionSummary leagueId={leagueId} season={league.season} collapsible />
            </View>
          ) : null}
          <ByYearTab
            picks={data.picks}
            swaps={data.swaps}
            teams={data.teams}
            validSeasons={data.validSeasons}
            leagueSettings={data.leagueSettings}
          />
        </>
      ) : (
        <ByTeamTab
          picks={data.picks}
          swaps={data.swaps}
          teams={data.teams}
          validSeasons={data.validSeasons}
          pickConditionsEnabled={data.leagueSettings.pickConditionsEnabled}
        />
      )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  // Web-only reading column — keeps the single-column tabs from stretching to
  // the full 960px content area. Tunable; native ignores it.
  body: {
    flex: 1,
    width: '100%',
    ...Platform.select({ web: { maxWidth: 680, alignSelf: 'center' } }),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: s(8),
    paddingVertical: s(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: s(70), paddingHorizontal: s(8) },
  backText: { fontSize: ms(16), fontWeight: '500' },
  title: { fontSize: ms(16), textAlign: 'center' },
  tabBar: { paddingHorizontal: s(16), paddingVertical: s(10) },
  resolutionWrap: { paddingHorizontal: s(16) },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  boardLink: {
    fontSize: ms(14),
    fontWeight: '600',
  },
});
