import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { PlayerSeasonStats } from '@/types/player';
import { getInjuryBadge } from '@/utils/injuryBadge';
import { isEligibleForSlot, SLOT_LABELS } from '@/utils/rosterSlots';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

interface Props {
  visible: boolean;
  leagueId: string;
  teams: Array<{ id: string; name: string }>;
  onClose: () => void;
}

type Step = 'team' | 'player' | 'slot';

interface RosterPlayer extends PlayerSeasonStats {
  roster_slot: string;
}

export function ForceRosterMoveModal({ visible, leagueId, teams, onClose }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>('team');
  const [selectedTeam, setSelectedTeam] = useState<{ id: string; name: string } | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<RosterPlayer | null>(null);
  const [processing, setProcessing] = useState(false);

  function handleClose() {
    setStep('team');
    setSelectedTeam(null);
    setSelectedPlayer(null);
    onClose();
  }

  function goBack() {
    if (step === 'slot') { setStep('player'); setSelectedPlayer(null); }
    else if (step === 'player') { setStep('team'); setSelectedTeam(null); }
    else handleClose();
  }

  // Fetch team roster with slots
  const { data: roster, isLoading } = useQuery<RosterPlayer[]>({
    queryKey: ['commishRosterMove', selectedTeam?.id, leagueId],
    queryFn: async () => {
      const { data: lp, error: lpErr } = await supabase
        .from('league_players')
        .select('player_id, roster_slot, position')
        .eq('team_id', selectedTeam!.id)
        .eq('league_id', leagueId);
      if (lpErr) throw lpErr;
      if (!lp || lp.length === 0) return [];

      const ids = lp.map((p) => p.player_id);
      const { data, error } = await supabase
        .from('player_season_stats')
        .select('*')
        .in('player_id', ids);
      if (error) throw error;

      const slotMap = new Map(lp.map((p) => [p.player_id, p.roster_slot]));
      return (data ?? []).map((p: any) => ({
        ...p,
        roster_slot: slotMap.get(p.player_id) ?? 'BE',
      }));
    },
    enabled: !!selectedTeam && step !== 'team',
  });

  // Get available slots for the selected player
  const availableSlots = selectedPlayer
    ? Object.keys(SLOT_LABELS).filter(
        (slot) => isEligibleForSlot(selectedPlayer.position, slot) && slot !== selectedPlayer.roster_slot
      )
    : [];

  async function handleMoveToSlot(targetSlot: string) {
    if (!selectedPlayer || !selectedTeam) return;
    Alert.alert(
      'Force Roster Move',
      `Move ${selectedPlayer.name} from ${SLOT_LABELS[selectedPlayer.roster_slot] ?? selectedPlayer.roster_slot} to ${SLOT_LABELS[targetSlot] ?? targetSlot}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            setProcessing(true);
            try {
              const { error } = await supabase.functions.invoke('commissioner-action', {
                body: {
                  action: 'force_move',
                  league_id: leagueId,
                  team_id: selectedTeam.id,
                  player_id: selectedPlayer.player_id,
                  target_slot: targetSlot,
                },
              });
              if (error) throw new Error(error.message);

              Alert.alert('Done', `${selectedPlayer.name} moved to ${SLOT_LABELS[targetSlot] ?? targetSlot}.`);
              queryClient.invalidateQueries({ queryKey: ['teamRoster'] });
              queryClient.invalidateQueries({ queryKey: ['transactions'] });
              queryClient.invalidateQueries({ queryKey: ['commishRosterMove'] });
              handleClose();
            } catch (e: any) {
              Alert.alert('Error', e.message);
            } finally {
              setProcessing(false);
            }
          },
        },
      ]
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={[styles.content, { backgroundColor: c.card }]}>
          <View style={styles.header}>
            <TouchableOpacity onPress={goBack}>
              <Ionicons name={step === 'team' ? 'close' : 'arrow-back'} size={24} color={c.text} />
            </TouchableOpacity>
            <ThemedText type="subtitle">
              {step === 'team' ? 'Select Team' : step === 'player' ? selectedTeam?.name : selectedPlayer?.name}
            </ThemedText>
            <View style={{ width: 24 }} />
          </View>

          {step === 'team' && (
            <FlatList
              data={teams}
              keyExtractor={(t) => t.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.row, { borderBottomColor: c.border }]}
                  onPress={() => { setSelectedTeam(item); setStep('player'); }}
                >
                  <ThemedText>{item.name}</ThemedText>
                  <Ionicons name="chevron-forward" size={18} color={c.secondaryText} />
                </TouchableOpacity>
              )}
            />
          )}

          {step === 'player' && (
            <>
              {isLoading ? (
                <ActivityIndicator style={{ marginTop: 20 }} />
              ) : !roster || roster.length === 0 ? (
                <ThemedText style={[styles.empty, { color: c.secondaryText }]}>No players on roster.</ThemedText>
              ) : (
                <FlatList
                  data={roster}
                  keyExtractor={(p) => p.player_id}
                  renderItem={({ item }) => {
                    const badge = getInjuryBadge(item.status);
                    return (
                      <TouchableOpacity
                        style={[styles.row, { borderBottomColor: c.border }]}
                        onPress={() => { setSelectedPlayer(item); setStep('slot'); }}
                      >
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <ThemedText style={{ fontWeight: '600' }}>{item.name}</ThemedText>
                            {badge && (
                              <View style={[styles.badge, { backgroundColor: badge.color + '22' }]}>
                                <Text style={{ color: badge.color, fontSize: 10, fontWeight: '700' }}>{badge.label}</Text>
                              </View>
                            )}
                          </View>
                          <ThemedText style={[styles.sub, { color: c.secondaryText }]}>
                            {item.position} · {item.nba_team}
                          </ThemedText>
                        </View>
                        <View style={[styles.slotBadge, { backgroundColor: c.cardAlt }]}>
                          <ThemedText style={{ fontSize: 12, fontWeight: '600' }}>
                            {SLOT_LABELS[item.roster_slot] ?? item.roster_slot}
                          </ThemedText>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={c.secondaryText} style={{ marginLeft: 8 }} />
                      </TouchableOpacity>
                    );
                  }}
                />
              )}
            </>
          )}

          {step === 'slot' && (
            <>
              <ThemedText style={[styles.slotHeader, { color: c.secondaryText }]}>
                Current: {SLOT_LABELS[selectedPlayer?.roster_slot ?? ''] ?? selectedPlayer?.roster_slot}
              </ThemedText>
              {availableSlots.length === 0 ? (
                <ThemedText style={[styles.empty, { color: c.secondaryText }]}>
                  No other eligible slots.
                </ThemedText>
              ) : (
                <FlatList
                  data={availableSlots}
                  keyExtractor={(s) => s}
                  renderItem={({ item: slot }) => (
                    <TouchableOpacity
                      style={[styles.row, { borderBottomColor: c.border }]}
                      onPress={() => handleMoveToSlot(slot)}
                      disabled={processing}
                    >
                      <ThemedText style={{ fontWeight: '600' }}>{SLOT_LABELS[slot] ?? slot}</ThemedText>
                    </TouchableOpacity>
                  )}
                />
              )}
            </>
          )}

          {processing && (
            <View style={styles.processingOverlay}>
              <ActivityIndicator size="large" />
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  content: { borderTopLeftRadius: 14, borderTopRightRadius: 14, padding: 20, paddingBottom: 32, minHeight: '60%', maxHeight: '92%', overflow: 'hidden' as const },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  sub: { fontSize: 12, marginTop: 2 },
  badge: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  slotBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  slotHeader: { fontSize: 13, marginBottom: 12 },
  empty: { textAlign: 'center', marginTop: 24, fontSize: 14 },
  processingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center', borderRadius: 16 },
});
