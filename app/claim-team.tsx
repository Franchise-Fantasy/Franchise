import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
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
  const { leagueId, isCommissioner } = useLocalSearchParams<{
    leagueId: string;
    isCommissioner: string;
  }>();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { switchLeague } = useAppState();
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
      router.replace('/(tabs)');
    } catch (err: any) {
      logger.error('Claim team error', err);
      Alert.alert('Error', err.message ?? 'Failed to claim team.');
    } finally {
      setClaiming(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      <ThemedText type="title" style={styles.header} accessibilityRole="header">
        Claim Your Team
      </ThemedText>
      <ThemedText style={[styles.desc, { color: c.secondaryText }]}>
        This league was imported from Sleeper. Pick the team that belongs to you.
      </ThemedText>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {isLoading ? (
          <View style={{ marginTop: 32 }}><LogoSpinner /></View>
        ) : !teams?.length ? (
          <ThemedText style={[styles.empty, { color: c.secondaryText }]}>
            No unclaimed teams available.
          </ThemedText>
        ) : (
          teams.map((team) => (
            <TouchableOpacity
              key={team.id}
              style={[styles.teamCard, { backgroundColor: c.card, borderColor: c.border }]}
              onPress={() => handleClaim(team)}
              disabled={claiming}
              accessibilityRole="button"
              accessibilityLabel={`Claim ${team.name}`}
              accessibilityState={{ disabled: claiming }}
            >
              <View style={styles.teamInfo}>
                <Ionicons name="people-outline" size={22} color={c.accent} accessible={false} />
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
          ))
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

export const options = {
  headerShown: false,
};
