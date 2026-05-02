/**
 * Always-visible "story line" for a draft pick condition (protection or
 * swap). Replaces the previous animated tap-to-expand `ProtectionBadge`
 * + ad-hoc swap pill stack — same information, single chrome treatment,
 * legible at a glance.
 *
 * Layout:
 *   [icon] [Badge] {storyText}
 *
 * The icon + Badge variant carry the semantic colour:
 * - `lock-closed` + `gold`   → pending or held protection
 * - `lock-open`   + `merlot` → protection missed (pick conveys)
 * - `swap-horizontal` + `turf` → swap with another team
 *
 * The story text is regular Inter in `c.secondaryText` (or `c.danger`
 * for the missed-protection case) so the eye lands on the icon+pill
 * first, then reads the consequence.
 *
 * Consumed by: ByYearTab (lottery odds rows + round-by-round picks),
 * ByTeamTab (per-team pick rows), ManagePickConditionsModal (commissioner
 * preview list).
 */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Badge } from '@/components/ui/Badge';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

export type PickConditionKind =
  | 'protection_pending'
  | 'protection_held'
  | 'protection_missed'
  | 'swap';

const ICON_FOR_KIND: Record<
  PickConditionKind,
  React.ComponentProps<typeof Ionicons>['name']
> = {
  protection_pending: 'lock-closed',
  protection_held: 'lock-closed',
  protection_missed: 'lock-open',
  swap: 'swap-horizontal',
};

interface Props {
  kind: PickConditionKind;
  /** Short ALL-CAPS pill text (e.g. "TOP-4 PROTECTED", "SWAP WITH WAS"). */
  badgeLabel: string;
  /** Plain-English continuation (e.g. "Lakers keep if Top-4, else OKC"). */
  storyText: string;
}

export function PickConditionRow({ kind, badgeLabel, storyText }: Props) {
  const c = useColors();

  const variant: React.ComponentProps<typeof Badge>['variant'] =
    kind === 'protection_missed'
      ? 'merlot'
      : kind === 'swap'
        ? 'turf'
        : 'gold';

  const iconColor =
    kind === 'protection_missed'
      ? c.danger
      : kind === 'swap'
        ? Brand.turfGreen
        : c.gold;

  const storyColor = kind === 'protection_missed' ? c.danger : c.secondaryText;

  return (
    <View style={styles.row}>
      <View style={styles.badgeGroup}>
        <Ionicons name={ICON_FOR_KIND[kind]} size={ms(13)} color={iconColor} />
        <Badge label={badgeLabel} variant={variant} size="small" />
      </View>
      <ThemedText style={[styles.story, { color: storyColor }]} numberOfLines={2}>
        {storyText}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    paddingVertical: s(2),
  },
  badgeGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
  },
  story: {
    flex: 1,
    fontSize: ms(12),
    lineHeight: ms(16),
  },
});
