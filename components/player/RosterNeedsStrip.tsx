import { Image } from 'expo-image';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { Brand } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

const PATCH_SOURCE = require('../../assets/images/patch_logo.png');

export type PositionDepthState = 'set' | 'thin' | 'needs';

export interface PositionDepth {
  state: PositionDepthState;
  /** How many more eligible players you'd need to fill all dedicated
   *  starting slots at this position. 0 when state is "thin" or "set". */
  deficit: number;
  /** Number of dedicated starter slots the league has at this position. */
  demand: number;
}

interface RosterNeedsStripProps {
  /** Ordered list of base positions to render as chips. Derived from the
   *  league's `league_roster_config` — NBA leagues typically pass
   *  ['PG','SG','SF','PF','C']; WNBA leagues with G/F slots pass ['G','F']. */
  positions: readonly string[];
  /** Per-position eligibility counts on the user's active roster. */
  counts: Record<string, number>;
  /** Per-position health derived from supply vs. league starter demand. */
  states: Record<string, PositionDepth>;
  openSlots: number;
  selectedPosition: string;
  onPositionChange: (pos: string) => void;
}

/**
 * Diagnostic depth strip for the Free Agents page. Shows one chip per
 * dedicated starter position the league actually uses, each in one of
 * three states — "needs" (can't even fill starting slots), "thin"
 * (starters set but no backup), "set" (depth is fine). Tapping a chip
 * filters the list below to that position; tapping the selected chip
 * clears back to "All".
 */
export function RosterNeedsStrip({
  positions,
  counts,
  states,
  openSlots,
  selectedPosition,
  onPositionChange,
}: RosterNeedsStripProps) {
  const c = useColors();

  // Header summary — surface the diagnosis in the eyebrow so the user
  // doesn't have to mentally parse the chips to know if they have a
  // problem. Lists positions in "needs" state explicitly.
  const needsList = positions.filter((p) => states[p]?.state === 'needs');
  const thinList = positions.filter((p) => states[p]?.state === 'thin');
  const summary =
    needsList.length > 0
      ? `Needs ${needsList.join(' · ')}`
      : thinList.length > 0
        ? `Thin at ${thinList.join(' · ')}`
        : 'Depth Solid';

  return (
    <View style={[styles.card, { backgroundColor: c.heroSurface }, c.heroShadow]}>
      <Image
        source={PATCH_SOURCE}
        style={styles.patch}
        contentFit="contain"
        cachePolicy="memory-disk"
        transition={0}
        accessible={false}
      />
      <View style={styles.topRule} />

      <View style={styles.eyebrowRow}>
        <ThemedText type="varsity" style={styles.eyebrow} numberOfLines={1}>
          {summary}
        </ThemedText>
        <ThemedText
          type="varsitySmall"
          style={[
            styles.openText,
            { color: openSlots > 0 ? Brand.vintageGold : Brand.ecruMuted },
          ]}
        >
          {openSlots > 0 ? `${openSlots} OPEN` : 'ROSTER FULL'}
        </ThemedText>
      </View>

      <ThemedText type="varsitySmall" style={styles.helperText}>
        {needsList.length > 0 ? 'TAP A POSITION TO FIND PLAYERS' : 'POSITION DEPTH'}
      </ThemedText>

      <View style={styles.chipRow}>
        {positions.map((pos) => {
          const isSelected = selectedPosition === pos;
          const depth = states[pos] ?? { state: 'set' as const, deficit: 0, demand: 0 };
          return (
            <PositionChip
              key={pos}
              position={pos}
              count={counts[pos] ?? 0}
              depth={depth}
              isSelected={isSelected}
              onPress={() => onPositionChange(isSelected ? 'All' : pos)}
            />
          );
        })}
      </View>
    </View>
  );
}

interface PositionChipProps {
  position: string;
  count: number;
  depth: PositionDepth;
  isSelected: boolean;
  onPress: () => void;
}

function PositionChip({
  position,
  count,
  depth,
  isSelected,
  onPress,
}: PositionChipProps) {
  // Three visual treatments. Selection wins so the active filter chip
  // always reads as "filter on" first. Tuned for the green hero
  // background — base state uses ecru-faint outline so empty chips
  // recede; gold drives needs / thin / selected.
  const palette = isSelected
    ? {
        bg: 'rgba(181, 123, 48, 0.22)',
        border: Brand.vintageGold,
        label: Brand.vintageGold,
        count: Brand.vintageGold,
      }
    : depth.state === 'needs'
      ? {
          bg: 'rgba(181, 123, 48, 0.14)',
          border: Brand.vintageGold,
          label: Brand.vintageGold,
          count: Brand.ecru,
        }
      : depth.state === 'thin'
        ? {
            bg: 'transparent',
            border: Brand.vintageGold,
            label: Brand.vintageGold,
            count: Brand.ecru,
          }
        : {
            bg: 'transparent',
            border: 'rgba(233, 226, 203, 0.40)',
            label: Brand.ecruMuted,
            count: Brand.ecruMuted,
          };

  const a11y = `${position}, ${count} eligible${depth.state === 'needs' ? `, needs ${depth.deficit} more` : depth.state === 'thin' ? ', no backup' : ', depth set'}${isSelected ? ', filter active' : ''}`;

  return (
    <TouchableOpacity
      style={[
        styles.chip,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ selected: isSelected }}
    >
      <ThemedText
        type="varsitySmall"
        style={[styles.chipLabel, { color: palette.label }]}
      >
        {position}
      </ThemedText>
      <ThemedText
        type="mono"
        style={[styles.chipCount, { color: palette.count }]}
      >
        {count}
      </ThemedText>
      {depth.state === 'needs' && !isSelected && (
        <View style={[styles.deficitPip, { backgroundColor: Brand.vintageGold }]}>
          <ThemedText
            style={[styles.deficitText, { color: Brand.ink }]}
          >
            +{depth.deficit}
          </ThemedText>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'relative',
    marginHorizontal: s(12),
    marginTop: s(8),
    marginBottom: s(8),
    borderRadius: 16,
    paddingHorizontal: s(16),
    paddingTop: s(12),
    paddingBottom: s(12),
    overflow: 'hidden',
  },
  topRule: {
    position: 'absolute',
    top: 0,
    left: s(16),
    height: 3,
    width: s(36),
    backgroundColor: Brand.vintageGold,
  },
  // Lower opacity than the home/roster heroes (0.14 → 0.07) because the
  // chip row fills the bottom width — the watermark needs to recede
  // further to keep the C chip's count legible.
  patch: {
    position: 'absolute',
    right: s(-22),
    bottom: s(-28),
    width: s(130),
    height: s(130),
    opacity: 0.07,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: s(8),
  },
  eyebrow: {
    color: Brand.vintageGold,
    flexShrink: 1,
  },
  openText: {
    fontSize: ms(10),
    letterSpacing: 1.2,
  },
  helperText: {
    fontSize: ms(8.5),
    letterSpacing: 1.2,
    marginTop: s(2),
    marginBottom: s(10),
    color: Brand.ecruMuted,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: s(6),
  },
  chip: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: s(8),
    borderRadius: 8,
    borderWidth: 1,
    gap: s(2),
    position: 'relative',
  },
  chipLabel: {
    fontSize: ms(10),
    letterSpacing: 1.0,
  },
  chipCount: {
    fontSize: ms(15),
    fontWeight: '700',
  },
  deficitPip: {
    position: 'absolute',
    top: -s(6),
    right: -s(6),
    minWidth: s(18),
    height: s(18),
    borderRadius: 9,
    paddingHorizontal: s(4),
    alignItems: 'center',
    justifyContent: 'center',
  },
  deficitText: {
    fontSize: ms(10),
    fontWeight: '700',
    lineHeight: ms(14),
  },
});
