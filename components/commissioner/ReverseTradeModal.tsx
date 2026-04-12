import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { TradeProposalRow, useTradeProposals } from '@/hooks/useTrades';
import { supabase } from '@/lib/supabase';
import { ms, s } from '@/utils/scale';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LogoSpinner } from '@/components/ui/LogoSpinner';

interface Props {
  visible: boolean;
  leagueId: string;
  onClose: () => void;
}

export function ReverseTradeModal({ visible, leagueId, onClose }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<TradeProposalRow | null>(null);
  const [processing, setProcessing] = useState(false);

  const { data: proposals, isLoading } = useTradeProposals(visible ? leagueId : null);
  const completedTrades = (proposals ?? []).filter((p) => p.status === 'completed');

  function handleClose() {
    setSelected(null);
    onClose();
  }

  async function handleReverse() {
    if (!selected) return;
    Alert.alert(
      'Reverse Trade',
      'Are you sure? Players and picks will be returned to their original teams.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reverse',
          style: 'destructive',
          onPress: async () => {
            setProcessing(true);
            try {
              const { data, error } = await supabase.functions.invoke('reverse-trade', {
                body: { proposal_id: selected.id },
              });
              if (error) throw new Error(error.message);

              const warnings: string[] = data?.warnings ?? [];
              const msg = warnings.length > 0
                ? `Trade reversed.\n\nWarnings:\n${warnings.join('\n')}`
                : 'Trade reversed successfully.';

              Alert.alert('Done', msg);
              queryClient.invalidateQueries({ queryKey: ['tradeProposals'] });
              queryClient.invalidateQueries({ queryKey: ['teamRoster'] });
              queryClient.invalidateQueries({ queryKey: ['allPlayers'] });
              queryClient.invalidateQueries({ queryKey: ['transactions'] });
              queryClient.invalidateQueries({ queryKey: ['tradablePicks'] });
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

  function formatTradeDate(dateStr: string | null) {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // Group items by from_team for display
  function renderTradeItems(trade: TradeProposalRow) {
    const teamNames = new Map<string, string>();
    trade.teams.forEach((t) => teamNames.set(t.team_id, t.team_name));

    return trade.items.map((item, idx) => {
      const asset = item.player_name
        ?? (item.pick_season ? `${item.pick_season} Rd ${item.pick_round}${item.pick_original_team_name ? ` (${item.pick_original_team_name})` : ''}` : 'Unknown');
      const from = teamNames.get(item.from_team_id) ?? 'Unknown';
      const to = teamNames.get(item.to_team_id) ?? 'Unknown';
      return (
        <ThemedText key={idx} style={styles.itemText}>
          {asset}: {from} → {to}
        </ThemedText>
      );
    });
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={[styles.content, { backgroundColor: c.card }]} accessibilityViewIsModal={true}>
          <View style={styles.header}>
            <ThemedText accessibilityRole="header" type="subtitle">Reverse Trade</ThemedText>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" onPress={handleClose}>
              <Ionicons name="close" size={24} color={c.text} />
            </TouchableOpacity>
          </View>

          {selected ? (
            <View style={{ flex: 1 }}>
              <ThemedText style={[styles.subtitle, { color: c.secondaryText }]}>
                Completed {formatTradeDate(selected.completed_at)}
              </ThemedText>
              <View style={[styles.detailBox, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
                {renderTradeItems(selected)}
              </View>
              <ThemedText style={[styles.warning, { color: c.secondaryText }]}>
                Players that have since been dropped or re-traded will be skipped.
              </ThemedText>
              <View style={styles.buttons}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Back"
                  style={[styles.btn, { backgroundColor: c.cardAlt }]}
                  onPress={() => setSelected(null)}
                >
                  <ThemedText>Back</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Reverse trade"
                  accessibilityState={{ disabled: processing }}
                  style={[styles.btn, { backgroundColor: processing ? c.buttonDisabled : c.danger }]}
                  onPress={handleReverse}
                  disabled={processing}
                >
                  {processing
                    ? <LogoSpinner size={18} />
                    : <Text style={{ color: c.statusText, fontWeight: '600' }}>Reverse Trade</Text>}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <>
              {isLoading ? (
                <View style={{ marginTop: s(20) }}><LogoSpinner /></View>
              ) : completedTrades.length === 0 ? (
                <ThemedText style={[styles.empty, { color: c.secondaryText }]}>
                  No completed trades to reverse.
                </ThemedText>
              ) : (
                <FlatList
                  data={completedTrades}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item, index }) => {
                    const teamList = item.teams.map((t) => t.team_name).join(' & ');
                    return (
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`Trade: ${teamList}, ${formatTradeDate(item.completed_at)}, ${item.items.length} item${item.items.length !== 1 ? 's' : ''}`}
                        style={[styles.tradeRow, { borderBottomColor: c.border }, index === completedTrades.length - 1 && { borderBottomWidth: 0 }]}
                        onPress={() => setSelected(item)}
                      >
                        <View style={{ flex: 1 }}>
                          <ThemedText style={{ fontWeight: '600' }}>{teamList}</ThemedText>
                          <ThemedText style={[styles.tradeDate, { color: c.secondaryText }]}>
                            {formatTradeDate(item.completed_at)} · {item.items.length} item{item.items.length !== 1 ? 's' : ''}
                          </ThemedText>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={c.secondaryText} />
                      </TouchableOpacity>
                    );
                  }}
                />
              )}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  content: { borderTopLeftRadius: 14, borderTopRightRadius: 14, padding: s(20), paddingBottom: s(32), minHeight: '60%', maxHeight: '92%', overflow: 'hidden' as const },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: s(16) },
  subtitle: { fontSize: ms(13), marginBottom: s(12) },
  detailBox: { borderWidth: 1, borderRadius: 8, padding: s(12), marginBottom: s(12) },
  itemText: { fontSize: ms(14), lineHeight: ms(22) },
  warning: { fontSize: ms(12), fontStyle: 'italic', marginBottom: s(16) },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: s(10) },
  btn: { paddingHorizontal: s(16), paddingVertical: s(10), borderRadius: 8, alignItems: 'center', minWidth: s(80) },
  tradeRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: s(12), borderBottomWidth: StyleSheet.hairlineWidth },
  tradeDate: { fontSize: ms(12), marginTop: s(2) },
  empty: { textAlign: 'center', marginTop: s(24), fontSize: ms(14) },
});
