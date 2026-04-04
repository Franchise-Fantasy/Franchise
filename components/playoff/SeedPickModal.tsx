import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useSeedPicks } from '@/hooks/usePlayoffBracket';
import { supabase } from '@/lib/supabase';
import { PlayoffSeedPick } from '@/types/playoff';
import { ms, s } from '@/utils/scale';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

interface Props {
  visible: boolean;
  onClose: () => void;
  pick: PlayoffSeedPick;
  teamMap: Map<string, string>;
  season: string;
}

export function SeedPickModal({ visible, onClose, pick, teamMap, season }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { leagueId } = useAppState();
  const [submitting, setSubmitting] = useState(false);
  const [selectedOpponent, setSelectedOpponent] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: allPicks } = useSeedPicks(season, pick.round, true);

  // Determine available opponents: those not already picked by others
  const takenOpponentIds = new Set(
    (allPicks ?? [])
      .filter((p) => p.picked_opponent_id !== null)
      .map((p) => p.picked_opponent_id!),
  );

  // All teams in the picking round that are NOT picking (they are potential opponents)
  // Opponents are teams with picks that have a picking_team_id different from any picker's team
  const pickerTeamIds = new Set((allPicks ?? []).map((p) => p.picking_team_id));
  const allTeamIds = [...teamMap.keys()];
  const availableOpponents = allTeamIds.filter(
    (tid) =>
      !pickerTeamIds.has(tid) && // Not a picker (lower seed)
      !takenOpponentIds.has(tid), // Not already chosen
  );

  // Check if it's our turn (all higher seeds must have picked)
  const higherSeedPicks = (allPicks ?? []).filter((p) => p.picking_seed < pick.picking_seed);
  const isOurTurn = higherSeedPicks.every((p) => p.picked_opponent_id !== null);

  const handleSubmit = async () => {
    if (!selectedOpponent || !leagueId) return;
    setSubmitting(true);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      Alert.alert('Not logged in');
      setSubmitting(false);
      return;
    }

    const res = await supabase.functions.invoke('submit-seed-pick', {
      body: {
        league_id: leagueId,
        round: pick.round,
        opponent_team_id: selectedOpponent,
      },
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    setSubmitting(false);

    if (res.error) {
      Alert.alert('Error', res.error.message ?? 'Failed to submit pick.');
      return;
    }

    // Invalidate queries
    queryClient.invalidateQueries({ queryKey: ['seedPicks'] });
    queryClient.invalidateQueries({ queryKey: ['pendingSeedPick'] });
    queryClient.invalidateQueries({ queryKey: ['playoffBracket'] });
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: c.background, borderColor: c.border }]} accessibilityViewIsModal={true}>
          <ThemedText accessibilityRole="header" type="subtitle" style={styles.title}>
            Pick Your Opponent
          </ThemedText>
          <ThemedText style={[styles.subtitle, { color: c.secondaryText }]}>
            You are seed #{pick.picking_seed} — Round {pick.round}
          </ThemedText>

          {!isOurTurn ? (
            <View style={styles.waitingBox}>
              <ActivityIndicator style={{ marginBottom: 8 }} />
              <ThemedText style={{ color: c.secondaryText, textAlign: 'center' }}>
                Waiting for higher seeds to pick...
              </ThemedText>
            </View>
          ) : (
            <>
              {availableOpponents.length === 0 ? (
                <ThemedText style={[styles.noOpponents, { color: c.secondaryText }]}>
                  No opponents available yet.
                </ThemedText>
              ) : (
                availableOpponents.map((tid) => {
                  const isSelected = selectedOpponent === tid;
                  return (
                    <TouchableOpacity
                      key={tid}
                      accessibilityRole="button"
                      accessibilityLabel={teamMap.get(tid) ?? 'Unknown'}
                      accessibilityState={{ selected: isSelected }}
                      style={[
                        styles.opponentRow,
                        { borderColor: c.border },
                        isSelected && { borderColor: c.accent, backgroundColor: c.accent + '15' },
                      ]}
                      onPress={() => setSelectedOpponent(tid)}
                    >
                      <ThemedText style={[styles.opponentName, isSelected && { color: c.accent }]}>
                        {teamMap.get(tid) ?? 'Unknown'}
                      </ThemedText>
                    </TouchableOpacity>
                  );
                })
              )}

              <View style={styles.actions}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                  onPress={onClose}
                  style={[styles.btn, { borderColor: c.border }]}
                >
                  <Text style={[styles.btnText, { color: c.text }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Confirm opponent selection"
                  accessibilityState={{ disabled: !selectedOpponent || submitting }}
                  onPress={handleSubmit}
                  disabled={!selectedOpponent || submitting}
                  style={[
                    styles.btn,
                    {
                      backgroundColor:
                        selectedOpponent && !submitting ? c.accent : c.buttonDisabled,
                    },
                  ]}
                >
                  {submitting ? (
                    <ActivityIndicator color={c.accentText} size="small" />
                  ) : (
                    <Text style={[styles.btnText, { color: c.accentText }]}>Confirm</Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sheet: {
    width: '85%',
    maxHeight: '70%',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: s(20),
  },
  title: {
    marginBottom: s(4),
  },
  subtitle: {
    fontSize: ms(13),
    marginBottom: s(16),
  },
  waitingBox: {
    paddingVertical: s(24),
    alignItems: 'center',
  },
  noOpponents: {
    textAlign: 'center',
    paddingVertical: s(16),
  },
  opponentRow: {
    borderWidth: 1,
    borderRadius: 8,
    padding: s(14),
    marginBottom: s(8),
  },
  opponentName: {
    fontSize: ms(15),
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: s(12),
    marginTop: s(16),
  },
  btn: {
    paddingVertical: s(10),
    paddingHorizontal: s(20),
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  btnText: {
    fontSize: ms(15),
    fontWeight: '600',
  },
});
