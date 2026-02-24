import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { PlayerSeasonStats } from '@/types/player';
import { formatPosition } from '@/utils/formatting';
import { getInjuryBadge } from '@/utils/injuryBadge';
import { ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface PlayerCardProps {
  player: PlayerSeasonStats;
  fantasyPoints?: number;
  onPress?: () => void;
  rightElement?: ReactNode;
}

export function PlayerCard({ player, fantasyPoints, onPress, rightElement }: PlayerCardProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <TouchableOpacity
      style={[styles.container, { borderBottomColor: c.border }]}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <ThemedText style={[styles.position, { color: c.secondaryText }]}>
        {formatPosition(player.position)}
      </ThemedText>
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <ThemedText type="defaultSemiBold" numberOfLines={1} style={{ flexShrink: 1 }}>
            {player.name}
          </ThemedText>
          {(() => {
            const badge = getInjuryBadge(player.status);
            return badge ? (
              <View style={[styles.badge, { backgroundColor: badge.color }]}>
                <Text style={styles.badgeText}>{badge.label}</Text>
              </View>
            ) : null;
          })()}
        </View>
        <ThemedText style={[styles.team, { color: c.secondaryText }]}>
          {player.nba_team}
        </ThemedText>
      </View>
      <View style={styles.stats}>
        <ThemedText style={[styles.statLine, { color: c.secondaryText }]}>
          {player.avg_pts}/{player.avg_reb}/{player.avg_ast}
        </ThemedText>
        {fantasyPoints !== undefined && (
          <ThemedText style={[styles.fpts, { color: c.accent }]}>
            {fantasyPoints} FPTS
          </ThemedText>
        )}
      </View>
      {rightElement}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  position: {
    width: 32,
    fontSize: 12,
    fontWeight: '600',
  },
  info: {
    flex: 1,
    marginRight: 8,
  },
  nameRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
  },
  badge: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  badgeText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '800' as const,
    letterSpacing: 0.5,
  },
  team: {
    fontSize: 11,
    marginTop: 1,
  },
  stats: {
    alignItems: 'flex-end',
    marginRight: 8,
  },
  statLine: {
    fontSize: 12,
  },
  fpts: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
});
