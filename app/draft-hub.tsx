import { ByTeamTab } from '@/components/draft-hub/ByTeamTab';
import { ByYearTab } from '@/components/draft-hub/ByYearTab';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { PageHeader } from '@/components/ui/PageHeader';
import { Colors } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useDraftHub } from '@/hooks/useDraftHub';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const TABS = ['By Year', 'By Team'] as const;

export default function DraftHub() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { leagueId } = useAppState();

  const [tab, setTab] = useState(0);
  const { data, isLoading } = useDraftHub(leagueId);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.cardAlt }]}>
      <PageHeader title="Draft Hub" />

      {/* Tabs */}
      <View style={styles.tabBar}>
        <SegmentedControl options={TABS} selectedIndex={tab} onSelect={setTab} />
      </View>

      {/* Content */}
      {isLoading || !data ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" />
        </View>
      ) : tab === 0 ? (
        <ByYearTab
          picks={data.picks}
          swaps={data.swaps}
          teams={data.teams}
          validSeasons={data.validSeasons}
          leagueSettings={data.leagueSettings}
        />
      ) : (
        <ByTeamTab
          picks={data.picks}
          swaps={data.swaps}
          teams={data.teams}
          validSeasons={data.validSeasons}
          pickConditionsEnabled={data.leagueSettings.pickConditionsEnabled}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 70, paddingHorizontal: 8 },
  backText: { fontSize: 16, fontWeight: '500' },
  title: { fontSize: 16, textAlign: 'center' },
  tabBar: { paddingHorizontal: 16, paddingVertical: 10 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
