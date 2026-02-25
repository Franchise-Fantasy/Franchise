import { DraftSection } from '@/components/home/DraftSection';
import { ErrorState } from '@/components/ErrorState';
import { InviteSection } from '@/components/home/InviteSection';
import { LeagueSwitcher } from '@/components/home/LeagueSwitcher';
import { OffseasonDashboard } from '@/components/home/OffseasonDashboard';
import { QuickNav } from '@/components/home/QuickNav';
import { StandingsSection } from '@/components/home/StandingsSection';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { useSession } from '@/context/AuthProvider';
import { useTotalUnread } from '@/hooks/useChat';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeague } from '@/hooks/useLeague';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function HomeScreen() {
  const { data: league, isLoading, isError, refetch } = useLeague();
  const session = useSession();
  const isCommissioner = session?.user?.id === league?.created_by;
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const router = useRouter();
  const { data: unreadCount } = useTotalUnread();
  const [switcherVisible, setSwitcherVisible] = useState(false);

  const handleChatPress = () => {
    router.push('/chat');
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
          {(unreadCount ?? 0) > 0 && (
            <View style={styles.unreadBadge}>
              <ThemedText style={styles.unreadText}>
                {unreadCount! > 99 ? '99+' : unreadCount}
              </ThemedText>
            </View>
          )}
        </TouchableOpacity>
      </ThemedView>

      <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
        {isLoading ? (
          <ActivityIndicator style={{ marginTop: 20 }} />
        ) : league ? (
          <>
            {league.offseason_step ? (
              <OffseasonDashboard
                leagueId={league.id}
                offseasonStep={league.offseason_step}
                isCommissioner={isCommissioner}
                rookieDraftOrder={league.rookie_draft_order ?? 'reverse_record'}
                season={league.season}
              />
            ) : null}
            <DraftSection leagueId={league.id} isCommissioner={isCommissioner} />
            <InviteSection
              isCommissioner={isCommissioner}
              isPrivate={league.private}
              inviteCode={league.invite_code}
              leagueId={league.id}
              isFull={(league.current_teams ?? 0) >= league.teams}
            />
            <QuickNav />
            <StandingsSection leagueId={league.id} playoffTeams={league.playoff_teams} />
          </>
        ) : isError ? (
          <ErrorState message="Failed to load league data" onRetry={() => refetch()} />
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
  unreadBadge: {
    position: 'absolute',
    top: 2,
    right: 0,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  unreadText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 16,
    includeFontPadding: false,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
  },
});
