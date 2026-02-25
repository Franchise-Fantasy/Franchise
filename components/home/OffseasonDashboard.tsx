import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, TouchableOpacity, View } from 'react-native';

interface OffseasonDashboardProps {
  leagueId: string;
  offseasonStep: string;
  isCommissioner: boolean;
  rookieDraftOrder: string;
  season: string;
}

interface StepDef {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

function getSteps(rookieDraftOrder: string): StepDef[] {
  const steps: StepDef[] = [
    { key: 'season_complete', label: 'Season Over', icon: 'flag' },
  ];
  if (rookieDraftOrder === 'lottery') {
    steps.push({ key: 'lottery', label: 'Lottery', icon: 'ticket' });
  }
  steps.push(
    { key: 'rookie_draft', label: 'Rookie Draft', icon: 'people' },
    { key: 'new_season', label: 'New Season', icon: 'play' },
  );
  return steps;
}

function getActiveStepIndex(offseasonStep: string, rookieDraftOrder: string): number {
  if (rookieDraftOrder === 'lottery') {
    if (offseasonStep === 'lottery_pending' || offseasonStep === 'lottery_scheduled') return 1;
    if (offseasonStep === 'lottery_complete') return 2;
    if (offseasonStep === 'rookie_draft_pending') return 2;
    if (offseasonStep === 'rookie_draft_complete' || offseasonStep === 'ready_for_new_season') return 3;
  } else {
    if (offseasonStep === 'rookie_draft_pending') return 1;
    if (offseasonStep === 'rookie_draft_complete' || offseasonStep === 'ready_for_new_season') return 2;
  }
  return 0;
}

export function OffseasonDashboard({ leagueId, offseasonStep, isCommissioner, rookieDraftOrder, season }: OffseasonDashboardProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);

  const steps = getSteps(rookieDraftOrder);
  const activeIndex = getActiveStepIndex(offseasonStep, rookieDraftOrder);

  // Fetch rookie draft if it exists
  const { data: rookieDraft } = useQuery({
    queryKey: ['rookieDraft', leagueId, season],
    queryFn: async () => {
      const { data } = await supabase
        .from('drafts')
        .select('id, status, draft_date')
        .eq('league_id', leagueId)
        .eq('season', season)
        .eq('type', 'rookie')
        .maybeSingle();
      return data;
    },
  });

  // Fetch champion info
  const { data: champion } = useQuery({
    queryKey: ['champion', leagueId],
    queryFn: async () => {
      const { data: league } = await supabase
        .from('leagues')
        .select('champion_team_id')
        .eq('id', leagueId)
        .single();
      if (!league?.champion_team_id) return null;
      const { data: team } = await supabase
        .from('teams')
        .select('name')
        .eq('id', league.champion_team_id)
        .single();
      return team;
    },
  });

  const handleCreateRookieDraft = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-rookie-draft', {
        body: { league_id: leagueId },
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['league', leagueId] });
      queryClient.invalidateQueries({ queryKey: ['rookieDraft', leagueId] });
      Alert.alert('Rookie Draft Created', 'Schedule the date to begin.');
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to create rookie draft');
    } finally {
      setLoading(false);
    }
  };

  const handleStartNewSeason = async () => {
    // Check roster compliance first
    const { data: teams } = await supabase
      .from('teams')
      .select('id, name')
      .eq('league_id', leagueId);

    const { data: league } = await supabase
      .from('leagues')
      .select('roster_size')
      .eq('id', leagueId)
      .single();

    if (teams && league) {
      const overTeams: string[] = [];
      for (const team of teams) {
        const { count } = await supabase
          .from('league_players')
          .select('id', { count: 'exact', head: true })
          .eq('league_id', leagueId)
          .eq('team_id', team.id);
        if ((count ?? 0) > league.roster_size) {
          overTeams.push(team.name);
        }
      }
      if (overTeams.length > 0) {
        Alert.alert(
          'Roster Overage',
          `These teams are over the roster limit and need to make cuts before the season can start:\n\n${overTeams.join('\n')}`,
        );
        return;
      }
    }

    Alert.alert(
      'Start New Season',
      `This will generate the schedule for ${season} and begin the new season. Continue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start Season',
          onPress: async () => {
            setLoading(true);
            try {
              const { error } = await supabase.functions.invoke('generate-schedule', {
                body: { league_id: leagueId },
              });
              if (error) throw error;
              await supabase
                .from('leagues')
                .update({ offseason_step: null, schedule_generated: true })
                .eq('id', leagueId);
              queryClient.invalidateQueries({ queryKey: ['league', leagueId] });
            } catch (err: any) {
              Alert.alert('Error', err.message ?? 'Failed to start season');
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: c.card, borderColor: c.border }]}>
      {/* Champion banner */}
      {champion && (
        <View style={[styles.championBanner, { backgroundColor: '#FFD700' + '22', borderColor: '#FFD700' }]}>
          <Ionicons name="trophy" size={20} color="#FFD700" />
          <ThemedText type="defaultSemiBold" style={{ marginLeft: 8, fontSize: 14 }}>
            {champion.name} — League Champions
          </ThemedText>
        </View>
      )}

      <ThemedText type="defaultSemiBold" style={styles.title}>Offseason</ThemedText>

      {/* Progress stepper */}
      <View style={styles.stepper}>
        {steps.map((step, idx) => {
          const isComplete = idx < activeIndex;
          const isActive = idx === activeIndex;
          return (
            <View key={step.key} style={styles.stepItem}>
              <View style={[
                styles.stepCircle,
                isComplete && { backgroundColor: c.accent },
                isActive && { backgroundColor: c.activeCard, borderColor: c.activeBorder, borderWidth: 2 },
                !isComplete && !isActive && { backgroundColor: c.cardAlt, borderColor: c.border, borderWidth: 1 },
              ]}>
                {isComplete ? (
                  <Ionicons name="checkmark" size={14} color="#fff" />
                ) : (
                  <Ionicons name={step.icon} size={14} color={isActive ? c.activeText : c.secondaryText} />
                )}
              </View>
              <ThemedText style={[
                styles.stepLabel,
                { color: isActive ? c.text : c.secondaryText },
                isActive && { fontWeight: '600' },
              ]}>
                {step.label}
              </ThemedText>
              {idx < steps.length - 1 && (
                <View style={[styles.stepConnector, { backgroundColor: isComplete ? c.accent : c.border }]} />
              )}
            </View>
          );
        })}
      </View>

      {/* Commissioner actions based on current step */}
      {isCommissioner && (
        <View style={styles.actions}>
          {offseasonStep === 'lottery_pending' && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: c.accent }]}
              onPress={() => router.push('/lottery-room' as any)}
            >
              <Ionicons name="ticket" size={18} color="#fff" />
              <ThemedText style={styles.actionBtnText}>Enter Lottery Room</ThemedText>
            </TouchableOpacity>
          )}

          {(offseasonStep === 'lottery_complete' || offseasonStep === 'rookie_draft_pending') && !rookieDraft && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: c.accent }, loading && { opacity: 0.6 }]}
              onPress={handleCreateRookieDraft}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="people" size={18} color="#fff" />
                  <ThemedText style={styles.actionBtnText}>Create Rookie Draft</ThemedText>
                </>
              )}
            </TouchableOpacity>
          )}

          {rookieDraft && rookieDraft.status === 'unscheduled' && (
            <ThemedText style={[styles.statusText, { color: c.secondaryText }]}>
              Rookie draft created — schedule a date from the draft card above.
            </ThemedText>
          )}

          {(offseasonStep === 'rookie_draft_complete' || offseasonStep === 'ready_for_new_season') && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: c.accent }, loading && { opacity: 0.6 }]}
              onPress={handleStartNewSeason}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="play" size={18} color="#fff" />
                  <ThemedText style={styles.actionBtnText}>Start New Season</ThemedText>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      )}

      {!isCommissioner && (
        <ThemedText style={[styles.statusText, { color: c.secondaryText }]}>
          The commissioner is managing the offseason. Stay tuned!
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  championBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    marginBottom: 12,
  },
  stepper: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  stepItem: {
    alignItems: 'center',
    flex: 1,
  },
  stepCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  stepLabel: {
    fontSize: 10,
    textAlign: 'center',
  },
  stepConnector: {
    position: 'absolute',
    top: 14,
    right: -20,
    width: 40,
    height: 2,
    zIndex: -1,
  },
  actions: {
    gap: 8,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 8,
  },
  actionBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  statusText: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
});
