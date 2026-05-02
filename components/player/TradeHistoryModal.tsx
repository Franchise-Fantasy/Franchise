import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import {
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

import { TradeSideSummary } from '@/components/trade/TradeSideSummary';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { queryKeys } from '@/constants/queryKeys';
import { useColors } from '@/hooks/useColors';
import { TradeItemRow } from '@/hooks/useTrades';
import { supabase } from '@/lib/supabase';
import { ms, s } from '@/utils/scale';

interface TradeHistoryModalProps {
  transactionId: string;
  leagueId: string;
  onClose: () => void;
}

interface TradeSnapshot {
  date: string;
  items: TradeItemRow[];
  teamNames: Record<string, string>;
  /** All teams that participated, ordered for display */
  teams: { id: string; name: string }[];
  playerHeadshotMap: Record<string, string | null>;
}

function itemKey(item: TradeItemRow): string {
  if (item.player_id) return `p:${item.player_id}:${item.from_team_id}:${item.to_team_id}`;
  if (item.pick_swap_season) return `sw:${item.pick_swap_season}:${item.pick_swap_round}:${item.from_team_id}`;
  if (item.draft_pick_id) return `pk:${item.draft_pick_id}:${item.from_team_id}:${item.to_team_id}`;
  return item.id;
}

function useTradeByTransaction(transactionId: string, leagueId: string) {
  return useQuery({
    queryKey: queryKeys.tradeByTransaction(transactionId),
    queryFn: async (): Promise<TradeSnapshot | null> => {
      // Find the trade proposal linked to this transaction
      const { data: proposal } = await supabase
        .from('trade_proposals')
        .select('id, completed_at')
        .eq('transaction_id', transactionId)
        .eq('league_id', leagueId)
        .maybeSingle();

      if (!proposal) return null;

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
          players ( name, position, pro_team ),
          draft_picks ( season, round, original_team_id )
        `)
        .eq('proposal_id', proposal.id);

      if (!rawItems || rawItems.length === 0) return null;

      // Collect all team IDs (participants + via-original) to resolve names
      const teamIds = new Set<string>();
      const origTeamIds = new Set<string>();
      for (const item of rawItems) {
        teamIds.add(item.from_team_id);
        teamIds.add(item.to_team_id);
        const dp = Array.isArray(item.draft_picks) ? item.draft_picks[0] : item.draft_picks;
        if (dp?.original_team_id) origTeamIds.add(dp.original_team_id);
      }
      for (const id of origTeamIds) teamIds.add(id);

      const { data: teams } = await supabase
        .from('teams')
        .select('id, name')
        .in('id', Array.from(teamIds));

      const teamNames: Record<string, string> = {};
      for (const t of teams ?? []) teamNames[t.id] = t.name;

      // Headshot fetch: only for players actually in this trade.
      const playerIds = rawItems
        .map((i) => i.player_id)
        .filter((id): id is string => !!id);
      const playerHeadshotMap: Record<string, string | null> = {};
      if (playerIds.length > 0) {
        const { data: stats } = await supabase
          .from('player_season_stats')
          .select('player_id, external_id_nba')
          .in('player_id', playerIds);
        for (const row of stats ?? []) {
          if (row.player_id) playerHeadshotMap[row.player_id] = row.external_id_nba ?? null;
        }
      }

      // Reshape into TradeItemRow so we can hand it to TradeSideSummary —
      // single shared receives chrome across every trade surface.
      const items: TradeItemRow[] = rawItems.map((item) => {
        const player = Array.isArray(item.players) ? item.players[0] : item.players;
        const dp = Array.isArray(item.draft_picks) ? item.draft_picks[0] : item.draft_picks;

        return {
          id: item.id,
          player_id: item.player_id,
          draft_pick_id: item.draft_pick_id,
          from_team_id: item.from_team_id,
          to_team_id: item.to_team_id,
          player_name: player?.name ?? null,
          player_position: player?.position ?? null,
          player_pro_team: player?.pro_team ?? null,
          pick_season: dp?.season ?? null,
          pick_round: dp?.round ?? null,
          pick_original_team_name: dp?.original_team_id
            ? (teamNames[dp.original_team_id] ?? null)
            : null,
          protection_threshold: item.protection_threshold,
          pick_swap_season: item.pick_swap_season,
          pick_swap_round: item.pick_swap_round,
        };
      });

      // Order participants by who shows up first as a receiver
      const participantIds: string[] = [];
      for (const item of items) {
        if (!participantIds.includes(item.to_team_id)) participantIds.push(item.to_team_id);
      }
      // Backfill any team that didn't receive (rare)
      for (const item of items) {
        if (!participantIds.includes(item.from_team_id)) participantIds.push(item.from_team_id);
      }

      return {
        date: proposal.completed_at ?? '',
        items,
        teamNames,
        teams: participantIds.map((id) => ({ id, name: teamNames[id] ?? 'Unknown' })),
        playerHeadshotMap,
      };
    },
    staleTime: 1000 * 60 * 30,
  });
}

/**
 * Per-player trade history modal — shown from PlayerDetail when the player
 * was moved in a historical trade. Reuses `TradeSideSummary` so the
 * receives blocks read identical to the trades list, league history, and
 * detail modal.
 */
export function TradeHistoryModal({ transactionId, leagueId, onClose }: TradeHistoryModalProps) {
  const c = useColors();
  const { data: trade, isLoading } = useTradeByTransaction(transactionId, leagueId);

  // Group items by receiving team for the receives blocks.
  const receivedByTeam: Record<string, TradeItemRow[]> = {};
  if (trade) {
    for (const t of trade.teams) receivedByTeam[t.id] = [];
    for (const item of trade.items) {
      if (receivedByTeam[item.to_team_id]) {
        receivedByTeam[item.to_team_id].push(item);
      }
    }
  }
  const isMultiTeam = (trade?.teams.length ?? 0) > 2;

  return (
    <Modal visible animationType="fade" transparent>
      <View style={styles.overlay}>
        <View
          style={[styles.sheet, { backgroundColor: c.background, borderColor: c.border }]}
          accessibilityViewIsModal
        >
          {/* Header — gold-rule eyebrow + Alfa Slab title rhythm. */}
          <View style={[styles.header, { borderBottomColor: c.border }]}>
            <View style={styles.headerLeft}>
              <View style={styles.eyebrowRow}>
                <View style={[styles.eyebrowRule, { backgroundColor: c.gold }]} />
                <ThemedText
                  type="varsitySmall"
                  style={[styles.eyebrow, { color: c.gold }]}
                >
                  Trade
                </ThemedText>
              </View>
              <ThemedText
                accessibilityRole="header"
                type="defaultSemiBold"
                style={[styles.title, { color: c.text }]}
              >
                {trade?.date
                  ? new Date(trade.date).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  : 'Trade Details'}
              </ThemedText>
            </View>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close trade details"
              style={styles.closeBtn}
            >
              <Ionicons name="close" size={22} color={c.icon} accessible={false} />
            </TouchableOpacity>
          </View>

          {isLoading ? (
            <View style={styles.loader}>
              <LogoSpinner />
            </View>
          ) : !trade ? (
            <View style={styles.emptyWrap}>
              <ThemedText style={{ color: c.secondaryText }}>
                Trade details not available
              </ThemedText>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.content}>
              {trade.teams.map((t) => (
                <TradeSideSummary
                  key={t.id}
                  teamId={t.id}
                  teamName={t.name}
                  receivedItems={receivedByTeam[t.id] ?? []}
                  playerFptsMap={{}}
                  playerHeadshotMap={trade.playerHeadshotMap}
                  newItemKeys={new Set()}
                  itemKeyFn={itemKey}
                  teamNameMap={trade.teamNames}
                  isMultiTeam={isMultiTeam}
                />
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(20, 16, 16, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: s(20),
  },
  sheet: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    width: '100%',
    maxHeight: '75%',
    overflow: 'hidden',
  },

  // Header — gold-rule "TRADE" eyebrow + Alfa Slab date.
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: s(16),
    paddingVertical: s(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: {
    flex: 1,
    gap: s(4),
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  eyebrowRule: { height: 2, width: s(14) },
  eyebrow: {
    fontSize: ms(9),
    letterSpacing: 1.4,
  },
  title: {
    fontSize: ms(15),
  },
  closeBtn: {
    padding: s(4),
  },

  loader: {
    paddingVertical: s(40),
  },
  emptyWrap: {
    paddingVertical: s(32),
    alignItems: 'center',
  },
  content: {
    padding: s(16),
    gap: s(10),
  },
});
