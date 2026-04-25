import React from 'react';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { TradeItemRow } from '@/hooks/useTrades';
import { formatPickLabel } from '@/types/trade';
import { getPlayerHeadshotUrl } from '@/utils/playerHeadshot';
import { ms, s } from '@/utils/scale';
import { Ionicons } from '@expo/vector-icons';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useActiveLeagueSport } from "@/hooks/useActiveLeagueSport";

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
  /** Sending team name — shown in multi-team trades */
  fromTeamName?: string;
}

export function TradeAssetRow({ item, avgFpts, externalIdNba, isNew, teamNameMap, fromTeamName }: TradeAssetRowProps) {
  const sport = useActiveLeagueSport();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  // Pick swap
  if (item.pick_swap_season) {
    const toTeamName = teamNameMap?.[item.to_team_id] ?? '?';
    return (
      <View style={styles.row} accessibilityLabel={`Pick swap: ${toTeamName} gets the better pick`}>
        <View style={[styles.iconCircle, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
          <Ionicons name="swap-horizontal" size={18} color={c.accent} />
        </View>
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <ThemedText style={styles.name} numberOfLines={1}>
              {formatPickLabel(item.pick_swap_season, item.pick_swap_round!)} Swap
            </ThemedText>
            {isNew && <NewBadge />}
          </View>
          <ThemedText style={[styles.sub, { color: c.secondaryText }]}>
            {toTeamName} gets the better pick
          </ThemedText>
        </View>
      </View>
    );
  }

  // Draft pick
  if (item.draft_pick_id || item.pick_season) {
    const label = formatPickLabel(item.pick_season!, item.pick_round!);
    const via = item.pick_original_team_name ? `via ${item.pick_original_team_name}` : null;

    return (
      <View style={styles.row} accessibilityLabel={`Draft pick: ${label}${item.protection_threshold ? `, top ${item.protection_threshold} protected` : ''}${via ? `, ${via}` : ''}`}>
        <View style={[styles.iconCircle, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
          {item.protection_threshold ? (
            <Ionicons name="shield-half-outline" size={16} color={c.accent} />
          ) : (
            <Ionicons name="ticket-outline" size={16} color={c.accent} />
          )}
        </View>
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <ThemedText style={styles.name} numberOfLines={1}>{label}</ThemedText>
            {isNew && <NewBadge />}
          </View>
          {item.protection_threshold != null && (
            <View style={styles.protInline}>
              <Ionicons name="shield-half-outline" size={9} color={c.secondaryText} />
              <Text style={[styles.protText, { color: c.secondaryText }]}>Top {item.protection_threshold}</Text>
            </View>
          )}
          {via && (
            <ThemedText style={[styles.sub, { color: c.secondaryText }]} numberOfLines={1}>
              {via}
            </ThemedText>
          )}
        </View>
      </View>
    );
  }

  // Player
  const headshotUrl = getPlayerHeadshotUrl(externalIdNba, sport);

  return (
    <View
      style={styles.row}
      accessibilityLabel={`${item.player_name ?? 'Unknown'}${avgFpts != null ? `, ${avgFpts.toFixed(1)} fantasy points per game` : ''}`}
    >
      <View style={[styles.headshot, { borderColor: c.border, backgroundColor: c.cardAlt }]}>
        {headshotUrl ? (
          <Image source={{ uri: headshotUrl }} style={styles.headshotImg} resizeMode="cover" />
        ) : (
          <Ionicons name="person" size={16} color={c.secondaryText} style={{ alignSelf: 'center', marginTop: s(5) }} />
        )}
      </View>
      <View style={styles.info}>
        <ThemedText style={styles.playerName} numberOfLines={1}>{item.player_name ?? 'Unknown'}</ThemedText>
        <View style={styles.nameRow}>
          <ThemedText style={[styles.playerSub, { color: c.secondaryText }]} numberOfLines={1}>
            {[fromTeamName ? `from ${fromTeamName}` : null, avgFpts != null ? `${avgFpts.toFixed(1)} FPTS` : null].filter(Boolean).join('  ·  ')}
          </ThemedText>
          {isNew && <NewBadge />}
        </View>
      </View>
    </View>
  );
}

function NewBadge() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <View
      style={[styles.newBadge, { backgroundColor: c.link }]}
      accessibilityLabel="Newly added in counteroffer"
    >
      <Text style={[styles.newBadgeText, { color: c.statusText }]}>NEW</Text>
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
  protInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(2),
  },
  protText: {
    fontSize: ms(10),
    fontWeight: '600',
  },
  info: {
    flex: 1,
    gap: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
  },
  name: {
    fontSize: ms(13),
    fontWeight: '600',
    flexShrink: 1,
  },
  playerName: {
    fontSize: ms(13),
    fontWeight: '600',
  },
  playerSub: {
    fontSize: ms(11),
  },
  sub: {
    fontSize: ms(11),
  },
  newBadge: {
    paddingHorizontal: s(4),
    paddingVertical: 1,
    borderRadius: 3,
    marginLeft: s(2),
  },
  newBadgeText: {
    fontSize: ms(7),
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});
