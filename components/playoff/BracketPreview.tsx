import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import {
  buildStandardRound1,
  calcByes,
  calcRounds,
  getPlayoffRoundLabel,
} from '@/utils/league/playoff';
import { ms, s } from '@/utils/scale';

type Props = {
  /** Number of teams that make the playoffs (already validated upstream). */
  playoffTeams: number;
  style?: StyleProp<ViewStyle>;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Schematic, data-free preview of the single-elimination bracket a given
 * playoff-team count produces. Renders round 1 (the only round whose exact
 * matchups are format-independent) plus byes, and captions the remaining
 * rounds. Because the engine plays exactly one round per playoff week, the
 * round count IS the playoff-week count — surfacing that here makes the
 * teams ↔ weeks relationship legible while configuring a league.
 *
 * Seeds are shown as numbers (#1…#N); no real teams exist yet at config time.
 */
export function BracketPreview({ playoffTeams, style }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  if (playoffTeams < 2) return null;

  const rounds = calcRounds(playoffTeams);
  const byes = calcByes(playoffTeams);

  // Round 1 pairings from synthetic seeds (#1…#N). teamB === null marks a bye.
  const seeds = Array.from({ length: playoffTeams }, (_, i) => ({
    teamId: String(i + 1),
    seed: i + 1,
  }));
  const round1 = buildStandardRound1(seeds);
  const games = round1.filter((p) => p.teamB !== null);
  const byeSeeds = round1
    .filter((p) => p.teamB === null)
    .map((p) => p.teamA.seed)
    .sort((a, b) => a - b);

  const round1Label = getPlayoffRoundLabel(1, rounds, false);
  // Byes always advance to round 2 (byes only exist when rounds >= 2).
  const byeDestination = getPlayoffRoundLabel(2, rounds, false);

  // Rounds 2…N as a "Semifinals (Wk 2) → Finals (Wk 3)" progression.
  const laterRounds = Array.from({ length: rounds - 1 }, (_, i) => {
    const round = i + 2;
    return `${getPlayoffRoundLabel(round, rounds, false)} (Wk ${round})`;
  }).join('  →  ');

  const a11yLabel =
    `Playoff bracket preview: ${plural(playoffTeams, 'team')}, ` +
    `${plural(rounds, 'round')} over ${plural(rounds, 'playoff week')}` +
    (byes > 0 ? `, ${plural(byes, 'first-round bye')}` : '');

  const Chip = ({ seed }: { seed: number }) => (
    <View style={[styles.chip, { backgroundColor: c.background, borderColor: c.border }]}>
      <ThemedText style={[styles.chipText, { color: c.text }]}>#{seed}</ThemedText>
    </View>
  );

  return (
    <View
      accessible
      accessibilityLabel={a11yLabel}
      style={[styles.wrap, { backgroundColor: c.card, borderColor: c.border }, style]}
    >
      <ThemedText type="varsitySmall" style={[styles.roundLabel, { color: c.secondaryText }]}>
        {round1Label} · Week 1
      </ThemedText>

      {games.map((p, i) => (
        <View key={`g${i}`} style={styles.matchRow}>
          <Chip seed={p.teamA.seed} />
          <ThemedText style={[styles.vs, { color: c.secondaryText }]}>vs</ThemedText>
          <Chip seed={p.teamB!.seed} />
        </View>
      ))}

      {byeSeeds.map((seed) => (
        <View key={`b${seed}`} style={styles.matchRow}>
          <Chip seed={seed} />
          <ThemedText style={[styles.byeText, { color: c.secondaryText }]}>
            bye → {byeDestination}
          </ThemedText>
        </View>
      ))}

      {laterRounds.length > 0 && (
        <ThemedText style={[styles.later, { color: c.secondaryText }]}>{laterRounds}</ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'stretch',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: s(12),
    paddingVertical: s(12),
    paddingHorizontal: s(14),
    gap: s(8),
  },
  roundLabel: {
    fontSize: ms(10),
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: s(8),
    paddingVertical: s(4),
    paddingHorizontal: s(9),
    minWidth: s(38),
    alignItems: 'center',
  },
  chipText: {
    fontSize: ms(13),
    fontWeight: '700',
  },
  vs: {
    fontSize: ms(11),
  },
  byeText: {
    fontSize: ms(12),
  },
  later: {
    fontSize: ms(12),
    marginTop: s(2),
  },
});
