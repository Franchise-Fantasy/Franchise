import { Colors, cardShadow } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';
import type { ProspectCardData } from '@/types/prospect';
import { DynastyScoreBadge } from './DynastyScoreBadge';
import { memo, useMemo } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface ProspectCardProps {
  prospect: ProspectCardData;
  rank: number;
  /** Stable handler receiving the prospect so parents can pass a single memoized callback. */
  onOpenProspect: (prospect: ProspectCardData) => void;
  onAddProspectToBoard?: (prospect: ProspectCardData) => void;
  /** Whether this prospect is already on the user's board (disables the add button). */
  alreadyOnBoard?: boolean;
}

function ProspectCardBase({ prospect, rank, onOpenProspect, onAddProspectToBoard, alreadyOnBoard }: ProspectCardProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const initials = useMemo(
    () => prospect.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
    [prospect.name],
  );

  const handlePress = () => onOpenProspect(prospect);
  const handleAdd = () => onAddProspectToBoard?.(prospect);
  const showAdd = !!onAddProspectToBoard && !alreadyOnBoard;

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
      onPress={handlePress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${prospect.name}, ${prospect.position}, ${prospect.school}, dynasty score ${prospect.dynastyValueScore}`}
    >
      {/* Rank number */}
      <Text style={[styles.rank, { color: c.tint }]}>{rank}</Text>

      {/* Avatar with gold ring */}
      <View style={[styles.avatarRing, { borderColor: c.heritageGold }]}>
        {prospect.photoUrl ? (
          <Image
            source={{ uri: prospect.photoUrl }}
            style={styles.avatar}
            accessibilityLabel={`${prospect.name} photo`}
          />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: c.cardAlt }]}>
            <Text style={[styles.initials, { color: c.accent }]}>{initials}</Text>
          </View>
        )}
      </View>

      {/* Player info */}
      <View style={styles.info}>
        <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
          {prospect.name}
        </Text>
        <Text style={[styles.meta, { color: c.secondaryText }]}>
          {prospect.position} · {prospect.school}
          {prospect.classYear ? ` · ${prospect.classYear}` : ''}
        </Text>
      </View>

      {/* Dynasty score pill */}
      {prospect.dynastyValueScore > 0 && (
        <DynastyScoreBadge score={prospect.dynastyValueScore} />
      )}

      {/* Add to board */}
      {showAdd && (
        <TouchableOpacity
          onPress={e => {
            e.stopPropagation();
            handleAdd();
          }}
          hitSlop={8}
          style={[styles.addBtn, { backgroundColor: c.cardAlt }]}
          accessibilityRole="button"
          accessibilityLabel={`Add ${prospect.name} to my board`}
        >
          <Ionicons name="add" size={16} color={c.accent} />
        </TouchableOpacity>
      )}

      {/* Chevron */}
      <Ionicons name="chevron-forward" size={16} color={c.secondaryText} style={styles.chevron} />
    </TouchableOpacity>
  );
}

export const ProspectCard = memo(ProspectCardBase, (prev, next) => (
  prev.rank === next.rank &&
  prev.alreadyOnBoard === next.alreadyOnBoard &&
  prev.onOpenProspect === next.onOpenProspect &&
  prev.onAddProspectToBoard === next.onAddProspectToBoard &&
  prev.prospect.playerId === next.prospect.playerId &&
  prev.prospect.contentfulEntryId === next.prospect.contentfulEntryId &&
  prev.prospect.name === next.prospect.name &&
  prev.prospect.position === next.prospect.position &&
  prev.prospect.school === next.prospect.school &&
  prev.prospect.classYear === next.prospect.classYear &&
  prev.prospect.photoUrl === next.prospect.photoUrl &&
  prev.prospect.dynastyValueScore === next.prospect.dynastyValueScore
));

const styles = StyleSheet.create({
  card: {
    marginHorizontal: s(12),
    marginBottom: s(6),
    borderRadius: 14,
    borderWidth: 1,
    padding: s(10),
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(9),
    ...cardShadow,
  },
  rank: {
    fontSize: ms(18),
    fontWeight: '700',
    minWidth: s(22),
    textAlign: 'center',
  },
  avatarRing: {
    width: s(40),
    height: s(40),
    borderRadius: s(20),
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: s(34),
    height: s(34),
    borderRadius: s(17),
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontSize: ms(11),
    fontWeight: '700',
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: ms(13),
    fontWeight: '700',
  },
  meta: {
    fontSize: ms(10),
    marginTop: 1,
  },
  addBtn: {
    width: s(28),
    height: s(28),
    borderRadius: s(14),
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevron: {
    marginLeft: s(2),
  },
});
