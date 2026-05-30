import { StyleSheet, Text, View } from 'react-native';

import { Fonts } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';
import { CategoryResult } from '@/utils/scoring/categoryScoring';

interface CategoryScoreboardProps {
  results: CategoryResult[];
  homeWins: number;
  awayWins: number;
  ties: number;
  /** Short display name (tricode preferred) for each side. */
  homeName: string;
  awayName: string;
  /** Playoff seeds, when in a playoff week. */
  homeSeed?: number;
  awaySeed?: number;
}

function formatStatValue(stat: string, value: number): string {
  if (stat === 'FG%' || stat === 'FT%') {
    return value === 0 ? '.000' : `.${(value * 1000).toFixed(0).padStart(3, '0')}`;
  }
  return String(Math.round(value));
}

// Proportional split [0..1] of the lead bar that belongs to the HOME side.
// Sized by each team's value so the wider gold segment reads as the winner —
// except for inverse stats (lower-is-better, e.g. turnovers), detected when
// the winner holds the smaller value, where the split is flipped so the
// winner still gets the larger segment. Ties / no-production land at 50/50.
function homeBarShare(cat: CategoryResult): number {
  const total = cat.home + cat.away;
  if (cat.winner === 'tie' || total <= 0) return 0.5;
  let share = cat.home / total;
  const winnerHasSmaller =
    (cat.winner === 'home' && cat.home < cat.away) ||
    (cat.winner === 'away' && cat.away < cat.home);
  if (winnerHasSmaller) share = 1 - share;
  // Clamp so a lopsided category never collapses a segment to invisibility.
  return Math.min(0.92, Math.max(0.08, share));
}

export function CategoryScoreboard({
  results,
  homeWins,
  awayWins,
  ties,
  homeName,
  awayName,
  homeSeed,
  awaySeed,
}: CategoryScoreboardProps) {
  const c = useColors();

  const homeLeading = homeWins > awayWins;
  const awayLeading = awayWins > homeWins;
  const recordStr =
    ties > 0 ? `${homeWins}–${awayWins}–${ties}` : `${homeWins}–${awayWins}`;

  return (
    <View
      style={styles.container}
      accessibilityLabel={`Category matchup: ${homeName} ${homeWins}, ${awayName} ${awayWins}${
        ties > 0 ? `, ${ties} tied` : ''
      }`}
    >
      {/* Record header — team names flank the centered W–L–T tally. */}
      <View style={styles.headerRow}>
        <Text
          style={[
            styles.teamName,
            { color: homeLeading ? c.accent : c.secondaryText, textAlign: 'left' },
          ]}
          numberOfLines={1}
        >
          {homeSeed != null ? `#${homeSeed} ` : ''}
          {homeName}
        </Text>
        <Text style={[styles.record, { color: c.text }]}>{recordStr}</Text>
        <Text
          style={[
            styles.teamName,
            { color: awayLeading ? c.accent : c.secondaryText, textAlign: 'right' },
          ]}
          numberOfLines={1}
        >
          {awayName}
          {awaySeed != null ? ` #${awaySeed}` : ''}
        </Text>
      </View>

      {/* Per-category rows: value · lead bar · value · result */}
      {results.map((cat) => {
        const homeWin = cat.winner === 'home';
        const awayWin = cat.winner === 'away';
        const share = homeBarShare(cat);
        const resultLabel = homeWin ? 'W' : awayWin ? 'L' : 'T';
        const resultColor = homeWin ? c.success : awayWin ? c.danger : c.secondaryText;
        const mutedSeg = c.border;

        return (
          <View
            key={cat.stat}
            style={styles.row}
            accessibilityLabel={`${cat.stat}: ${homeName} ${formatStatValue(
              cat.stat,
              cat.home,
            )}, ${awayName} ${formatStatValue(cat.stat, cat.away)}, ${
              homeWin ? 'win' : awayWin ? 'loss' : 'tie'
            }`}
          >
            <Text style={[styles.statLabel, { color: c.text }]} numberOfLines={1}>
              {cat.stat}
            </Text>

            <Text
              style={[
                styles.value,
                styles.valueLeft,
                { color: homeWin ? c.accent : c.secondaryText, fontWeight: homeWin ? '700' : '500' },
              ]}
              numberOfLines={1}
            >
              {formatStatValue(cat.stat, cat.home)}
            </Text>

            {/* Lead bar — wider gold segment is the category winner. */}
            <View style={[styles.barTrack, { backgroundColor: c.cardAlt }]}>
              <View
                style={[
                  styles.barSeg,
                  { flex: share, backgroundColor: homeWin ? c.accent : mutedSeg },
                ]}
              />
              <View
                style={[
                  styles.barSeg,
                  { flex: 1 - share, backgroundColor: awayWin ? c.accent : mutedSeg },
                ]}
              />
            </View>

            <Text
              style={[
                styles.value,
                styles.valueRight,
                { color: awayWin ? c.accent : c.secondaryText, fontWeight: awayWin ? '700' : '500' },
              ]}
              numberOfLines={1}
            >
              {formatStatValue(cat.stat, cat.away)}
            </Text>

            <Text style={[styles.result, { color: resultColor }]}>{resultLabel}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: s(10),
    paddingHorizontal: s(12),
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: s(10),
  },
  teamName: {
    flex: 1,
    fontFamily: Fonts.varsityBold,
    fontSize: ms(12),
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  record: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(20),
    letterSpacing: 0.5,
    fontVariant: ['tabular-nums'],
    paddingHorizontal: s(10),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(7),
  },
  statLabel: {
    width: s(36),
    fontFamily: Fonts.varsityBold,
    fontSize: ms(11),
    letterSpacing: 0.6,
  },
  value: {
    width: s(44),
    fontFamily: Fonts.mono,
    fontSize: ms(14),
    fontVariant: ['tabular-nums'],
  },
  valueLeft: {
    textAlign: 'right',
  },
  valueRight: {
    textAlign: 'left',
  },
  barTrack: {
    flex: 1,
    flexDirection: 'row',
    height: s(7),
    borderRadius: s(4),
    overflow: 'hidden',
    marginHorizontal: s(10),
  },
  barSeg: {
    height: '100%',
  },
  result: {
    width: s(20),
    textAlign: 'center',
    fontFamily: Fonts.varsityBold,
    fontSize: ms(13),
    letterSpacing: 0.5,
  },
});
