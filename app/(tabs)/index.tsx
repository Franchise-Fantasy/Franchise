import { DraftSection } from '@/components/home/DraftSection';
import { LeagueSwitcher } from '@/components/home/LeagueSwitcher';
import { QuickNav } from '@/components/home/QuickNav';
import { StandingsSection } from '@/components/home/StandingsSection';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { useSession } from '@/context/AuthProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeague } from '@/hooks/useLeague';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function HomeScreen() {
  const { data: league, isLoading, isError } = useLeague();
  const session = useSession();
  const isCommissioner = session?.user?.id === league?.created_by;
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const [switcherVisible, setSwitcherVisible] = useState(false);

  const handleChatPress = () => {
    console.log('Chat pressed');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      <ThemedView style={[styles.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity 
          style={styles.leagueSwitcher}
          onPress={() => setSwitcherVisible(true)}
        > 
          <IconSymbol 
            name="chevron.down" 
            size={20}   
            color={c.icon}
          />
        </TouchableOpacity>
        <ThemedText type="title" style={styles.headerText}>
          {isLoading ? 'Loading...' : league?.name}
        </ThemedText>
        <TouchableOpacity 
          style={styles.chatButton}
          onPress={handleChatPress}
        >
          <IconSymbol 
            name="bubble.right" 
            size={20}  
            color={c.icon}
          />
        </TouchableOpacity>
      </ThemedView>

      <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
        {isLoading ? (
          <ActivityIndicator style={{ marginTop: 20 }} />
        ) : league ? (
          <>
            <DraftSection leagueId={league.id} isCommissioner={isCommissioner} />
            <StandingsSection leagueId={league.id} />
            <QuickNav />
          </>
        ) : isError ? (
          <ThemedView style={styles.errorContainer}>
            <ThemedText>Failed to load league data</ThemedText>
          </ThemedView>
        ) : null}
      </ScrollView>
      <LeagueSwitcher visible={switcherVisible} onClose={() => setSwitcherVisible(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    padding: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    height: 50,
    justifyContent: 'space-between',
  },
  headerText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: 'thin',
    marginHorizontal: 40,
  },
  leagueSwitcher: {
    padding: 8,
    marginLeft: 4,
    width: 36,
    alignItems: 'center',
  },
  chatButton: {
    padding: 8,
    marginRight: 4,
    width: 36,
    alignItems: 'center',
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
});
