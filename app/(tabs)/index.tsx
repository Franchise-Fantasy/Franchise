import { AnalyticsPreviewCard } from '@/components/home/AnalyticsPreviewCard';
import { DraftSection } from '@/components/home/DraftSection';
import { ErrorState } from '@/components/ErrorState';
import { ImportedLeagueSection } from '@/components/home/ImportedLeagueSection';
import { InviteSection } from '@/components/home/InviteSection';
import { PaymentNudge } from '@/components/home/PaymentNudge';
import { LeagueSwitcher } from '@/components/home/LeagueSwitcher';
import { OffseasonDashboard } from '@/components/home/OffseasonDashboard';
import { QuickNav } from '@/components/home/QuickNav';
import { SeasonCompleteBanner } from '@/components/home/SeasonCompleteBanner';
import { StandingsSection } from '@/components/home/StandingsSection';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { useSession } from '@/context/AuthProvider';
import { useTotalUnread } from '@/hooks/chat';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeague } from '@/hooks/useLeague';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function HomeScreen() {
  const { data: league, isLoading, isError, refetch } = useLeague();
  const { teamId } = useAppState();
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
          accessibilityRole="button"
          accessibilityLabel="Switch league"
          accessibilityHint="Opens league switcher"
        >
          <IconSymbol
            name="chevron.down"
            size={20}
            color={c.icon}
            accessible={false}
          />
        </TouchableOpacity>
        <ThemedText type="title" style={styles.headerText} accessibilityRole="header">
          {isLoading ? 'Loading...' : league?.name}
        </ThemedText>
        <TouchableOpacity
          style={styles.chatButton}
          onPress={handleChatPress}
          accessibilityRole="button"
          accessibilityLabel={`Chat${(unreadCount ?? 0) > 0 ? `, ${unreadCount! > 99 ? '99+' : unreadCount} unread` : ''}`}
        >
          <IconSymbol
            name="bubble.right"
            size={20}
            color={c.icon}
            accessible={false}
          />
          {(unreadCount ?? 0) > 0 && (
            <View style={[styles.unreadBadge, { backgroundColor: c.danger }]} accessible={false}>
              <ThemedText style={[styles.unreadText, { color: c.statusText }]}>
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
                teamId={teamId!}
                offseasonStep={league.offseason_step}
                isCommissioner={isCommissioner}
                rookieDraftOrder={league.rookie_draft_order ?? 'reverse_record'}
                season={league.season}
                rosterSize={league.roster_size ?? 13}
                leagueType={league.league_type ?? 'dynasty'}
                keeperCount={league.keeper_count ?? 5}
              />
            ) : null}
            {!league.offseason_step && league.schedule_generated && league.playoff_teams && (
              <SeasonCompleteBanner
                leagueId={league.id}
                season={league.season}
                playoffTeams={league.playoff_teams}
                isCommissioner={isCommissioner}
              />
            )}
            {league.imported_from && !league.schedule_generated && !league.offseason_step ? (
              <ImportedLeagueSection
                leagueId={league.id}
                inviteCode={league.invite_code}
                isCommissioner={isCommissioner}
                scheduleGenerated={league.schedule_generated ?? false}
              />
            ) : (
              <>
                {(!league.offseason_step || (league.league_type ?? 'dynasty') === 'dynasty') && (
                  <DraftSection leagueId={league.id} isCommissioner={isCommissioner} />
                )}
                {!league.offseason_step && (
                  <InviteSection
                    isCommissioner={isCommissioner}
                    inviteCode={league.invite_code}
                    leagueId={league.id}
                    isFull={(league.current_teams ?? 0) >= league.teams}
                  />
                )}
                {!league.offseason_step && !isCommissioner && !!league.buy_in_amount && teamId && (
                  <PaymentNudge
                    leagueId={league.id}
                    leagueName={league.name}
                    season={league.season}
                    teamId={teamId}
                    buyInAmount={league.buy_in_amount}
                    venmoUsername={league.venmo_username ?? null}
                    cashappTag={league.cashapp_tag ?? null}
                    paypalUsername={league.paypal_username ?? null}
                  />
                )}
              </>
            )}
            {!league.offseason_step && (
              <>
                <AnalyticsPreviewCard leagueId={league.id} />
                <QuickNav leagueType={league.league_type ?? 'dynasty'} />
                <StandingsSection leagueId={league.id} playoffTeams={league.playoff_teams} scoringType={league.scoring_type} tiebreakerOrder={league.tiebreaker_order} divisionCount={league.division_count} division1Name={league.division_1_name} division2Name={league.division_2_name} />
              </>
            )}
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
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  unreadText: {
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
