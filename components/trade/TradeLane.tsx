import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { TradeLaneShell } from '@/components/trade/TradeLaneShell';
import { Badge } from '@/components/ui/Badge';
import { BrandButton } from '@/components/ui/BrandButton';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Fonts } from '@/constants/Colors';
import { useActiveLeagueSport } from '@/hooks/useActiveLeagueSport';
import { useColors } from '@/hooks/useColors';
import { TradeBuilderPick, TradeBuilderPlayer, TradeBuilderSwap, TradeBuilderTeam, formatPickLabel } from '@/types/trade';
import { getPlayerHeadshotUrl, PLAYER_SILHOUETTE } from '@/utils/nba/playerHeadshot';
import { ms, s } from '@/utils/scale';

type PickerType = 'player' | 'pick' | 'swap';

interface TradeLaneProps {
  team: TradeBuilderTeam;
  isMe: boolean;
  /** Other teams in the trade (excludes this team) — drives the destination dropdown for multi-team. */
  partnerTeams: { id: string; name: string }[];
  teamNameMap: Record<string, string>;
  isMultiTeam: boolean;
  isCategories: boolean;
  pickConditionsEnabled: boolean;

  /** Lane-level controls — chip taps lift up to the parent which opens a fullscreen picker. */
  onAddChipPress: (type: PickerType) => void;
  onRemovePlayer: (playerId: string) => void;
  onRemovePick: (pickId: string) => void;
  onRemoveSwap: (season: string, round: number) => void;
  onSetPlayerDest: (playerId: string, toTeamId: string) => void;
  onSetPickDest: (pickId: string, toTeamId: string) => void;
  /** Optional ✕ to drop this team from the trade — non-`isMe` lanes only. */
  onRemoveTeam?: () => void;
}

/**
 * One team's compose lane — sends-framed.
 *
 * Composes `TradeLaneShell` (team name + gold-rule "SENDS" eyebrow +
 * optional remove-team ✕) over a chip row (`+ Player` / `+ Pick` /
 * `+ Swap`) and the asset row list. Tapping a chip lifts a `pickerFor`
 * event up to `ProposeTradeModal`, which renders a fullscreen asset
 * picker on top — no inline reveal, no cramped half-column UI.
 *
 * Asset row chrome mirrors the display-side `TradeAssetRow` so compose
 * and read share the same visual language: 34×34 headshot circle for
 * players, gold-on-card icon medallion for picks/swaps, varsity-caps
 * meta eyebrow underneath the name. Compose-only affordances (the
 * destination cycler chip and remove ✕) sit on the right.
 */
export function TradeLane({
  team,
  isMe,
  partnerTeams,
  teamNameMap,
  isMultiTeam,
  isCategories,
  pickConditionsEnabled,
  onAddChipPress,
  onRemovePlayer,
  onRemovePick,
  onRemoveSwap,
  onSetPlayerDest,
  onSetPickDest,
  onRemoveTeam,
}: TradeLaneProps) {
  const c = useColors();

  return (
    <View style={styles.lane}>
      <TradeLaneShell
        teamName={isMe ? `${team.team_name} (You)` : team.team_name}
        frame="sends"
        onRemoveTeam={!isMe ? onRemoveTeam : undefined}
        accessibilityLabel={`${team.team_name} sends`}
      >
        <View style={styles.body}>
          {/* Add-chip row — Swap stays hidden when the league disables pick conditions. */}
          <View style={styles.chipRow}>
            <BrandButton
              label="Player"
              icon="add"
              size="small"
              variant="secondary"
              onPress={() => onAddChipPress('player')}
              accessibilityLabel={`Add player from ${team.team_name}`}
            />
            <BrandButton
              label="Pick"
              icon="add"
              size="small"
              variant="secondary"
              onPress={() => onAddChipPress('pick')}
              accessibilityLabel={`Add pick from ${team.team_name}`}
            />
            {pickConditionsEnabled && (
              <BrandButton
                label="Swap"
                icon="add"
                size="small"
                variant="secondary"
                onPress={() => onAddChipPress('swap')}
                accessibilityLabel={`Add pick swap from ${team.team_name}`}
              />
            )}
          </View>

          {/* Players */}
          {team.sending_players.map((p) => (
            <AssetEntry key={`p-${p.player_id}`}>
              <PlayerAssetRow
                player={p}
                isMultiTeam={isMultiTeam}
                isCategories={isCategories}
                destLabel={teamNameMap[p.to_team_id] ?? '?'}
                onCycleDest={() =>
                  cycleDest(p.to_team_id, partnerTeams, (id) => onSetPlayerDest(p.player_id, id))
                }
                onRemove={() => onRemovePlayer(p.player_id)}
              />
            </AssetEntry>
          ))}

          {/* Picks */}
          {team.sending_picks.map((pk) => (
            <AssetEntry key={`pk-${pk.draft_pick_id}`}>
              <PickAssetRow
                pick={pk}
                isMultiTeam={isMultiTeam}
                destLabel={teamNameMap[pk.to_team_id] ?? '?'}
                onCycleDest={() =>
                  cycleDest(pk.to_team_id, partnerTeams, (id) => onSetPickDest(pk.draft_pick_id, id))
                }
                onRemove={() => onRemovePick(pk.draft_pick_id)}
              />
            </AssetEntry>
          ))}

          {/* Swaps */}
          {team.sending_swaps.map((sw) => (
            <AssetEntry key={`sw-${sw.season}-${sw.round}`}>
              <SwapAssetRow
                swap={sw}
                beneficiaryName={teamNameMap[sw.beneficiary_team_id] ?? '?'}
                onRemove={() => onRemoveSwap(sw.season, sw.round)}
              />
            </AssetEntry>
          ))}

          {/* Empty hint */}
          {team.sending_players.length === 0 &&
            team.sending_picks.length === 0 &&
            team.sending_swaps.length === 0 && (
              <ThemedText style={[styles.emptyHint, { color: c.secondaryText }]}>
                Tap a chip above to add an asset
              </ThemedText>
            )}
        </View>
      </TradeLaneShell>
    </View>
  );
}

// ─── Asset rows ──────────────────────────────────────────────────────

function PlayerAssetRow({
  player,
  isMultiTeam,
  isCategories,
  destLabel,
  onCycleDest,
  onRemove,
}: {
  player: TradeBuilderPlayer;
  isMultiTeam: boolean;
  isCategories: boolean;
  destLabel: string;
  onCycleDest: () => void;
  onRemove: () => void;
}) {
  const c = useColors();
  const sport = useActiveLeagueSport();
  const headshotUrl = getPlayerHeadshotUrl(player.external_id_nba, sport);

  return (
    <View
      style={[styles.row, { borderTopColor: c.border }]}
      accessibilityLabel={`${player.name}${!isCategories ? `, ${player.avg_fpts.toFixed(1)} fantasy points per game` : ''}`}
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
        <ThemedText
          type="defaultSemiBold"
          style={[styles.name, { color: c.text }]}
          numberOfLines={1}
        >
          {player.name}
        </ThemedText>
        <ThemedText
          type="varsitySmall"
          style={[styles.eyebrow, { color: c.secondaryText }]}
          numberOfLines={1}
        >
          {player.position}{player.pro_team ? ` · ${player.pro_team}` : ''}
        </ThemedText>
      </View>
      <View style={styles.rightCluster}>
        {isMultiTeam && <DestChip label={destLabel} onPress={onCycleDest} c={c} />}
        {!isCategories && (
          <ThemedText style={[styles.fpts, { color: c.gold }]}>
            {player.avg_fpts.toFixed(1)}
          </ThemedText>
        )}
        <RemoveBtn onPress={onRemove} accessibilityLabel={`Remove ${player.name}`} c={c} />
      </View>
    </View>
  );
}

function PickAssetRow({
  pick,
  isMultiTeam,
  destLabel,
  onCycleDest,
  onRemove,
}: {
  pick: TradeBuilderPick;
  isMultiTeam: boolean;
  destLabel: string;
  onCycleDest: () => void;
  onRemove: () => void;
}) {
  const c = useColors();
  const label = formatPickLabel(pick.season, pick.round);
  const via = pick.original_team_name ? `via ${pick.original_team_name}` : null;

  return (
    <View
      style={[styles.row, { borderTopColor: c.border }]}
      accessibilityLabel={`Draft pick: ${label}${pick.protection_threshold ? `, top ${pick.protection_threshold} protected` : ''}${via ? `, ${via}` : ''}`}
    >
      <AssetIcon name="ticket-outline" c={c} />
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <ThemedText
            type="defaultSemiBold"
            style={[styles.name, { color: c.text }]}
            numberOfLines={1}
          >
            {label}
          </ThemedText>
          {pick.protection_threshold != null && (
            <Badge label={`Top ${pick.protection_threshold}`} variant="gold" size="small" />
          )}
        </View>
        {via && (
          <ThemedText
            type="varsitySmall"
            style={[styles.eyebrow, { color: c.gold }]}
            numberOfLines={1}
          >
            {via}
          </ThemedText>
        )}
      </View>
      <View style={styles.rightCluster}>
        {isMultiTeam && <DestChip label={destLabel} onPress={onCycleDest} c={c} />}
        <ThemedText style={[styles.fpts, { color: c.secondaryText }]}>
          ~{pick.estimated_fpts}
        </ThemedText>
        <RemoveBtn onPress={onRemove} accessibilityLabel={`Remove ${label}`} c={c} />
      </View>
    </View>
  );
}

function SwapAssetRow({
  swap,
  beneficiaryName,
  onRemove,
}: {
  swap: TradeBuilderSwap;
  beneficiaryName: string;
  onRemove: () => void;
}) {
  const c = useColors();
  const label = `${formatPickLabel(swap.season, swap.round)} Swap`;

  return (
    <View
      style={[styles.row, { borderTopColor: c.border }]}
      accessibilityLabel={`Pick swap: ${beneficiaryName} gets the better pick`}
    >
      <AssetIcon name="swap-horizontal" c={c} />
      <View style={styles.info}>
        <ThemedText
          type="defaultSemiBold"
          style={[styles.name, { color: c.text }]}
          numberOfLines={1}
        >
          {label}
        </ThemedText>
        <ThemedText
          type="varsitySmall"
          style={[styles.eyebrow, { color: c.gold }]}
          numberOfLines={1}
        >
          Better pick → {beneficiaryName}
        </ThemedText>
      </View>
      <View style={styles.rightCluster}>
        <RemoveBtn onPress={onRemove} accessibilityLabel={`Remove ${label}`} c={c} />
      </View>
    </View>
  );
}

// ─── Sub-primitives ──────────────────────────────────────────────────

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

function AssetEntry({ children }: { children: React.ReactNode }) {
  return <Animated.View entering={FadeInDown.springify().damping(18).mass(0.6)}>{children}</Animated.View>;
}

function cycleDest(
  current: string,
  partnerTeams: { id: string; name: string }[],
  setNext: (id: string) => void,
) {
  if (partnerTeams.length <= 1) return;
  const idx = partnerTeams.findIndex((p) => p.id === current);
  const next = partnerTeams[(idx + 1) % partnerTeams.length];
  setNext(next.id);
}

function DestChip({
  label,
  onPress,
  c,
}: {
  label: string;
  onPress: () => void;
  c: ReturnType<typeof useColors>;
}) {
  // Brief gold flash when the destination label changes — reinforces the
  // routing mental model when the user cycles the chip.
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = 0.7;
    opacity.value = withTiming(0, { duration: 350 });
  }, [label, opacity]);
  const flashStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`Change destination, currently ${label}`}
      style={[styles.destChip, { backgroundColor: c.gold }]}
      onPress={onPress}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
    >
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFillObject, { backgroundColor: c.text, borderRadius: 10 }, flashStyle]}
      />
      <ThemedText style={[styles.destChipText, { color: Brand.ink }]} numberOfLines={1}>
        → {label}
      </ThemedText>
    </TouchableOpacity>
  );
}

function RemoveBtn({
  onPress,
  accessibilityLabel,
  c,
}: {
  onPress: () => void;
  accessibilityLabel: string;
  c: ReturnType<typeof useColors>;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      style={styles.removeBtn}
    >
      <Ionicons name="close" size={16} color={c.danger} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  lane: { flex: 1 },
  body: {
    paddingBottom: s(8),
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(6),
    paddingHorizontal: s(10),
    paddingVertical: s(8),
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(8),
    paddingHorizontal: s(10),
    borderTopWidth: StyleSheet.hairlineWidth,
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
  name: {
    fontSize: ms(13),
    flexShrink: 1,
  },
  eyebrow: {
    fontSize: ms(9),
    letterSpacing: 1.0,
  },
  rightCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
  },
  fpts: {
    fontFamily: Fonts.mono,
    fontSize: ms(12),
    fontWeight: '600',
  },

  destChip: {
    borderRadius: 10,
    paddingHorizontal: s(7),
    paddingVertical: s(2),
    overflow: 'hidden',
  },
  destChipText: {
    fontSize: ms(9),
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  removeBtn: {
    padding: s(2),
  },

  emptyHint: {
    fontSize: ms(11),
    textAlign: 'center',
    paddingVertical: s(8),
    paddingHorizontal: s(10),
  },
});
