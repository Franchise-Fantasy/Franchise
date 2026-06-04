import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { useColors } from '@/hooks/useColors';
import type { ProjectionRow } from '@/hooks/usePlayerProjections';
import type { ScoringWeight } from '@/types/player';
import { ms, s } from '@/utils/scale';
import { projAvgRowToFpts } from '@/utils/scoring/fantasyPoints';

interface NextGameProjStripProps {
  projection: ProjectionRow | null;
  nextGame?: { opponent: string; prefix: string } | null;
  scoringWeights: ScoringWeight[] | undefined;
  isCategories: boolean;
}

/**
 * One-line "next game" projected-FPTS readout pinned under the player header —
 * the quick forward glance ("what do we expect this game"), distinct from the
 * season-long PROJ lens in the Averages box. Renders nothing for category
 * leagues or when there's no next-game projection.
 */
export function NextGameProjStrip({
  projection,
  nextGame,
  scoringWeights,
  isCategories,
}: NextGameProjStripProps) {
  const c = useColors();
  if (isCategories || !projection || !scoringWeights) return null;
  const fpts = projAvgRowToFpts(projection as Record<string, unknown>, scoringWeights);
  if (fpts <= 0) return null;
  const matchup = nextGame
    ? `${nextGame.prefix === '@' ? '@' : 'vs'} ${nextGame.opponent}`
    : null;

  return (
    <View
      style={[styles.strip, { borderBottomColor: c.border }]}
      accessibilityLabel={`Next game projection${matchup ? ` ${matchup}` : ''}: ${fpts.toFixed(1)} projected fantasy points`}
    >
      <ThemedText type="varsitySmall" style={[styles.label, { color: c.gold }]}>
        NEXT GAME
      </ThemedText>
      {matchup && (
        <ThemedText style={[styles.opp, { color: c.secondaryText }]} numberOfLines={1}>
          {matchup}
        </ThemedText>
      )}
      <View style={styles.spacer} />
      <ThemedText type="mono" style={[styles.fpts, { color: c.text }]}>
        {fpts.toFixed(1)}
      </ThemedText>
      <ThemedText type="varsitySmall" style={[styles.fptsLabel, { color: c.secondaryText }]}>
        PROJ FPTS
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    paddingHorizontal: s(16),
    paddingVertical: s(7),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: { fontSize: ms(9), letterSpacing: 1.2 },
  opp: { fontSize: ms(12), fontWeight: '600' },
  spacer: { flex: 1 },
  fpts: { fontSize: ms(16), fontWeight: '700' },
  fptsLabel: { fontSize: ms(8.5), letterSpacing: 1 },
});
