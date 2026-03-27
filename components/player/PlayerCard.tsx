import { ThemedText } from "@/components/ThemedText";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";
import { PlayerSeasonStats } from "@/types/player";
import { formatPosition } from "@/utils/formatting";
import { getInjuryBadge } from "@/utils/injuryBadge";
import { getPlayerHeadshotUrl, getTeamLogoUrl } from "@/utils/playerHeadshot";
import { ReactNode } from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";

interface PlayerCardProps {
  player: PlayerSeasonStats;
  fantasyPoints?: number;
  onPress?: () => void;
  rightElement?: ReactNode;
}

export function PlayerCard({
  player,
  fantasyPoints,
  onPress,
  rightElement,
}: PlayerCardProps) {
  const scheme = useColorScheme() ?? "light";
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
      {(() => {
        const url = getPlayerHeadshotUrl(player.external_id_nba);
        return url ? (
          <View
            style={[
              styles.headshotCircle,
              { borderColor: c.gold, backgroundColor: c.cardAlt },
            ]}
            accessibilityLabel={`${player.name} headshot`}
          >
            <Image
              source={{ uri: url }}
              style={styles.headshotImg}
              resizeMode="cover"
            />
          </View>
        ) : null;
      })()}
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <ThemedText
            type="defaultSemiBold"
            numberOfLines={1}
            style={{ flexShrink: 1 }}
          >
            {player.name}
          </ThemedText>
          {(() => {
            const badge = getInjuryBadge(player.status);
            return badge ? (
              <View style={[styles.badge, { backgroundColor: badge.color }]}>
                <Text style={[styles.badgeText, { color: c.statusText }]}>{badge.label}</Text>
              </View>
            ) : null;
          })()}
        </View>
        <View style={styles.teamRow}>
          {(() => {
            const logoUrl = getTeamLogoUrl(player.nba_team);
            return logoUrl ? (
              <Image
                source={{ uri: logoUrl }}
                style={styles.teamLogo}
                resizeMode="contain"
              />
            ) : null;
          })()}
          <ThemedText style={[styles.team, { color: c.secondaryText }]}>
            {player.nba_team}
          </ThemedText>
        </View>
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
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  position: {
    width: 32,
    fontSize: 12,
    fontWeight: "600",
  },
  headshotCircle: {
    width: 44,
    height: 44,
    borderRadius: 23,
    borderWidth: 1.5,
    overflow: "hidden",
    marginRight: 8,
  },
  headshotImg: {
    position: "absolute" as const,
    bottom: -2,
    left: 0,
    right: 0,
    height: 40,
  },
  info: {
    flex: 1,
    marginRight: 8,
  },
  nameRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
  },
  badge: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: 8,
    fontWeight: "800" as const,
    letterSpacing: 0.5,
  },
  teamRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 3,
    marginTop: 1,
  },
  teamLogo: {
    width: 12,
    height: 12,
    opacity: 0.5,
  },
  team: {
    fontSize: 11,
  },
  stats: {
    alignItems: "flex-end",
    marginRight: 8,
  },
  statLine: {
    fontSize: 12,
  },
  fpts: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: 1,
  },
});
