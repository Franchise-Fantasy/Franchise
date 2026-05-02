import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Badge } from '@/components/ui/Badge';
import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import { useActiveLeagueSport } from '@/hooks/useActiveLeagueSport';
import { useColors } from '@/hooks/useColors';
import { TradeItemRow } from '@/hooks/useTrades';
import { formatPickLabel } from '@/types/trade';
import { getPlayerHeadshotUrl, PLAYER_SILHOUETTE } from '@/utils/nba/playerHeadshot';
import { ms, s } from '@/utils/scale';

interface TradeAssetRowProps {
  item: TradeItemRow;
  /** Average FPTS for this player (undefined for picks) */
  avgFpts?: number;
  /** NBA headshot external ID */
  externalIdNba?: string | null;
  /** Whether this item was newly added in a counteroffer */
  isNew?: boolean;
  /** Team name map for pick swap display */
  teamNameMap?: Record<string, string>;
  /** Sending team name — shown in multi-team trades as `from TEAM` eyebrow */
  fromTeamName?: string;
}

/**
 * Single asset chip in a receives block. Player rows use a headshot anchor;
 * pick + swap rows use a brand icon circle with a gold-on-card glyph. The
 * `from TEAM` / `via TEAM` annotations and counteroffer NEW pill all run
 * through the shared brand `Badge`/varsity-caps system so this row reads
 * the same chrome as ByYearTab pick rows and the lottery slot list.
 */
export function TradeAssetRow({
  item,
  avgFpts,
  externalIdNba,
  isNew,
  teamNameMap,
  fromTeamName,
}: TradeAssetRowProps) {
  const sport = useActiveLeagueSport();
  const c = useColors();

  // ─── Pick swap ─────────────────────────────────────────────
  if (item.pick_swap_season) {
    const toTeamName = teamNameMap?.[item.to_team_id] ?? '?';
    const label = `${formatPickLabel(item.pick_swap_season, item.pick_swap_round!)} Swap`;
    return (
      <View
        style={styles.row}
        accessibilityLabel={`Pick swap: ${toTeamName} gets the better pick`}
      >
        <AssetIcon name="swap-horizontal" c={c} />
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <ThemedText style={[styles.name, { color: c.text }]} numberOfLines={1}>
              {label}
            </ThemedText>
            {isNew && <Badge label="New" variant="gold" size="small" />}
          </View>
          <ThemedText
            type="varsitySmall"
            style={[styles.eyebrow, { color: c.gold }]}
            numberOfLines={1}
          >
            Better pick → {toTeamName}
          </ThemedText>
        </View>
      </View>
    );
  }

  // ─── Draft pick ────────────────────────────────────────────
  if (item.draft_pick_id || item.pick_season) {
    const label = formatPickLabel(item.pick_season!, item.pick_round!);
    const via = item.pick_original_team_name ? `via ${item.pick_original_team_name}` : null;
    const protA11y = item.protection_threshold ? `, top ${item.protection_threshold} protected` : '';
    return (
      <View
        style={styles.row}
        accessibilityLabel={`Draft pick: ${label}${protA11y}${via ? `, ${via}` : ''}`}
      >
        <AssetIcon name="ticket-outline" c={c} />
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <ThemedText style={[styles.name, { color: c.text }]} numberOfLines={1}>
              {label}
            </ThemedText>
            {item.protection_threshold != null && (
              <Badge
                label={`Top ${item.protection_threshold}`}
                variant="gold"
                size="small"
              />
            )}
            {isNew && <Badge label="New" variant="gold" size="small" />}
          </View>
          {(via || fromTeamName) && (
            <ThemedText
              type="varsitySmall"
              style={[styles.eyebrow, { color: c.gold }]}
              numberOfLines={1}
            >
              {[fromTeamName ? `from ${fromTeamName}` : null, via]
                .filter(Boolean)
                .join(' · ')}
            </ThemedText>
          )}
        </View>
      </View>
    );
  }

  // ─── Player ────────────────────────────────────────────────
  const headshotUrl = getPlayerHeadshotUrl(externalIdNba, sport);
  return (
    <View
      style={styles.row}
      accessibilityLabel={`${item.player_name ?? 'Unknown'}${avgFpts != null ? `, ${avgFpts.toFixed(1)} fantasy points per game` : ''}`}
    >
      <View style={[styles.headshot, { borderColor: c.border, backgroundColor: c.cardAlt }]}>
        <Image
          source={headshotUrl ? { uri: headshotUrl } : PLAYER_SILHOUETTE}
          style={styles.headshotImg}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={headshotUrl ?? 'silhouette'}
          placeholder={PLAYER_SILHOUETTE}
        />
      </View>
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <ThemedText style={[styles.name, { color: c.text }]} numberOfLines={1}>
            {item.player_name ?? 'Unknown'}
          </ThemedText>
          {isNew && <Badge label="New" variant="gold" size="small" />}
        </View>
        <View style={styles.metaRow}>
          {fromTeamName && (
            <ThemedText
              type="varsitySmall"
              style={[styles.eyebrow, { color: c.gold }]}
              numberOfLines={1}
            >
              from {fromTeamName}
            </ThemedText>
          )}
          {avgFpts != null && (
            <ThemedText style={[styles.fpts, { color: c.secondaryText }]} numberOfLines={1}>
              {avgFpts.toFixed(1)} <ThemedText type="varsitySmall" style={[styles.fptsLabel, { color: c.secondaryText }]}>FPTS</ThemedText>
            </ThemedText>
          )}
        </View>
      </View>
    </View>
  );
}

// Small reusable icon medallion used by pick + swap rows.
function AssetIcon({
  name,
  c,
}: {
  name: React.ComponentProps<typeof Ionicons>['name'];
  c: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.iconCircle, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
      <Ionicons name={name} size={16} color={c.gold} accessible={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(6),
    gap: s(8),
  },
  headshot: {
    width: s(34),
    height: s(34),
    borderRadius: 17,
    borderWidth: 1,
    overflow: 'hidden' as const,
  },
  headshotImg: {
    position: 'absolute' as const,
    bottom: s(-2),
    left: 0,
    right: 0,
    height: s(28),
  },
  iconCircle: {
    width: s(34),
    height: s(34),
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    flexShrink: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
  },
  name: {
    fontSize: ms(13),
    fontWeight: '600',
    flexShrink: 1,
  },
  eyebrow: {
    fontSize: ms(9),
    letterSpacing: 1.0,
  },
  fpts: {
    fontFamily: Fonts.mono,
    fontSize: ms(11),
  },
  fptsLabel: {
    fontSize: ms(9),
    letterSpacing: 1.0,
  },
});
