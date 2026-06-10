import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { PlayerName } from '@/components/player/PlayerName';
import { PlayerPortrait } from '@/components/player/PlayerPortrait';
import { Badge } from '@/components/ui/Badge';
import { ThemedText } from '@/components/ui/ThemedText';
import { type Sport } from '@/constants/LeagueDefaults';
import type { CompareCandidate } from '@/context/CompareSelectionProvider';
import { useColors } from '@/hooks/useColors';
import { formatPosition } from '@/utils/formatting';
import { getInjuryBadge } from '@/utils/nba/injuryBadge';
import { ms, s } from '@/utils/scale';

interface CompareColumnProps {
  candidate: CompareCandidate;
  sport: Sport;
  width: number;
  height: number;
  /** Category-league 9-cat win count badge, e.g. "Wins 5". */
  winsLabel?: string | null;
  onRemove?: () => void;
}

/** One player's header card at the top of a comparison column: headshot +
 *  team medallion + name + position, with an optional remove button and a
 *  category-league win tally. */
export function CompareColumn({
  candidate,
  sport,
  width,
  height,
  winsLabel,
  onRemove,
}: CompareColumnProps) {
  const c = useColors();
  const injury = getInjuryBadge(candidate.seasonStats?.status ?? '');

  return (
    <View
      style={[styles.column, { width, height, borderColor: c.border }]}
      accessibilityRole="header"
      accessibilityLabel={`${candidate.name}, ${formatPosition(candidate.position)}, ${candidate.pro_team}`}
    >
      {onRemove && (
        <TouchableOpacity
          style={styles.remove}
          onPress={onRemove}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${candidate.name} from comparison`}
        >
          <Ionicons name="close-circle" size={ms(18)} color={c.secondaryText} />
        </TouchableOpacity>
      )}

      <PlayerPortrait
        externalIdNba={candidate.external_id_nba}
        proTeam={candidate.pro_team}
        sport={sport}
        size={s(52)}
        imageHeight={s(44)}
        accessible={false}
        containerStyle={styles.portrait}
      />

      <PlayerName
        name={candidate.name}
        type="defaultSemiBold"
        style={styles.name}
        containerStyle={styles.nameWrap}
      />
      <View style={styles.metaRow}>
        <ThemedText style={[styles.pos, { color: c.secondaryText }]} numberOfLines={1}>
          {formatPosition(candidate.position)}
        </ThemedText>
        {injury && (
          <Badge label={injury.label} size="small" backgroundColor={injury.color} textColor={c.statusText} />
        )}
      </View>
      {winsLabel ? (
        <Badge label={winsLabel} variant="gold" size="small" style={styles.wins} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: s(4),
    paddingTop: s(10),
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  remove: {
    position: 'absolute',
    top: s(2),
    right: s(2),
    zIndex: 2,
  },
  portrait: { marginBottom: s(4) },
  name: { fontSize: ms(13), textAlign: 'center' },
  nameWrap: { alignSelf: 'stretch' },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
    marginTop: s(1),
  },
  pos: { fontSize: ms(10) },
  wins: { marginTop: s(3) },
});
