import { DeclareKeepers } from '@/components/home/DeclareKeepers';
import { DraftSection } from '@/components/home/DraftSection';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors, cardShadow } from '@/constants/Colors';
import { queryKeys } from '@/constants/queryKeys';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { ms, s } from '@/utils/scale';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, TouchableOpacity, View } from 'react-native';
import { LogoSpinner } from '@/components/ui/LogoSpinner';

interface OffseasonDashboardProps {
  leagueId: string;
  teamId: string;
  offseasonStep: string;
  isCommissioner: boolean;
  rookieDraftOrder: string;
  season: string;
  rosterSize: number;
  leagueType?: string;
  keeperCount?: number;
}

interface StepDef {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

function getSteps(leagueType: string, rookieDraftOrder: string): StepDef[] {
  if (leagueType === 'redraft') {
    return [
      { key: 'season_complete', label: 'Season Over', icon: 'flag' },
      { key: 'draft', label: 'Draft', icon: 'people' },
      { key: 'new_season', label: 'New Season', icon: 'play' },
    ];
  }
  if (leagueType === 'keeper') {
    return [
      { key: 'season_complete', label: 'Season Over', icon: 'flag' },
      { key: 'declare_keepers', label: 'Keepers', icon: 'bookmark' },
      { key: 'draft', label: 'Draft', icon: 'people' },
      { key: 'new_season', label: 'New Season', icon: 'play' },
    ];
  }
  // Dynasty
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

function getActiveStepIndex(offseasonStep: string, leagueType: string, rookieDraftOrder: string, draftComplete?: boolean): number {
  if (leagueType === 'redraft') {
    // Steps: [Season Over, Draft, New Season]
    if (offseasonStep === 'ready_for_new_season') return draftComplete ? 2 : 1;
    return 0;
  }
  if (leagueType === 'keeper') {
    // Steps: [Season Over, Keepers, Draft, New Season]
    if (offseasonStep === 'keeper_pending') return 1;
    if (offseasonStep === 'ready_for_new_season') return draftComplete ? 3 : 2;
    return 0;
  }
  // Dynasty
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

export function OffseasonDashboard({ leagueId, teamId, offseasonStep, isCommissioner, rookieDraftOrder, season, rosterSize, leagueType = 'dynasty', keeperCount = 5 }: OffseasonDashboardProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const isDynasty = leagueType === 'dynasty';

  const steps = getSteps(leagueType, rookieDraftOrder);

  // Fetch rookie draft if it exists (dynasty only)
  const { data: rookieDraft } = useQuery({
    queryKey: queryKeys.rookieDraft(leagueId, season as unknown as number),
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
    enabled: isDynasty,
  });

  // Fetch season draft for keeper/redraft leagues
  const { data: seasonDraft } = useQuery({
    queryKey: queryKeys.seasonDraft(leagueId, season as unknown as number),
    queryFn: async () => {
      const { data } = await supabase
        .from('drafts')
        .select('id, status, draft_date')
        .eq('league_id', leagueId)
        .eq('season', season)
        .eq('type', 'initial')
        .maybeSingle();
      return data;
    },
    enabled: !isDynasty && offseasonStep === 'ready_for_new_season',
  });

  const seasonDraftComplete = seasonDraft?.status === 'complete';

  const activeIndex = getActiveStepIndex(offseasonStep, leagueType, rookieDraftOrder, seasonDraftComplete);

  // Fetch champion info
  const { data: champion } = useQuery({
    queryKey: queryKeys.champion(leagueId),
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

  // Roster compliance check (dynasty only, after rookie draft)
  const showCompliance = isDynasty && (offseasonStep === 'rookie_draft_complete' || offseasonStep === 'ready_for_new_season');
  const { data: compliance } = useQuery({
    queryKey: queryKeys.rosterCompliance(leagueId, teamId),
    queryFn: async () => {
      const { count: myCount } = await supabase
        .from('league_players')
        .select('id', { count: 'exact', head: true })
        .eq('league_id', leagueId)
        .eq('team_id', teamId);

      const { data: teams } = await supabase
        .from('teams')
        .select('id, name')
        .eq('league_id', leagueId);

      const teamCounts: { name: string; count: number }[] = [];
      if (teams) {
        for (const team of teams) {
          const { count } = await supabase
            .from('league_players')
            .select('id', { count: 'exact', head: true })
            .eq('league_id', leagueId)
            .eq('team_id', team.id);
          teamCounts.push({ name: team.name, count: count ?? 0 });
        }
      }

      return { myCount: myCount ?? 0, teamCounts };
    },
    enabled: showCompliance,
  });

  const handleCreateRookieDraft = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-rookie-draft', {
        body: { league_id: leagueId },
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: queryKeys.league(leagueId) });
      queryClient.invalidateQueries({ queryKey: ['rookieDraft', leagueId] });
      queryClient.invalidateQueries({ queryKey: queryKeys.activeDraft(leagueId) });
      Alert.alert('Rookie Draft Created', 'Schedule the date to begin.');
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to create rookie draft');
    } finally {
      setLoading(false);
    }
  };

  const handleFinalizeKeepers = async () => {
    Alert.alert(
      'Finalize Keepers',
      'This will release all non-kept players to free agency. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Finalize',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              const { error } = await supabase.functions.invoke('finalize-keepers', {
                body: { league_id: leagueId },
              });
              if (error) throw error;
              queryClient.invalidateQueries({ queryKey: queryKeys.league(leagueId) });
              queryClient.invalidateQueries({ queryKey: ['keeperDeclarations'] });
              Alert.alert('Keepers Finalized', 'Non-kept players have been released.');
            } catch (err: any) {
              Alert.alert('Error', err.message ?? 'Failed to finalize keepers');
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    );
  };

  const handleCreateSeasonDraft = async () => {
    setLoading(true);
    try {
      // Fetch team count + previous draft config for defaults
      const [teamsRes, prevDraftRes] = await Promise.all([
        supabase.from('teams').select('id', { count: 'exact', head: true }).eq('league_id', leagueId),
        supabase.from('drafts').select('draft_type, time_limit').eq('league_id', leagueId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      const teamCount = teamsRes.count ?? 10;
      const draftType = prevDraftRes.data?.draft_type ?? 'snake';
      const timeLimit = prevDraftRes.data?.time_limit ?? 120;

      const { error } = await supabase.from('drafts').insert({
        league_id: leagueId,
        season,
        type: 'initial',
        status: 'unscheduled',
        draft_type: draftType,
        rounds: teamCount,
        time_limit: timeLimit,
      });
      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['seasonDraft', leagueId] });
      queryClient.invalidateQueries({ queryKey: queryKeys.activeDraft(leagueId) });
      Alert.alert('Draft Created', 'Schedule the date to begin.');
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to create draft');
    } finally {
      setLoading(false);
    }
  };

  const handleStartNewSeason = async () => {
    // Dynasty only: check roster compliance
    if (isDynasty) {
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
              queryClient.invalidateQueries({ queryKey: queryKeys.league(leagueId) });
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

  const canStartNewSeason =
    (isDynasty && (offseasonStep === 'ready_for_new_season' || offseasonStep === 'rookie_draft_complete')) ||
    (!isDynasty && offseasonStep === 'ready_for_new_season' && seasonDraftComplete);

  return (
    <View style={[styles.container, { backgroundColor: c.card, borderColor: c.border }]}>
      {/* Champion banner */}
      {champion && (
        <View style={[styles.championBanner, { backgroundColor: c.goldMuted, borderColor: c.gold }]}>
          <Ionicons name="trophy" size={20} color={c.gold} />
          <ThemedText type="defaultSemiBold" style={{ marginLeft: s(8), fontSize: ms(14) }}>
            {champion.name} — League Champions
          </ThemedText>
        </View>
      )}

      <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.title}>Offseason</ThemedText>

      {/* Progress stepper */}
      <View style={styles.stepper}>
        {steps.map((step, idx) => {
          const isComplete = idx < activeIndex;
          const isActive = idx === activeIndex;
          return (
            <View key={step.key} style={styles.stepItem} accessibilityLabel={`${step.label}, ${isComplete ? 'complete' : isActive ? 'current step' : 'upcoming'}`}>
              <View style={[
                styles.stepCircle,
                isComplete && { backgroundColor: c.accent },
                isActive && { backgroundColor: c.activeCard, borderColor: c.activeBorder, borderWidth: 2 },
                !isComplete && !isActive && { backgroundColor: c.cardAlt, borderColor: c.border, borderWidth: 1 },
              ]}>
                {isComplete ? (
                  <Ionicons name="checkmark" size={14} color={c.statusText} />
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

      {/* Keeper declaration UI (visible to everyone in keeper leagues) */}
      {leagueType === 'keeper' && offseasonStep === 'keeper_pending' && (
        <DeclareKeepers
          leagueId={leagueId}
          teamId={teamId}
          season={season}
          keeperCount={keeperCount}
          isCommissioner={isCommissioner}
        />
      )}

      {/* Commissioner actions based on current step */}
      {isCommissioner && (
        <View style={styles.actions}>
          {/* Dynasty: Lottery */}
          {isDynasty && offseasonStep === 'lottery_pending' && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Enter lottery room"
              style={[styles.actionBtn, { backgroundColor: c.accent }]}
              onPress={() => router.push('/lottery-room' as any)}
            >
              <Ionicons name="ticket" size={18} color={c.statusText} />
              <ThemedText style={[styles.actionBtnText, { color: c.statusText }]}>Enter Lottery Room</ThemedText>
            </TouchableOpacity>
          )}

          {/* Dynasty: Create Rookie Draft */}
          {isDynasty && (offseasonStep === 'lottery_complete' || offseasonStep === 'rookie_draft_pending') && !rookieDraft && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Create rookie draft"
              accessibilityState={{ disabled: loading }}
              style={[styles.actionBtn, { backgroundColor: c.accent }, loading && { opacity: 0.6 }]}
              onPress={handleCreateRookieDraft}
              disabled={loading}
            >
              {loading ? (
                <LogoSpinner size={18} />
              ) : (
                <>
                  <Ionicons name="people" size={18} color={c.statusText} />
                  <ThemedText style={[styles.actionBtnText, { color: c.statusText }]}>Create Rookie Draft</ThemedText>
                </>
              )}
            </TouchableOpacity>
          )}

          {isDynasty && rookieDraft && rookieDraft.status === 'unscheduled' && (
            <ThemedText style={[styles.statusText, { color: c.secondaryText }]}>
              Rookie draft created — schedule a date from the draft card above.
            </ThemedText>
          )}

          {/* Keeper: Finalize Keepers */}
          {leagueType === 'keeper' && offseasonStep === 'keeper_pending' && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Finalize keepers and release remaining players"
              accessibilityState={{ disabled: loading }}
              style={[styles.actionBtn, { backgroundColor: c.accent }, loading && { opacity: 0.6 }]}
              onPress={handleFinalizeKeepers}
              disabled={loading}
            >
              {loading ? (
                <LogoSpinner size={18} />
              ) : (
                <>
                  <Ionicons name="bookmark" size={18} color={c.statusText} />
                  <ThemedText style={[styles.actionBtnText, { color: c.statusText }]}>Finalize Keepers</ThemedText>
                </>
              )}
            </TouchableOpacity>
          )}

          {/* Keeper/Redraft: Create Draft (when ready_for_new_season but draft not created) */}
          {!isDynasty && offseasonStep === 'ready_for_new_season' && !seasonDraft && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Create draft"
              accessibilityState={{ disabled: loading }}
              style={[styles.actionBtn, { backgroundColor: c.accent }, loading && { opacity: 0.6 }]}
              onPress={handleCreateSeasonDraft}
              disabled={loading}
            >
              {loading ? (
                <LogoSpinner size={18} />
              ) : (
                <>
                  <Ionicons name="people" size={18} color={c.statusText} />
                  <ThemedText style={[styles.actionBtnText, { color: c.statusText }]}>Create Draft</ThemedText>
                </>
              )}
            </TouchableOpacity>
          )}

          {/* All types: Start New Season */}
          {canStartNewSeason && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Start new season"
              accessibilityState={{ disabled: loading }}
              style={[styles.actionBtn, { backgroundColor: c.accent }, loading && { opacity: 0.6 }]}
              onPress={handleStartNewSeason}
              disabled={loading}
            >
              {loading ? (
                <LogoSpinner size={18} />
              ) : (
                <>
                  <Ionicons name="play" size={18} color={c.statusText} />
                  <ThemedText style={[styles.actionBtnText, { color: c.statusText }]}>Start New Season</ThemedText>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Keeper/Redraft: show DraftSection when draft exists but not complete */}
      {!isDynasty && offseasonStep === 'ready_for_new_season' && seasonDraft && !seasonDraftComplete && (
        <View style={{ marginTop: s(8) }}>
          <DraftSection leagueId={leagueId} isCommissioner={isCommissioner} />
        </View>
      )}

      {!isCommissioner && leagueType !== 'keeper' && (
        <ThemedText style={[styles.statusText, { color: c.secondaryText }]}>
          The commissioner is managing the offseason. Stay tuned!
        </ThemedText>
      )}

      {!isCommissioner && leagueType === 'keeper' && offseasonStep !== 'keeper_pending' && (
        <ThemedText style={[styles.statusText, { color: c.secondaryText }]}>
          The commissioner is managing the offseason. Stay tuned!
        </ThemedText>
      )}

      {/* Dynasty: Pre-rookie-draft info banner */}
      {isDynasty && (offseasonStep === 'rookie_draft_pending' || offseasonStep === 'lottery_complete') && (
        <View style={[styles.infoBanner, { backgroundColor: c.accent + '15', borderColor: c.accent }]}>
          <Ionicons name="information-circle" size={18} color={c.accent} />
          <ThemedText style={[styles.infoBannerText, { color: c.secondaryText }]}>
            Teams may temporarily exceed the {rosterSize}-player roster limit during the rookie draft. All teams must cut down to {rosterSize} before the new season can begin.
          </ThemedText>
        </View>
      )}

      {/* Dynasty: Post-draft roster compliance */}
      {showCompliance && compliance && (
        <View style={styles.complianceSection}>
          {compliance.myCount > rosterSize ? (
            <View style={[styles.complianceBanner, { backgroundColor: c.warningMuted, borderColor: c.warning }]}>
              <Ionicons name="warning" size={18} color={c.warning} />
              <View style={{ flex: 1, marginLeft: s(8) }}>
                <ThemedText type="defaultSemiBold" style={{ fontSize: ms(13) }}>
                  Roster Over Limit ({compliance.myCount}/{rosterSize})
                </ThemedText>
                <ThemedText style={{ fontSize: ms(12), color: c.secondaryText, marginTop: s(2) }}>
                  Cut {compliance.myCount - rosterSize} player{compliance.myCount - rosterSize !== 1 ? 's' : ''} before the new season.
                </ThemedText>
              </View>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Manage roster" onPress={() => router.push('/(tabs)/roster')}>
                <ThemedText style={{ color: c.accent, fontSize: ms(13), fontWeight: '600' }}>Manage</ThemedText>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={[styles.complianceBanner, { backgroundColor: c.successMuted, borderColor: c.success }]}>
              <Ionicons name="checkmark-circle" size={18} color={c.success} />
              <ThemedText style={{ marginLeft: s(8), fontSize: ms(13) }}>
                Roster compliant ({compliance.myCount}/{rosterSize})
              </ThemedText>
            </View>
          )}

          {isCommissioner && (
            <View style={{ marginTop: s(8) }}>
              <ThemedText style={{ fontSize: ms(12), color: c.secondaryText, marginBottom: s(6) }}>
                All teams must be at or under {rosterSize} players before the season can begin.
              </ThemedText>
              {compliance.teamCounts
                .filter((t) => t.count > rosterSize)
                .map((t) => (
                  <View key={t.name} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: s(3) }}>
                    <ThemedText style={{ fontSize: ms(12), color: c.warning }}>{t.name}</ThemedText>
                    <ThemedText style={{ fontSize: ms(12), color: c.warning, fontWeight: '600' }}>
                      {t.count}/{rosterSize}
                    </ThemedText>
                  </View>
                ))}
              {compliance.teamCounts.filter((t) => t.count > rosterSize).length === 0 && (
                <ThemedText style={{ fontSize: ms(12), color: c.success }}>
                  All teams are at or under the roster limit.
                </ThemedText>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 1,
    padding: s(16),
    marginBottom: s(16),
    ...cardShadow,
  },
  championBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: s(10),
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: s(12),
  },
  title: {
    fontSize: ms(16),
    marginBottom: s(12),
  },
  stepper: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: s(16),
  },
  stepItem: {
    alignItems: 'center',
    flex: 1,
  },
  stepCircle: {
    width: s(30),
    height: s(30),
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: s(4),
  },
  stepLabel: {
    fontSize: ms(10),
    textAlign: 'center',
  },
  stepConnector: {
    position: 'absolute',
    top: s(14),
    right: s(-20),
    width: s(40),
    height: s(2),
    zIndex: -1,
  },
  actions: {
    gap: s(8),
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: s(12),
    borderRadius: 10,
    gap: s(8),
  },
  actionBtnText: {
    fontWeight: '600',
    fontSize: ms(14),
  },
  statusText: {
    fontSize: ms(13),
    textAlign: 'center',
    lineHeight: ms(18),
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: s(10),
    borderRadius: 8,
    borderWidth: 1,
    marginTop: s(12),
    gap: s(8),
  },
  infoBannerText: {
    fontSize: ms(12),
    flex: 1,
    lineHeight: ms(17),
  },
  complianceSection: {
    marginTop: s(12),
  },
  complianceBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: s(10),
    borderRadius: 8,
    borderWidth: 1,
  },
});
