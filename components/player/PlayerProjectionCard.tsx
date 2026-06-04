import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { type Sport } from '@/constants/LeagueDefaults';
import { useColors } from '@/hooks/useColors';
import { usePlayerProjections } from '@/hooks/usePlayerProjections';
import { useProjectionToggle } from '@/hooks/useProjectionToggle';
import type { PlayerSeasonStats, ScoringWeight } from '@/types/player';
import { ms, s } from '@/utils/scale';
import { formatScore, projAvgRowToFpts } from '@/utils/scoring/fantasyPoints';

interface PlayerProjectionCardProps {
  player: PlayerSeasonStats;
  sport: Sport;
  scoringWeights: ScoringWeight[] | undefined;
  isCategories: boolean;
}

const STAT_CHIPS: { key: string; label: string }[] = [
  { key: 'proj_pts', label: 'PTS' },
  { key: 'proj_reb', label: 'REB' },
  { key: 'proj_ast', label: 'AST' },
  { key: 'proj_stl', label: 'STL' },
  { key: 'proj_blk', label: 'BLK' },
  { key: 'proj_3pm', label: '3PM' },
];

/**
 * "Projected" section for the player detail modal — the next-game projected
 * line plus, for points leagues, projected FPTS with its uncertainty band.
 * Gated by the global projection toggle and only shown when a projection
 * exists for this player. Lives in its own file to keep PlayerDetailModal
 * from growing.
 */
export function PlayerProjectionCard({
  player,
  sport,
  scoringWeights,
  isCategories,
}: PlayerProjectionCardProps) {
  const c = useColors();
  const { enabled } = useProjectionToggle();
  const { data: projections } = usePlayerProjections(sport, 'next_game', enabled);

  if (!enabled) return null;
  const proj = projections?.get(player.player_id);
  if (!proj) return null;

  const projFpts = scoringWeights
    ? projAvgRowToFpts(proj as Record<string, unknown>, scoringWeights)
    : 0;
  const sd = proj.sd_fantasy_pg;

  return (
    <View
      style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
      accessibilityLabel={`Projected next game. ${STAT_CHIPS.map(
        (chip) => `${formatScore(Number((proj as Record<string, unknown>)[chip.key] ?? 0))} ${chip.label}`,
      ).join(', ')}${!isCategories && projFpts > 0 ? `, ${formatScore(projFpts)} fantasy points per game` : ''}.`}
    >
      <View style={styles.headerRow}>
        <View style={[styles.rule, { backgroundColor: c.gold }]} />
        <ThemedText type="sectionLabel" accessibilityRole="header">
          PROJECTED · NEXT GAME
        </ThemedText>
      </View>

      <View style={styles.chipRow}>
        {STAT_CHIPS.map((chip) => {
          const v = Number((proj as Record<string, unknown>)[chip.key] ?? 0);
          return (
            <View key={chip.key} style={styles.chip}>
              <ThemedText style={[styles.chipValue, { color: c.text }]}>
                {formatScore(v)}
              </ThemedText>
              <ThemedText style={[styles.chipLabel, { color: c.secondaryText }]}>
                {chip.label}
              </ThemedText>
            </View>
          );
        })}
      </View>

      {!isCategories && projFpts > 0 && (
        <View style={[styles.fptsRow, { borderTopColor: c.border }]}>
          <ThemedText style={[styles.fptsLabel, { color: c.secondaryText }]}>
            Projected FPTS
          </ThemedText>
          <ThemedText style={[styles.fptsValue, { color: c.text }]}>
            {formatScore(projFpts)}
            {sd != null && sd > 0 && (
              <ThemedText style={[styles.fptsBand, { color: c.secondaryText }]}>
                {' '}
                ± {formatScore(sd)}
              </ThemedText>
            )}
          </ThemedText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: s(14),
    paddingTop: s(12),
    paddingBottom: s(12),
    marginTop: s(12),
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    marginBottom: s(10),
  },
  rule: { height: 2, width: s(18) },
  chipRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  chip: { alignItems: 'center', flex: 1 },
  chipValue: { fontSize: ms(15), fontWeight: '700' },
  chipLabel: { fontSize: ms(9.5), letterSpacing: 0.6, marginTop: s(2) },
  fptsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: s(10),
    paddingTop: s(8),
  },
  fptsLabel: { fontSize: ms(12) },
  fptsValue: { fontSize: ms(15), fontWeight: '700' },
  fptsBand: { fontSize: ms(11), fontWeight: '400' },
});
