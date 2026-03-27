import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { formatPickLabel } from '@/types/trade';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

interface TradeHistoryModalProps {
  transactionId: string;
  leagueId: string;
  onClose: () => void;
}

interface TradeSummaryItem {
  id: string;
  playerName: string | null;
  playerPosition: string | null;
  pickSeason: string | null;
  pickRound: number | null;
  pickOriginalTeamName: string | null;
  protectionThreshold: number | null;
  pickSwapSeason: string | null;
  pickSwapRound: number | null;
  fromTeamName: string;
  toTeamName: string;
}

function useTradeByTransaction(transactionId: string, leagueId: string) {
  return useQuery({
    queryKey: ['tradeByTransaction', transactionId],
    queryFn: async (): Promise<{
      date: string;
      items: TradeSummaryItem[];
      teamNames: Record<string, string>;
    } | null> => {
      // Find the trade proposal linked to this transaction
      const { data: proposal } = await supabase
        .from('trade_proposals')
        .select('id, completed_at')
        .eq('transaction_id', transactionId)
        .eq('league_id', leagueId)
        .maybeSingle();

      if (!proposal) return null;

      // Fetch all items with joined data
      const { data: rawItems } = await supabase
        .from('trade_proposal_items')
        .select(`
          id,
          player_id,
          draft_pick_id,
          from_team_id,
          to_team_id,
          protection_threshold,
          pick_swap_season,
          pick_swap_round,
          players ( name, position ),
          draft_picks ( season, round, original_team_id )
        `)
        .eq('proposal_id', proposal.id);

      if (!rawItems || rawItems.length === 0) return null;

      // Collect all team IDs to resolve names
      const teamIds = new Set<string>();
      const origTeamIds = new Set<string>();
      for (const item of rawItems) {
        teamIds.add(item.from_team_id);
        teamIds.add(item.to_team_id);
        const dp = Array.isArray(item.draft_picks) ? item.draft_picks[0] : item.draft_picks;
        if (dp?.original_team_id) origTeamIds.add(dp.original_team_id);
      }
      // Also add original team IDs so we can resolve "via X"
      for (const id of origTeamIds) teamIds.add(id);

      const { data: teams } = await supabase
        .from('teams')
        .select('id, name')
        .in('id', Array.from(teamIds));

      const teamNames: Record<string, string> = {};
      for (const t of teams ?? []) teamNames[t.id] = t.name;

      const items: TradeSummaryItem[] = rawItems.map((item) => {
        const player = Array.isArray(item.players) ? item.players[0] : item.players;
        const dp = Array.isArray(item.draft_picks) ? item.draft_picks[0] : item.draft_picks;

        return {
          id: item.id,
          playerName: player?.name ?? null,
          playerPosition: player?.position ?? null,
          pickSeason: dp?.season ?? null,
          pickRound: dp?.round ?? null,
          pickOriginalTeamName: dp?.original_team_id ? (teamNames[dp.original_team_id] ?? null) : null,
          protectionThreshold: item.protection_threshold,
          pickSwapSeason: item.pick_swap_season,
          pickSwapRound: item.pick_swap_round,
          fromTeamName: teamNames[item.from_team_id] ?? 'Unknown',
          toTeamName: teamNames[item.to_team_id] ?? 'Unknown',
        };
      });

      return { date: proposal.completed_at ?? '', items, teamNames };
    },
    staleTime: 1000 * 60 * 30,
  });
}

export function TradeHistoryModal({ transactionId, leagueId, onClose }: TradeHistoryModalProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { data: trade, isLoading } = useTradeByTransaction(transactionId, leagueId);

  // Group items by from_team
  const groupedByFrom: Record<string, TradeSummaryItem[]> = {};
  for (const item of trade?.items ?? []) {
    const key = item.fromTeamName;
    if (!groupedByFrom[key]) groupedByFrom[key] = [];
    groupedByFrom[key].push(item);
  }
  const isMultiTeam = Object.keys(groupedByFrom).length > 2;

  return (
    <Modal visible animationType="fade" transparent>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: c.background }]} accessibilityViewIsModal>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: c.border }]}>
            <View style={styles.headerTitleRow}>
              <View style={[styles.iconCircle, { backgroundColor: c.cardAlt }]}>
                <Ionicons name="swap-horizontal" size={18} color={c.accent} accessibilityElementsHidden />
              </View>
              <View>
                <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.headerTitle}>
                  Trade Details
                </ThemedText>
                {trade?.date ? (
                  <ThemedText style={[styles.dateText, { color: c.secondaryText }]}>
                    {new Date(trade.date).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </ThemedText>
                ) : null}
              </View>
            </View>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close trade details"
            >
              <ThemedText style={styles.closeText}>✕</ThemedText>
            </TouchableOpacity>
          </View>

          {isLoading ? (
            <ActivityIndicator style={styles.loader} />
          ) : !trade ? (
            <View style={styles.emptyWrap}>
              <ThemedText style={{ color: c.secondaryText }}>Trade details not available</ThemedText>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.content}>
              {Object.entries(groupedByFrom).map(([teamName, items]) => (
                <View key={teamName} style={styles.tradeSummaryGroup}>
                  <ThemedText
                    accessibilityRole="header"
                    style={[styles.tradeSummaryTeam, { color: c.text }]}
                    numberOfLines={1}
                  >
                    {teamName} sends:
                  </ThemedText>
                  {items.map((item) => {
                    const toSuffix = isMultiTeam ? ` → ${item.toTeamName}` : '';
                    return (
                      <ThemedText
                        key={item.id}
                        style={[styles.assetText, { color: c.secondaryText }]}
                        numberOfLines={1}
                        accessibilityLabel={formatItemLabel(item)}
                      >
                        {'  •  '}{formatItemText(item)}{toSuffix}
                      </ThemedText>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function formatItemText(item: TradeSummaryItem): string {
  if (item.playerName) {
    return `${item.playerName} (${item.playerPosition ?? '?'})`;
  }
  if (item.pickSwapSeason && item.pickSwapRound) {
    return `${formatPickLabel(item.pickSwapSeason, item.pickSwapRound)} swap`;
  }
  if (item.pickSeason && item.pickRound) {
    let label = formatPickLabel(item.pickSeason, item.pickRound);
    if (item.protectionThreshold) label += ` [Top-${item.protectionThreshold} protected]`;
    if (item.pickOriginalTeamName) label += ` (via ${item.pickOriginalTeamName})`;
    return label;
  }
  return 'Unknown asset';
}

function formatItemLabel(item: TradeSummaryItem): string {
  return `${formatItemText(item)} to ${item.toTeamName}`;
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sheet: {
    borderRadius: 16,
    width: '100%',
    maxHeight: '70%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  closeText: {
    fontSize: 18,
    fontWeight: '600',
  },
  loader: {
    paddingVertical: 40,
  },
  emptyWrap: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  content: {
    padding: 16,
  },
  tradeSummaryGroup: {
    marginTop: 4,
  },
  tradeSummaryTeam: {
    fontSize: 12,
    fontWeight: '600',
  },
  assetText: {
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18,
  },
  dateText: {
    fontSize: 12,
  },
});
