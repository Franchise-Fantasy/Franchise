import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FreeAgentList } from '@/components/player/FreeAgentList';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';

export default function FreeAgentsScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { leagueId, teamId } = useAppState();

  if (!leagueId || !teamId) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.cardAlt }]} accessibilityLabel="Players">
        <View style={styles.empty} accessibilityRole="summary">
          <ThemedText style={{ color: c.secondaryText }}>
            Join a league to browse players.
          </ThemedText>
        </View>
      </SafeAreaView> 
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.cardAlt }]} edges={['top', 'left', 'right']}>
      <FreeAgentList leagueId={leagueId} teamId={teamId} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
