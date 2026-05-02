import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { TradeSideSummary } from '@/components/trade/TradeSideSummary';
import { TradeStatusBadge } from '@/components/trade/TradeStatusBadge';
import { Badge } from '@/components/ui/Badge';
import { ThemedText } from '@/components/ui/ThemedText';
import { cardShadow } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { TradeItemRow, TradeProposalRow } from '@/hooks/useTrades';
import { ms, s } from '@/utils/scale';

interface TradeCardProps {
  proposal: TradeProposalRow;
  onPress: () => void;
  /** Map of player_id → external_id_nba, batched at the parent surface
   *  so each card can render headshots without its own round-trip. */
  playerHeadshotMap?: Record<string, string | null>;
}

function itemKey(item: TradeItemRow): string {
  if (item.player_id) return `p:${item.player_id}:${item.from_team_id}:${item.to_team_id}`;
  if (item.pick_swap_season) return `sw:${item.pick_swap_season}:${item.pick_swap_round}:${item.from_team_id}`;
  if (item.draft_pick_id) return `pk:${item.draft_pick_id}:${item.from_team_id}:${item.to_team_id}`;
  return item.id;
}

/** Returns a set of item keys that are new in the counteroffer vs the original */
function getNewItemKeys(
  items: TradeItemRow[],
  originalItems?: TradeItemRow[],
): Set<string> {
  if (!originalItems) return new Set();
  const origKeys = new Set(originalItems.map(itemKey));
  const newKeys = new Set<string>();
  for (const item of items) {
    const key = itemKey(item);
    if (!origKeys.has(key)) newKeys.add(key);
  }
  return newKeys;
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/**
 * List-cell for a trade proposal. Status pills + relative time on top,
 * then a tricode-arrow team line, then a stack of `TradeSideSummary`
 * receives blocks (one per team that receives anything). All chrome
 * routes through the shared trade primitives so the card reads the
 * same as TradeDetailModal, league-history TradeHistory, and the chat
 * trade message embed.
 */
export function TradeCard({ proposal, onPress, playerHeadshotMap }: TradeCardProps) {
  const c = useColors();

  const teamNameMap: Record<string, string> = {};
  const teamStatusMap: Record<string, string> = {};
  proposal.teams.forEach((t) => {
    teamNameMap[t.team_id] = t.team_name;
    teamStatusMap[t.team_id] = t.status;
  });

  const isCounteroffer = !!proposal.counteroffer_of;
  const isMultiTeam = proposal.teams.length > 2;
  const newItemKeys = getNewItemKeys(proposal.items, proposal.original_items);

  // Group items by receiving team — each block becomes one TradeSideSummary.
  // Filter out teams that don't receive anything so the card stays compact.
  const receivedByTeam: Record<string, TradeItemRow[]> = {};
  for (const t of proposal.teams) receivedByTeam[t.team_id] = [];
  for (const item of proposal.items) {
    if (receivedByTeam[item.to_team_id]) {
      receivedByTeam[item.to_team_id].push(item);
    }
  }

  const teamsWithReceives = proposal.teams.filter(
    (t) => (receivedByTeam[t.team_id]?.length ?? 0) > 0,
  );

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${isCounteroffer ? 'Counteroffer: ' : ''}Trade between ${proposal.teams.map((t) => t.team_name).join(' and ')}`}
    >
      {/* Status row — pills on the left, relative time on the right. */}
      <View style={styles.statusRow}>
        <View style={styles.badgeRow}>
          <TradeStatusBadge status={proposal.status} />
          {isCounteroffer && <Badge label="Counteroffer" variant="gold" />}
        </View>
        <ThemedText style={[styles.time, { color: c.secondaryText }]}>
          {formatRelativeTime(proposal.proposed_at)}
        </ThemedText>
      </View>

      {/* Teams line — tricode arrow rhythm (Team A ↔ Team B ↔ Team C). */}
      <ThemedText
        type="defaultSemiBold"
        style={[styles.teamsLine, { color: c.text }]}
        numberOfLines={1}
      >
        {proposal.teams.map((t) => t.team_name).join('  ↔  ')}
      </ThemedText>

      {/* Receives blocks — one per team that gets something. Surfaceless
          so the parent card surface carries through; thin gold dividers
          separate stacked blocks. */}
      <View style={styles.blocks}>
        {teamsWithReceives.map((t, idx) => (
          <View
            key={t.team_id}
            style={[
              idx > 0 && styles.blockDivider,
              idx > 0 && { borderTopColor: c.border },
            ]}
          >
            <TradeSideSummary
              surfaceless
              teamId={t.team_id}
              teamName={t.team_name}
              receivedItems={receivedByTeam[t.team_id] ?? []}
              playerFptsMap={{}}
              playerHeadshotMap={playerHeadshotMap ?? {}}
              newItemKeys={newItemKeys}
              itemKeyFn={itemKey}
              teamNameMap={teamNameMap}
              teamStatus={teamStatusMap[t.team_id]}
              isMultiTeam={isMultiTeam}
            />
          </View>
        ))}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: s(12),
    marginBottom: s(10),
    ...cardShadow,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: s(14),
    marginBottom: s(8),
  },
  badgeRow: {
    flexDirection: 'row',
    gap: s(6),
  },
  time: {
    fontSize: ms(11),
  },
  teamsLine: {
    fontSize: ms(14),
    paddingHorizontal: s(14),
    marginBottom: s(4),
  },
  blocks: {
    // Surfaceless TradeSideSummary blocks stack here, separated by hairlines.
  },
  blockDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: s(4),
    paddingTop: s(2),
  },
});
