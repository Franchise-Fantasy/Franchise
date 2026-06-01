import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Badge } from '@/components/ui/Badge';
import { SportBadge } from '@/components/ui/SportBadge';
import { type Sport } from '@/constants/LeagueDefaults';
import { s } from '@/utils/scale';

const FORMAT_LABEL: Record<string, string> = {
  dynasty: 'Dynasty',
  keeper: 'Keeper',
  redraft: 'Redraft',
};

const SCORING_LABEL: Record<string, string> = {
  points: 'Points',
  h2h_categories: 'H2H Categories',
};

/** Display label for a league_type, falling back to the raw value. */
export function formatLeagueType(leagueType?: string | null): string | null {
  return leagueType ? FORMAT_LABEL[leagueType] ?? leagueType : null;
}

/** Display label for a scoring_type, falling back to the raw value. */
export function formatScoringType(scoringType?: string | null): string | null {
  return scoringType ? SCORING_LABEL[scoringType] ?? scoringType : null;
}

type Props = {
  sport?: Sport | string | null;
  leagueType?: string | null;
  scoringType?: string | null;
  /** Compact pills for dense list rows (matches join-league). */
  size?: 'default' | 'small';
  /** Container override — e.g. center + wrap on create-team/home. */
  style?: StyleProp<ViewStyle>;
};

/**
 * Sport / format / scoring identity chips for a league. Single source of
 * the format + scoring label maps so create-team, join-league, and the
 * home header don't each carry their own copy and drift.
 */
export function LeagueMetaChips({ sport, leagueType, scoringType, size = 'default', style }: Props) {
  const formatLabel = formatLeagueType(leagueType);
  const scoringLabel = formatScoringType(scoringType);

  if (!sport && !formatLabel && !scoringLabel) return null;

  return (
    <View style={[styles.row, style]}>
      {sport && <SportBadge sport={sport as Sport} />}
      {formatLabel && <Badge label={formatLabel} variant="neutral" size={size} />}
      {scoringLabel && <Badge label={scoringLabel} variant="neutral" size={size} />}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: s(6),
  },
});
