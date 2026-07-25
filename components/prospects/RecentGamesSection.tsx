import { StyleSheet, Text, View } from 'react-native';

import { Section } from '@/components/ui/Section';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors, Fonts } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import type { RecentGame } from '@/types/prospect';
import { ms, s } from '@/utils/scale';

interface RecentGamesSectionProps {
  games: RecentGame[];
}

const COMPETITION_LABEL: Record<RecentGame['competition'], string> = {
  college: 'College',
  'summer-league': 'Summer League',
  nba: 'NBA',
};

/** Format an ISO date (YYYY-MM-DD) as "Jul 12" without pulling in a tz lib. */
function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthIdx = parseInt(m, 10) - 1;
  if (!months[monthIdx] || !d) return iso;
  return `${months[monthIdx]} ${parseInt(d, 10)}`;
}

/**
 * "Recent games" card — the last game lines synced from ESPN (college in
 * season, Las Vegas Summer League in July, NBA once the season starts).
 * Renders nothing for prospects with no coverage (international, HS) so the
 * card never shows a broken empty state.
 */
export function RecentGamesSection({ games }: RecentGamesSectionProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  if (!games.length) return null;

  return (
    <View style={styles.wrap}>
      <Section title="Recent Games">
        {/* Column header */}
        <View style={styles.headerRow}>
          <Text style={[styles.matchup, styles.headerText, { color: c.secondaryText }]}>Game</Text>
          {['MIN', 'PTS', 'REB', 'AST'].map(col => (
            <Text key={col} style={[styles.stat, styles.headerText, { color: c.secondaryText }]}>
              {col}
            </Text>
          ))}
        </View>

        {games.map((g, i) => (
          <View
            key={`${g.competition}-${g.gameDate}-${i}`}
            style={[styles.row, i < games.length - 1 && { borderBottomColor: c.border, borderBottomWidth: StyleSheet.hairlineWidth }]}
            accessibilityLabel={`${COMPETITION_LABEL[g.competition]} ${shortDate(g.gameDate)}${g.opponent ? ` vs ${g.opponent}` : ''}: ${g.points ?? 0} points, ${g.rebounds ?? 0} rebounds, ${g.assists ?? 0} assists`}
          >
            <View style={styles.matchup}>
              <ThemedText type="varsitySmall" style={[styles.comp, { color: c.gold }]}>
                {COMPETITION_LABEL[g.competition]}
              </ThemedText>
              <Text style={[styles.meta, { color: c.text }]} numberOfLines={1}>
                {shortDate(g.gameDate)}{g.opponent ? ` · ${g.opponent}` : ''}
              </Text>
            </View>
            <Text style={[styles.stat, { color: c.text }]}>{g.minutes ?? '—'}</Text>
            <Text style={[styles.stat, { color: c.text }]}>{g.points ?? '—'}</Text>
            <Text style={[styles.stat, { color: c.text }]}>{g.rebounds ?? '—'}</Text>
            <Text style={[styles.stat, { color: c.text }]}>{g.assists ?? '—'}</Text>
          </View>
        ))}
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: s(16),
    marginTop: s(18),
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: s(6),
  },
  headerText: {
    fontSize: ms(9),
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(8),
  },
  matchup: {
    flex: 1,
    minWidth: 0,
  },
  comp: {
    fontSize: ms(9),
    letterSpacing: 1.2,
  },
  meta: {
    fontSize: ms(12),
    marginTop: s(1),
  },
  stat: {
    width: s(38),
    textAlign: 'center',
    fontFamily: Fonts.mono,
    fontSize: ms(13),
    letterSpacing: 0.2,
  },
});
