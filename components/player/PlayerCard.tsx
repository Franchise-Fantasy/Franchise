import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { PlayerSeasonStats } from '@/types/player';
import { formatPosition } from '@/utils/formatting';
import { ReactNode } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

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
        <ThemedText type="defaultSemiBold" numberOfLines={1}>
          {player.name}
        </ThemedText>
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
