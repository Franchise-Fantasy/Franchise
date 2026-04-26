import { Image } from "expo-image";
import { ReactNode } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { ThemedText } from "@/components/ui/ThemedText";
import { Colors } from "@/constants/Colors";
import { useActiveLeagueSport } from "@/hooks/useActiveLeagueSport";
import { useColorScheme } from "@/hooks/useColorScheme";
import { PlayerSeasonStats } from "@/types/player";
import { formatPosition } from "@/utils/formatting";
import { getInjuryBadge } from "@/utils/nba/injuryBadge";
import { getPlayerHeadshotUrl, getTeamLogoUrl, PLAYER_SILHOUETTE } from "@/utils/nba/playerHeadshot";
import { ms, s } from "@/utils/scale";


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
  const sport = useActiveLeagueSport();

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
        const url = getPlayerHeadshotUrl(player.external_id_nba, sport);
        return (
          <View
            style={[
              styles.headshotCircle,
              { borderColor: c.heritageGold, backgroundColor: c.cardAlt },
            ]}
            accessibilityLabel={`${player.name} headshot`}
          >
            <Image
              source={url ? { uri: url } : PLAYER_SILHOUETTE}
              style={styles.headshotImg}
              contentFit="cover"
              cachePolicy="memory-disk"
              recyclingKey={url ?? "silhouette"}
              placeholder={PLAYER_SILHOUETTE}
            />
          </View>
        );
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
            const logoUrl = getTeamLogoUrl(player.pro_team, sport);
            return logoUrl ? (
              <Image
                source={{ uri: logoUrl }}
                style={styles.teamLogo}
                contentFit="contain"
                cachePolicy="memory-disk"
                recyclingKey={logoUrl}
              />
            ) : null;
          })()}
          <ThemedText style={[styles.team, { color: c.secondaryText }]}>
            {player.pro_team}
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
    paddingVertical: s(10),
    paddingHorizontal: s(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  position: {
    width: s(32),
    fontSize: ms(12),
    fontWeight: "600",
  },
  headshotCircle: {
    width: s(44),
    height: s(44),
    borderRadius: 23,
    borderWidth: 1.5,
    overflow: "hidden",
    marginRight: s(8),
  },
  headshotImg: {
    position: "absolute" as const,
    bottom: s(-2),
    left: 0,
    right: 0,
    height: s(40),
  },
  info: {
    flex: 1,
    marginRight: s(8),
  },
  nameRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: s(4),
  },
  badge: {
    paddingHorizontal: s(4),
    paddingVertical: s(1),
    borderRadius: 3,
  },
  badgeText: {
    fontSize: ms(8),
    fontWeight: "800" as const,
    letterSpacing: 0.5,
  },
  teamRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: s(3),
    marginTop: s(1),
  },
  teamLogo: {
    width: s(12),
    height: s(12),
    opacity: 0.5,
  },
  team: {
    fontSize: ms(11),
  },
  stats: {
    alignItems: "flex-end",
    marginRight: s(8),
  },
  statLine: {
    fontSize: ms(12),
  },
  fpts: {
    fontSize: ms(11),
    fontWeight: "600",
    marginTop: s(1),
  },
});
