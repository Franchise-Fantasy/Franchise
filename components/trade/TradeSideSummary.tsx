import { StyleSheet, View } from 'react-native';

import { TradeAssetRow } from '@/components/trade/TradeAssetRow';
import { TradeLaneShell } from '@/components/trade/TradeLaneShell';
import { ThemedText } from '@/components/ui/ThemedText';
import { useColors } from '@/hooks/useColors';
import { TradeItemRow } from '@/hooks/useTrades';
import { ms, s } from '@/utils/scale';

interface TradeSideSummaryProps {
  teamId: string;
  teamName: string;
  /** Items this team receives */
  receivedItems: TradeItemRow[];
  /** Player FPTS map: player_id → avg FPTS */
  playerFptsMap: Record<string, number>;
  /** Player headshot map: player_id → external_id_nba */
  playerHeadshotMap: Record<string, string | null>;
  /** Set of item keys that are new in a counteroffer */
  newItemKeys: Set<string>;
  /** Item key function */
  itemKeyFn: (item: TradeItemRow) => string;
  /** Team name map for pick swap labels */
  teamNameMap: Record<string, string>;
  /** Per-team acceptance status — drives the right-aligned status glyph */
  teamStatus?: string;
  /** Whether this is a multi-team trade (shows "from Team X" on assets) */
  isMultiTeam?: boolean;
  /**
   * Drop the outer card surface — used when stacking multiple blocks
   * inside a single parent card (e.g. TradeCard on the trades list).
   * The parent provides the surface; this component only renders the
   * header + asset rows.
   */
  surfaceless?: boolean;
}

/**
 * Receives-framed lane — wraps the shared `TradeLaneShell` chrome with
 * the per-asset row list. The shell handles the team name + gold-rule
 * "RECEIVES" eyebrow + status glyph; this component fills the lane body.
 *
 * Every receives surface in the app — TradeCard, TradeDetailModal,
 * league-history TradeHistory, chat trade messages, per-player
 * TradeHistoryModal — should consume this component so they all read
 * the same.
 */
export function TradeSideSummary({
  teamId,
  teamName,
  receivedItems,
  playerFptsMap,
  playerHeadshotMap,
  newItemKeys,
  itemKeyFn,
  teamNameMap,
  teamStatus,
  isMultiTeam,
  surfaceless,
}: TradeSideSummaryProps) {
  const c = useColors();
  void teamId;

  const statusGlyph =
    teamStatus === 'accepted'
      ? 'accepted'
      : teamStatus === 'rejected'
        ? 'rejected'
        : teamStatus
          ? 'pending'
          : null;

  return (
    <TradeLaneShell
      teamName={teamName}
      frame="receives"
      statusGlyph={statusGlyph}
      surfaceless={surfaceless}
      accessibilityLabel={`${teamName} receives ${receivedItems.length} asset${receivedItems.length !== 1 ? 's' : ''}`}
    >
      <View style={styles.assets}>
        {receivedItems.map((item) => {
          const key = itemKeyFn(item);
          return (
            <TradeAssetRow
              key={key}
              item={item}
              avgFpts={item.player_id ? playerFptsMap[item.player_id] : undefined}
              externalIdNba={item.player_id ? playerHeadshotMap[item.player_id] : undefined}
              isNew={newItemKeys.has(key)}
              teamNameMap={teamNameMap}
              fromTeamName={isMultiTeam ? teamNameMap[item.from_team_id] : undefined}
            />
          );
        })}
        {receivedItems.length === 0 && (
          <ThemedText style={[styles.empty, { color: c.secondaryText }]}>
            No assets
          </ThemedText>
        )}
      </View>
    </TradeLaneShell>
  );
}

const styles = StyleSheet.create({
  assets: {
    paddingHorizontal: s(10),
    paddingVertical: s(4),
  },
  empty: {
    fontSize: ms(13),
    fontStyle: 'italic',
    paddingVertical: s(8),
  },
});
