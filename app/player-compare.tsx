import { useRouter } from 'expo-router';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CompareStatTable } from '@/components/player/CompareStatTable';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { ThemedText } from '@/components/ui/ThemedText';
import { useAppState } from '@/context/AppStateProvider';
import { useCompareSelection } from '@/context/CompareSelectionProvider';
import { useActiveLeagueSport } from '@/hooks/useActiveLeagueSport';
import { useColors } from '@/hooks/useColors';
import { useCompareData } from '@/hooks/useCompareData';
import { ms, s } from '@/utils/scale';

export default function PlayerCompareScreen() {
  const c = useColors();
  const router = useRouter();
  const { leagueId } = useAppState();
  const sport = useActiveLeagueSport(leagueId ?? undefined);
  const { selected, remove, clear, setCompareMode, min } = useCompareSelection();

  const { groups, winTally, isLoading } = useCompareData(selected, leagueId ?? '');

  const handleClear = () => {
    clear();
    setCompareMode(false);
    router.back();
  };

  const enoughSelected = selected.length >= min;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: c.background }]}
      edges={['top', 'left', 'right']}
    >
      <PageHeader
        title="Compare"
        rightAction={
          selected.length > 0 ? (
            <TouchableOpacity
              onPress={handleClear}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear comparison"
            >
              <ThemedText type="varsitySmall" style={[styles.clear, { color: c.gold }]}>
                Clear
              </ThemedText>
            </TouchableOpacity>
          ) : null
        }
      />

      {!leagueId ? (
        <Empty c={c} message="Join a league to compare players." />
      ) : !enoughSelected ? (
        <Empty c={c} message={`Pick at least ${min} players, then tap Compare.`} />
      ) : isLoading ? (
        <View style={styles.loader} accessibilityLabel="Loading comparison">
          <LogoSpinner />
        </View>
      ) : (
        <CompareStatTable
          candidates={selected}
          groups={groups}
          sport={sport}
          winTally={winTally}
          onRemove={remove}
        />
      )}
    </SafeAreaView>
  );
}

function Empty({ c, message }: { c: ReturnType<typeof useColors>; message: string }) {
  return (
    <View style={styles.empty} accessibilityRole="summary">
      <View style={[styles.emptyRule, { backgroundColor: c.gold }]} />
      <ThemedText type="varsitySmall" style={[styles.emptyEyebrow, { color: c.gold }]}>
        NOTHING TO COMPARE
      </ThemedText>
      <ThemedText style={[styles.emptyBody, { color: c.secondaryText }]}>{message}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  clear: { fontSize: ms(11), letterSpacing: 1.2 },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: s(32),
    gap: s(8),
  },
  emptyRule: { height: 2, width: s(28) },
  emptyEyebrow: { fontSize: ms(11), letterSpacing: 1.4 },
  emptyBody: { fontSize: ms(14), textAlign: 'center' },
});

export const options = {
  headerShown: false,
};
