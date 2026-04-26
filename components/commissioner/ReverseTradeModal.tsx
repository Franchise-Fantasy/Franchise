import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Alert,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { BrandButton } from '@/components/ui/BrandButton';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { useConfirm } from '@/context/ConfirmProvider';
import { useColors } from '@/hooks/useColors';
import { TradeProposalRow, useTradeProposals } from '@/hooks/useTrades';
import { supabase } from '@/lib/supabase';
import { ms, s } from '@/utils/scale';

interface Props {
  visible: boolean;
  leagueId: string;
  onClose: () => void;
}

export function ReverseTradeModal({ visible, leagueId, onClose }: Props) {
  const c = useColors();
  const confirm = useConfirm();
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
    confirm({
      title: 'Reverse Trade',
      message: 'Are you sure? Players and picks will be returned to their original teams.',
      action: {
        label: 'Reverse',
        destructive: true,
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
    });
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
    <BottomSheet
      visible={visible}
      onClose={handleClose}
      title="Reverse Trade"
      height="92%"
      footer={
        selected ? (
          <View style={styles.footer}>
            <BrandButton
              label="Back"
              variant="secondary"
              size="large"
              onPress={() => setSelected(null)}
              fullWidth
              style={styles.footerBtn}
              accessibilityLabel="Back to trade list"
            />
            <BrandButton
              label="Reverse Trade"
              variant="primary"
              size="large"
              onPress={handleReverse}
              loading={processing}
              fullWidth
              style={styles.footerBtn}
              accessibilityLabel="Reverse trade"
            />
          </View>
        ) : null
      }
      scrollableBody={!!selected || completedTrades.length === 0}
    >
      {selected ? (
        <View>
          <ThemedText style={[styles.subtitle, { color: c.secondaryText }]}>
            Completed {formatTradeDate(selected.completed_at)}
          </ThemedText>
          <View style={[styles.detailBox, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
            {renderTradeItems(selected)}
          </View>
          <ThemedText style={[styles.warning, { color: c.secondaryText }]}>
            Players that have since been dropped or re-traded will be skipped.
          </ThemedText>
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
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  subtitle: { fontSize: ms(13), marginBottom: s(12) },
  detailBox: { borderWidth: 1, borderRadius: 8, padding: s(12), marginBottom: s(12) },
  itemText: { fontSize: ms(14), lineHeight: ms(22) },
  warning: { fontSize: ms(12), fontStyle: 'italic', marginBottom: s(16) },
  tradeRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: s(12), borderBottomWidth: StyleSheet.hairlineWidth },
  tradeDate: { fontSize: ms(12), marginTop: s(2) },
  empty: { textAlign: 'center', marginTop: s(24), fontSize: ms(14) },
  footer: { flexDirection: 'row', gap: s(12) },
  footerBtn: { flex: 1 },
});
