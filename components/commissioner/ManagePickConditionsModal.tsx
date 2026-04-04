import { ThemedText } from '@/components/ui/ThemedText';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { Colors } from '@/constants/Colors';
import { queryKeys } from '@/constants/queryKeys';
import { CURRENT_NBA_SEASON } from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';
import { supabase } from '@/lib/supabase';
import { formatPickLabel } from '@/types/trade';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

interface Props {
  visible: boolean;
  leagueId: string;
  teams: Array<{ id: string; name: string }>;
  onClose: () => void;
}

type Step = 'choose' | 'protection_pick' | 'protection_edit' | 'swap_edit';

export function ManagePickConditionsModal({ visible, leagueId, teams, onClose }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>('choose');
  const [selectedPick, setSelectedPick] = useState<any>(null);
  const [protThreshold, setProtThreshold] = useState(3);
  const [protOwnerId, setProtOwnerId] = useState<string>('');
  const [processing, setProcessing] = useState(false);

  // Swap fields
  const [swapSeason, setSwapSeason] = useState('');
  const [swapRound, setSwapRound] = useState(1);
  const [swapBeneficiary, setSwapBeneficiary] = useState('');
  const [swapCounterparty, setSwapCounterparty] = useState('');

  function handleClose() {
    setStep('choose');
    setSelectedPick(null);
    setProtThreshold(3);
    setProtOwnerId('');
    setSwapSeason('');
    setSwapRound(1);
    setSwapBeneficiary('');
    setSwapCounterparty('');
    onClose();
  }

  function goBack() {
    if (step === 'protection_edit') { setStep('protection_pick'); setSelectedPick(null); }
    else if (step === 'protection_pick' || step === 'swap_edit') setStep('choose');
    else handleClose();
  }

  const { data: leagueSettings } = useQuery({
    queryKey: queryKeys.commishPickConditions(leagueId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leagues')
        .select('max_future_seasons, teams, rookie_draft_rounds, season, offseason_step')
        .eq('id', leagueId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: visible && !!leagueId,
  });

  const maxFuture = leagueSettings?.max_future_seasons ?? 3;
  const teamCount = leagueSettings?.teams ?? 10;
  const rookieDraftRounds = leagueSettings?.rookie_draft_rounds ?? 2;

  const validSeasons = (() => {
    const leagueSeason = leagueSettings?.season ?? CURRENT_NBA_SEASON;
    const leagueStartYear = parseInt(leagueSeason.split('-')[0], 10);
    const step = leagueSettings?.offseason_step as string | null;
    const draftDone = !step || step === 'rookie_draft_complete';
    const startYear = draftDone ? leagueStartYear + 1 : leagueStartYear;
    const seasons: string[] = [];
    const count = draftDone ? maxFuture : maxFuture + 1;
    for (let i = 0; i < count; i++) {
      const sy = startYear + i;
      const ey = (sy + 1) % 100;
      seasons.push(`${sy}-${String(ey).padStart(2, '0')}`);
    }
    return seasons;
  })();

  // Fetch all draft picks for selecting
  const { data: allPicks, isLoading: picksLoading } = useQuery({
    queryKey: queryKeys.commishAllPicks(leagueId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('draft_picks')
        .select('id, season, round, current_team_id, original_team_id, protection_threshold, protection_owner_id')
        .eq('league_id', leagueId)
        .is('player_id', null)
        .in('season', validSeasons)
        .order('season')
        .order('round');
      if (error) throw error;
      return data ?? [];
    },
    enabled: visible && step === 'protection_pick' && !!leagueId,
  });

  // Fetch existing swaps
  const { data: existingSwaps, isLoading: swapsLoading } = useQuery({
    queryKey: queryKeys.commishSwaps(leagueId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pick_swaps')
        .select('id, season, round, beneficiary_team_id, counterparty_team_id, resolved')
        .eq('league_id', leagueId)
        .eq('resolved', false);
      if (error) throw error;
      return data ?? [];
    },
    enabled: visible && step === 'swap_edit' && !!leagueId,
  });

  const teamNameMap: Record<string, string> = {};
  for (const t of teams) teamNameMap[t.id] = t.name;

  const handleSetProtection = async () => {
    if (!selectedPick) return;
    setProcessing(true);
    try {
      const { error } = await supabase
        .from('draft_picks')
        .update({
          protection_threshold: protThreshold,
          protection_owner_id: protOwnerId || null,
        })
        .eq('id', selectedPick.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['commishAllPicks'] });
      queryClient.invalidateQueries({ queryKey: ['draftHub'] });
      Alert.alert('Success', `Protection set: Top-${protThreshold}`);
      goBack();
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleRemoveProtection = async () => {
    if (!selectedPick) return;
    setProcessing(true);
    try {
      const { error } = await supabase
        .from('draft_picks')
        .update({ protection_threshold: null, protection_owner_id: null })
        .eq('id', selectedPick.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['commishAllPicks'] });
      queryClient.invalidateQueries({ queryKey: ['draftHub'] });
      Alert.alert('Success', 'Protection removed');
      goBack();
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleCreateSwap = async () => {
    if (!swapSeason || !swapBeneficiary || !swapCounterparty) {
      Alert.alert('Missing fields', 'Select season, beneficiary, and counterparty');
      return;
    }
    if (swapBeneficiary === swapCounterparty) {
      Alert.alert('Invalid', 'Beneficiary and counterparty must be different teams');
      return;
    }
    setProcessing(true);
    try {
      const { error } = await supabase.from('pick_swaps').insert({
        league_id: leagueId,
        season: swapSeason,
        round: swapRound,
        beneficiary_team_id: swapBeneficiary,
        counterparty_team_id: swapCounterparty,
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['commishSwaps'] });
      queryClient.invalidateQueries({ queryKey: ['draftHub'] });
      Alert.alert('Success', 'Swap created');
      setSwapBeneficiary('');
      setSwapCounterparty('');
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDeleteSwap = async (swapId: string) => {
    setProcessing(true);
    try {
      const { error } = await supabase.from('pick_swaps').delete().eq('id', swapId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['commishSwaps'] });
      queryClient.invalidateQueries({ queryKey: ['draftHub'] });
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: c.background }]} accessibilityViewIsModal={true}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: c.border }]}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Go back" onPress={goBack} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={20} color={c.accent} />
            </TouchableOpacity>
            <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.headerTitle}>
              {step === 'choose' ? 'Pick Conditions' : step === 'swap_edit' ? 'Manage Swaps' : 'Manage Protection'}
            </ThemedText>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" onPress={handleClose}>
              <ThemedText style={styles.closeText}>✕</ThemedText>
            </TouchableOpacity>
          </View>

          {/* Step: Choose */}
          {step === 'choose' && (
            <View style={styles.chooseContainer}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Manage Protection. Add or remove top-N protections on draft picks"
                style={[styles.chooseBtn, { backgroundColor: c.card, borderColor: c.border }]}
                onPress={() => setStep('protection_pick')}
              >
                <Ionicons name="shield-checkmark-outline" size={24} color={c.accent} />
                <ThemedText type="defaultSemiBold">Manage Protection</ThemedText>
                <ThemedText style={[styles.chooseDesc, { color: c.secondaryText }]}>
                  Add or remove top-N protections on draft picks
                </ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Manage Swaps. Create or delete pick swap agreements"
                style={[styles.chooseBtn, { backgroundColor: c.card, borderColor: c.border }]}
                onPress={() => { setStep('swap_edit'); setSwapSeason(validSeasons[0]); }}
              >
                <Ionicons name="swap-horizontal-outline" size={24} color={c.accent} />
                <ThemedText type="defaultSemiBold">Manage Swaps</ThemedText>
                <ThemedText style={[styles.chooseDesc, { color: c.secondaryText }]}>
                  Create or delete pick swap agreements
                </ThemedText>
              </TouchableOpacity>
            </View>
          )}

          {/* Step: Pick a pick for protection */}
          {step === 'protection_pick' && (
            picksLoading ? (
              <View style={styles.loading}><ActivityIndicator size="large" /></View>
            ) : (
              <FlatList
                data={allPicks}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listContent}
                renderItem={({ item, index }) => (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`${formatPickLabel(item.season, item.round)}, Owner: ${teamNameMap[item.current_team_id] ?? 'Unknown'}${item.protection_threshold ? `, Top-${item.protection_threshold} protected` : ''}`}
                    style={[styles.pickRow, { borderBottomColor: c.border }, index === (allPicks ?? []).length - 1 && { borderBottomWidth: 0 }]}
                    onPress={() => {
                      setSelectedPick(item);
                      setProtThreshold(item.protection_threshold ?? 3);
                      setProtOwnerId(item.protection_owner_id ?? item.current_team_id);
                      setStep('protection_edit');
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <ThemedText style={{ fontSize: ms(14) }}>
                        {formatPickLabel(item.season, item.round)}
                      </ThemedText>
                      <ThemedText style={[styles.pickSub, { color: c.secondaryText }]}>
                        Owner: {teamNameMap[item.current_team_id] ?? '?'} · via {teamNameMap[item.original_team_id] ?? '?'}
                      </ThemedText>
                    </View>
                    {item.protection_threshold && (
                      <View style={[styles.protBadge, { backgroundColor: c.goldMuted }]}>
                        <ThemedText style={[styles.protBadgeText, { color: c.gold }]}>Top-{item.protection_threshold}</ThemedText>
                      </View>
                    )}
                    <Ionicons name="chevron-forward" size={16} color={c.secondaryText} />
                  </TouchableOpacity>
                )}
              />
            )
          )}

          {/* Step: Edit protection */}
          {step === 'protection_edit' && selectedPick && (
            <ScrollView contentContainerStyle={styles.editContainer}>
              <ThemedText type="defaultSemiBold" style={{ marginBottom: 4 }}>
                {formatPickLabel(selectedPick.season, selectedPick.round)}
              </ThemedText>
              <ThemedText style={[styles.pickSub, { color: c.secondaryText, marginBottom: 16 }]}>
                Owner: {teamNameMap[selectedPick.current_team_id] ?? '?'}
              </ThemedText>

              <NumberStepper
                label="Protection Threshold"
                value={protThreshold}
                onValueChange={setProtThreshold}
                min={1}
                max={teamCount - 1}
              />
              <ThemedText style={[styles.pickSub, { color: c.secondaryText, marginTop: 4, marginBottom: 16 }]}>
                If the pick lands in positions 1-{protThreshold}, it stays with the protected owner
              </ThemedText>

              <ThemedText style={[styles.pickSub, { marginBottom: 8 }]}>Protected Owner</ThemedText>
              {teams.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  accessibilityRole="button"
                  accessibilityLabel={t.name}
                  accessibilityState={{ selected: protOwnerId === t.id }}
                  style={[
                    styles.teamOption,
                    { borderColor: c.border },
                    protOwnerId === t.id && { backgroundColor: c.accent + '20', borderColor: c.accent },
                  ]}
                  onPress={() => setProtOwnerId(t.id)}
                >
                  <ThemedText style={{ fontSize: ms(14) }}>{t.name}</ThemedText>
                  {protOwnerId === t.id && <Ionicons name="checkmark" size={18} color={c.accent} />}
                </TouchableOpacity>
              ))}

              <View style={styles.editButtons}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={selectedPick.protection_threshold ? 'Update protection' : 'Add protection'}
                  accessibilityState={{ disabled: processing }}
                  style={[styles.actionBtn, { backgroundColor: c.accent }]}
                  onPress={handleSetProtection}
                  disabled={processing}
                >
                  {processing ? <ActivityIndicator color={c.statusText} /> : (
                    <ThemedText style={[styles.actionBtnText, { color: c.statusText }]}>
                      {selectedPick.protection_threshold ? 'Update Protection' : 'Add Protection'}
                    </ThemedText>
                  )}
                </TouchableOpacity>
                {selectedPick.protection_threshold && (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Remove protection"
                    accessibilityState={{ disabled: processing }}
                    style={[styles.actionBtn, { backgroundColor: c.danger }]}
                    onPress={() => Alert.alert('Remove Protection', 'Remove protection from this pick?', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Remove', style: 'destructive', onPress: handleRemoveProtection },
                    ])}
                    disabled={processing}
                  >
                    <ThemedText style={[styles.actionBtnText, { color: c.statusText }]}>Remove</ThemedText>
                  </TouchableOpacity>
                )}
              </View>
            </ScrollView>
          )}

          {/* Step: Swap management */}
          {step === 'swap_edit' && (
            <ScrollView contentContainerStyle={styles.editContainer}>
              <ThemedText accessibilityRole="header" type="defaultSemiBold" style={{ marginBottom: 12 }}>Create Swap</ThemedText>

              {/* Season selector */}
              <ThemedText style={[styles.pickSub, { marginBottom: 6 }]}>Season</ThemedText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12, flexGrow: 0 }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {validSeasons.map((s) => (
                    <TouchableOpacity
                      key={s}
                      accessibilityRole="button"
                      accessibilityLabel={`Season ${parseInt(s.split('-')[0], 10)}`}
                      accessibilityState={{ selected: swapSeason === s }}
                      style={[styles.pill, { backgroundColor: swapSeason === s ? c.accent : c.cardAlt, borderColor: swapSeason === s ? c.accent : c.border }]}
                      onPress={() => setSwapSeason(s)}
                    >
                      <ThemedText style={{ fontSize: ms(13), color: swapSeason === s ? c.accentText : c.text }}>
                        {parseInt(s.split('-')[0], 10)}
                      </ThemedText>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <NumberStepper label="Round" value={swapRound} onValueChange={setSwapRound} min={1} max={rookieDraftRounds} />

              {/* Beneficiary */}
              <ThemedText accessibilityRole="header" style={[styles.pickSub, { marginTop: 12, marginBottom: 6 }]}>Beneficiary (gets better pick)</ThemedText>
              {teams.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Beneficiary: ${t.name}`}
                  accessibilityState={{ selected: swapBeneficiary === t.id }}
                  style={[
                    styles.teamOption,
                    { borderColor: c.border },
                    swapBeneficiary === t.id && { backgroundColor: c.accent + '20', borderColor: c.accent },
                  ]}
                  onPress={() => setSwapBeneficiary(t.id)}
                >
                  <ThemedText style={{ fontSize: ms(13) }}>{t.name}</ThemedText>
                  {swapBeneficiary === t.id && <Ionicons name="checkmark" size={16} color={c.accent} />}
                </TouchableOpacity>
              ))}

              {/* Counterparty */}
              <ThemedText accessibilityRole="header" style={[styles.pickSub, { marginTop: 12, marginBottom: 6 }]}>Counterparty (gives up advantage)</ThemedText>
              {teams.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Counterparty: ${t.name}`}
                  accessibilityState={{ selected: swapCounterparty === t.id }}
                  style={[
                    styles.teamOption,
                    { borderColor: c.border },
                    swapCounterparty === t.id && { backgroundColor: c.accent + '20', borderColor: c.accent },
                  ]}
                  onPress={() => setSwapCounterparty(t.id)}
                >
                  <ThemedText style={{ fontSize: ms(13) }}>{t.name}</ThemedText>
                  {swapCounterparty === t.id && <Ionicons name="checkmark" size={16} color={c.accent} />}
                </TouchableOpacity>
              ))}

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Create swap"
                accessibilityState={{ disabled: processing }}
                style={[styles.actionBtn, { backgroundColor: c.accent, marginTop: 16 }]}
                onPress={handleCreateSwap}
                disabled={processing}
              >
                {processing ? <ActivityIndicator color={c.statusText} /> : (
                  <ThemedText style={[styles.actionBtnText, { color: c.statusText }]}>Create Swap</ThemedText>
                )}
              </TouchableOpacity>

              {/* Existing swaps */}
              {(existingSwaps ?? []).length > 0 && (
                <>
                  <ThemedText accessibilityRole="header" type="defaultSemiBold" style={{ marginTop: 20, marginBottom: 8 }}>
                    Existing Swaps
                  </ThemedText>
                  {existingSwaps!.map((sw) => (
                    <View key={sw.id} style={[styles.swapRow, { borderColor: c.border }]}>
                      <View style={{ flex: 1 }}>
                        <ThemedText style={{ fontSize: ms(13) }}>
                          {formatPickLabel(sw.season, sw.round)} swap
                        </ThemedText>
                        <ThemedText style={[styles.pickSub, { color: c.secondaryText }]}>
                          {teamNameMap[sw.beneficiary_team_id] ?? '?'} gets better vs {teamNameMap[sw.counterparty_team_id] ?? '?'}
                        </ThemedText>
                      </View>
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`Delete swap: ${formatPickLabel(sw.season, sw.round)}`}
                        onPress={() => Alert.alert('Delete Swap', 'Remove this swap?', [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Delete', style: 'destructive', onPress: () => handleDeleteSwap(sw.id) },
                        ])}
                      >
                        <Ionicons name="trash-outline" size={18} color={c.danger} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </>
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    maxHeight: '90%',
    minHeight: '50%',
    paddingBottom: s(32),
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: s(14),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: s(36) },
  headerTitle: { fontSize: ms(16), flex: 1, textAlign: 'center' },
  closeText: { fontSize: ms(18), padding: s(4) },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: s(40) },
  listContent: { paddingVertical: s(4) },
  chooseContainer: { padding: s(16), gap: s(12) },
  chooseBtn: {
    borderWidth: 1,
    borderRadius: 12,
    padding: s(16),
    gap: s(4),
  },
  chooseDesc: { fontSize: ms(12) },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(12),
    paddingHorizontal: s(16),
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: s(8),
  },
  pickSub: { fontSize: ms(12), fontWeight: '500' },
  protBadge: {
    borderRadius: 4,
    paddingHorizontal: s(5),
    paddingVertical: 1,
  },
  protBadgeText: { fontSize: ms(10), fontWeight: '600' },
  editContainer: { padding: s(16), paddingBottom: s(40) },
  editButtons: { flexDirection: 'row', gap: s(10), marginTop: s(20) },
  actionBtn: {
    flex: 1,
    paddingVertical: s(12),
    borderRadius: 8,
    alignItems: 'center',
  },
  actionBtnText: { fontSize: ms(15), fontWeight: '600' },
  teamOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: s(12),
    paddingVertical: s(10),
    marginBottom: s(6),
  },
  pill: {
    paddingHorizontal: s(14),
    paddingVertical: s(6),
    borderRadius: 16,
    borderWidth: 1,
  },
  swapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    padding: s(12),
    marginBottom: s(8),
    gap: s(8),
  },
});
