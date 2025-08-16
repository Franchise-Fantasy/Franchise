import { DraftSection } from '@/components/home/DraftSection';
import { QuickNav } from '@/components/home/QuickNav';
import { StandingsSection } from '@/components/home/StandingsSection';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { useSession } from '@/context/AuthProvider';
import { useLeague } from '@/hooks/useLeague';
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function HomeScreen() {
  const { data: league, isLoading, isError } = useLeague();
  const session = useSession();
  const isCommissioner = session?.user?.id === league?.created_by;

  const handleSwitchLeague = () => {
    console.log('Switch league pressed');
  };

  const handleChatPress = () => {
    console.log('Chat pressed');
  };

  // Show different loading states for different sections
  return (
    <SafeAreaView style={styles.container}>
      <ThemedView style={styles.header}>
        <TouchableOpacity 
          style={styles.leagueSwitcher}
          onPress={handleSwitchLeague}
        > 
          <IconSymbol 
            name="chevron.down" 
            size={20}   
            color="#666"
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
            color="#666"
          />
        </TouchableOpacity>
      </ThemedView>

      <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
        {isLoading ? (
          <ActivityIndicator style={{ marginTop: 20 }} />
        ) : league ? (
          <>
          {/* <InviteSection isCommissioner={isCommissioner} />                  */}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    padding: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
    backgroundColor: 'white',
    alignItems: 'center',
    height: 50,
    justifyContent: 'space-between', // Added to ensure proper spacing
  },
  headerText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: 'thin',
    marginHorizontal: 40, // Changed to horizontal margin for both sides
  },
  leagueSwitcher: {
    padding: 8,
    marginLeft: 4,
    width: 36, // Fixed width to match chat button
    alignItems: 'center',
  },
  chatButton: {
    padding: 8,
    marginRight: 4,
    width: 36, // Fixed width to match league switcher
    alignItems: 'center',
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  headerImage: {
    height: 180,
    width: 320,
    bottom: 0,
    left: 0,
    position: 'absolute',
    opacity: 0.7,
  },
  section: {
    gap: 8,
    marginBottom: 18,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 10,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    marginTop: 8,
  },
  actionCard: {
    alignItems: 'center',
    backgroundColor: '#F5F7FA',
    borderRadius: 8,
    padding: 10,
    width: 90,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  actionIcon: {
    width: 36,
    height: 36,
    marginBottom: 6,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
});
