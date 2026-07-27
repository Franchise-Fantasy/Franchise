import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { queryKeys } from '@/constants/queryKeys';
import { useAppState } from '@/context/AppStateProvider';
import { useSession } from '@/context/AuthProvider';
import { useToast } from '@/context/ToastProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { logger } from "@/utils/logger";
import { ms } from "@/utils/scale";

interface UnclaimedTeam {
  id: string;
  name: string;
  tricode: string;
  sleeper_roster_id: number | null;
}

export default function ClaimTeamScreen() {
  const router = useRouter();
  // `teamId` is the team a commissioner RESERVED for this invitee via
  // send-league-invite. It arrives from the invite card, the push tap, or a
  // deep link; when set, that team is pinned to the top as theirs.
  const { leagueId, isCommissioner, teamId: reservedTeamId } = useLocalSearchParams<{
    leagueId: string;
    isCommissioner: string;
    teamId?: string;
  }>();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { switchLeague } = useAppState();
  const session = useSession();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [claiming, setClaiming] = useState(false);

  const { data: teams, isLoading } = useQuery({
    queryKey: queryKeys.unclaimedTeams(leagueId!),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teams')
        .select('id, name, tricode, sleeper_roster_id')
        .eq('league_id', leagueId!)
        .is('user_id', null)
        .not('sleeper_roster_id', 'is', null)
        .order('name');

      if (error) throw error;
      return data as UnclaimedTeam[];
    },
    enabled: !!leagueId,
  });

  // Pin the reserved team first. It can be missing here if it was claimed
  // between the invite and the tap — then this is just the normal open list,
  // which is the intended fallback rather than a dead end.
  const reservedTeam = reservedTeamId
    ? (teams ?? []).find((t) => t.id === reservedTeamId) ?? null
    : null;
  const otherTeams = (teams ?? []).filter((t) => t.id !== reservedTeam?.id);

  const handleClaim = async (team: UnclaimedTeam) => {
    setClaiming(true);
    try {
      // Claim via RPC (SECURITY DEFINER — bypasses RLS for unclaimed teams)
      const { error: claimError } = await supabase.rpc('claim_imported_team', {
        team_id_input: team.id,
      });

      if (claimError) throw claimError;

      // Now that we own the team, set commissioner flag if needed
      if (isCommissioner === 'true') {
        await supabase
          .from('teams')
          .update({ is_commissioner: true })
          .eq('id', team.id);
      }

      // Imported leagues have no draft to trigger schedule
      // generation, so the "last claim" is the natural signal.
      // After the claim succeeds, check if any unclaimed teams
      // remain; if none, auto-fire generate-schedule. Fail-silent
      // so a transient error doesn't block the user's claim flow
      // — the commissioner will see the generate prompt on the
      // home screen and can retry from there.
      const { data: stillUnclaimed } = await supabase
        .from('teams')
        .select('id')
        .eq('league_id', leagueId!)
        .is('user_id', null)
        .limit(1);

      if (!stillUnclaimed || stillUnclaimed.length === 0) {
        supabase.functions
          .invoke('generate-schedule', { body: { league_id: leagueId } })
          .catch(() => {});
      }

      showToast('success', `Claimed "${team.name}"`);
      switchLeague(leagueId!, team.id);
      // Surface the claimed league in the home switcher immediately.
      if (session?.user) {
        queryClient.invalidateQueries({ queryKey: queryKeys.userLeagues(session.user.id) });
      }
      router.replace('/(tabs)');
    } catch (err: any) {
      logger.error('Claim team error', err);
      Alert.alert('Error', err.message ?? 'Failed to claim team.');
    } finally {
      setClaiming(false);
    }
  };

  const renderTeam = (team: UnclaimedTeam, reserved: boolean) => (
    <TouchableOpacity
      key={team.id}
      style={[
        styles.teamCard,
        { backgroundColor: c.card, borderColor: reserved ? c.accent : c.border },
        reserved && styles.reservedCard,
      ]}
      onPress={() => handleClaim(team)}
      disabled={claiming}
      accessibilityRole="button"
      accessibilityLabel={
        reserved ? `Claim ${team.name}, reserved for you` : `Claim ${team.name}`
      }
      accessibilityState={{ disabled: claiming }}
    >
      <View style={styles.teamInfo}>
        <Ionicons
          name={reserved ? 'bookmark' : 'people-outline'}
          size={22}
          color={c.accent}
          accessible={false}
        />
        <View style={{ flex: 1 }}>
          <ThemedText style={styles.teamName}>{team.name}</ThemedText>
          <Text style={[styles.teamTricode, { color: c.secondaryText }]}>
            {team.tricode}
          </Text>
        </View>
      </View>
      {claiming ? (
        <LogoSpinner size={18} />
      ) : (
        <Ionicons name="chevron-forward" size={20} color={c.secondaryText} accessible={false} />
      )}
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      <ThemedText type="title" style={styles.header} accessibilityRole="header">
        Claim Your Team
      </ThemedText>
      <ThemedText style={[styles.desc, { color: c.secondaryText }]}>
        {reservedTeam
          ? 'Your commissioner saved a team for you.'
          : 'Pick the team that belongs to you.'}
      </ThemedText>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {isLoading ? (
          <View style={{ marginTop: 32 }}><LogoSpinner /></View>
        ) : !teams?.length ? (
          <ThemedText style={[styles.empty, { color: c.secondaryText }]}>
            No unclaimed teams available.
          </ThemedText>
        ) : (
          <>
            {reservedTeam && (
              <>
                <ThemedText
                  style={[styles.sectionLabel, { color: c.accent }]}
                  accessibilityRole="header"
                >
                  RESERVED FOR YOU
                </ThemedText>
                {renderTeam(reservedTeam, true)}
              </>
            )}
            {reservedTeam && otherTeams.length > 0 && (
              <ThemedText
                style={[styles.sectionLabel, { color: c.secondaryText }]}
                accessibilityRole="header"
              >
                OTHER AVAILABLE TEAMS
              </ThemedText>
            )}
            {otherTeams.map((team) => renderTeam(team, false))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 16,
    paddingBottom: 4,
    textAlign: 'center',
  },
  desc: {
    fontSize: ms(14),
    textAlign: 'center',
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 16,
    gap: 10,
  },
  teamCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  reservedCard: {
    borderWidth: 2,
  },
  sectionLabel: {
    fontSize: ms(11),
    fontWeight: '600',
    letterSpacing: 1,
    marginTop: 6,
  },
  teamInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  teamName: {
    fontSize: ms(16),
    fontWeight: '600',
  },
  teamTricode: {
    fontSize: ms(13),
    marginTop: 2,
  },
  empty: {
    textAlign: 'center',
    paddingVertical: 40,
    fontSize: ms(15),
  },
});
