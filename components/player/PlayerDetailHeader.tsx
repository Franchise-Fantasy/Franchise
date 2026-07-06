import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { StyleSheet, TouchableOpacity, View } from "react-native";

import { PlayerHeadshotImage } from "@/components/player/PlayerHeadshotImage";
import { Badge } from "@/components/ui/Badge";
import { ThemedText } from "@/components/ui/ThemedText";
import { Sport } from "@/constants/LeagueDefaults";
import { useColors } from "@/hooks/useColors";
import { PlayerSeasonStats } from "@/types/player";
import { formatPosition } from "@/utils/formatting";
import { getInjuryBadge } from "@/utils/nba/injuryBadge";
import { getTeamLogoUrl } from "@/utils/nba/playerHeadshot";
import { calculateAge } from "@/utils/roster/rosterAge";
import { ms, s } from "@/utils/scale";

interface PlayerDetailHeaderProps {
  player: PlayerSeasonStats;
  sport: Sport;
  /** Pro-team games played so far this season — the GP denominator. */
  teamGamesPlayed: number | undefined;
  /** Player news flags a minutes restriction. */
  hasMinutesRestriction: boolean;
  ownership: {
    isOnMyTeam: boolean;
    isOwnedByOther: boolean;
    ownerName: string | null;
    isFreeAgent: boolean;
  };
  lock: { draftLocked: boolean; offseasonLocked: boolean };
  isWatched: boolean;
  onToggleWatchlist: () => void;
  /** Show the trade-swap quick action (own non-IR player or owned-by-other). */
  canTrade: boolean;
  onTrade: () => void;
  onClose: () => void;
}

/**
 * Brand hero header for the player detail sheet — gold-ringed headshot with
 * injury/min-restriction chips, AlfaSlab name, identity eyebrow, and
 * ownership/lock status badges. Pure presentation; all roster actions live
 * in PlayerActionBar (the docked footer).
 */
export function PlayerDetailHeader({
  player,
  sport,
  teamGamesPlayed,
  hasMinutesRestriction,
  ownership,
  lock,
  isWatched,
  onToggleWatchlist,
  canTrade,
  onTrade,
  onClose,
}: PlayerDetailHeaderProps) {
  const c = useColors();
  const injury = getInjuryBadge(player.status);
  const logoUrl = getTeamLogoUrl(player.pro_team, sport);

  return (
    <View style={[styles.header, { borderBottomColor: c.border }]}>
      {/* Portrait with status chips */}
      <View style={styles.headshotWrap}>
        <View
          style={[
            styles.headshotRing,
            { borderColor: c.heritageGold, backgroundColor: c.cardAlt },
          ]}
          accessibilityLabel={`${player.name} headshot`}
        >
          <PlayerHeadshotImage
            externalIdNba={player.external_id_nba}
            sport={sport}
            style={styles.headshotImg}
            res="full"
          />
        </View>
        <View style={styles.chipStack} pointerEvents="none">
          {injury && (
            <View
              style={[styles.statusChip, { backgroundColor: injury.color }]}
              accessibilityLabel={`Injury status: ${injury.label}`}
            >
              <ThemedText type="varsitySmall" style={styles.statusChipText}>
                {injury.label}
              </ThemedText>
            </View>
          )}
          {hasMinutesRestriction && (
            <View
              style={[styles.statusChip, { backgroundColor: c.warning }]}
              accessibilityLabel="Minutes restriction"
            >
              <ThemedText type="varsitySmall" style={styles.statusChipText}>
                MIN
              </ThemedText>
            </View>
          )}
        </View>
      </View>

      {/* Identity */}
      <View style={styles.info}>
        <ThemedText
          type="display"
          style={styles.name}
          numberOfLines={1}
          accessibilityRole="header"
        >
          {player.name}
        </ThemedText>

        <View style={styles.eyebrowRow}>
          {logoUrl && (
            <Image
              source={{ uri: logoUrl }}
              style={styles.teamLogo}
              contentFit="contain"
              cachePolicy="memory-disk"
              recyclingKey={logoUrl}
            />
          )}
          <ThemedText
            type="varsitySmall"
            style={[styles.eyebrow, { color: c.secondaryText }]}
            numberOfLines={1}
          >
            {player.pro_team} · {formatPosition(player.position)}
            {player.birthdate ? ` · ${calculateAge(player.birthdate)}Y` : ""}
            {" · "}
            {player.games_played}
            {teamGamesPlayed ? `/${teamGamesPlayed}` : ""} GP
          </ThemedText>
        </View>

        <View style={styles.badgesRow}>
          <View style={styles.badges}>
            {ownership.isOnMyTeam ? (
              <Badge label="Your Team" variant="gold" />
            ) : ownership.isOwnedByOther ? (
              <Badge label={ownership.ownerName ?? "Rostered"} variant="neutral" />
            ) : ownership.isFreeAgent ? (
              <Badge label="Free Agent" variant="neutral" />
            ) : null}
            {lock.draftLocked && <Badge label="Draft Locked" variant="warning" />}
          </View>

          <View style={styles.iconRow}>
            {canTrade && (
              <TouchableOpacity
                onPress={onTrade}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Trade ${player.name}`}
              >
                <Ionicons name="swap-horizontal" size={ms(21)} color={c.secondaryText} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={onToggleWatchlist}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={
                isWatched
                  ? `Remove ${player.name} from watchlist`
                  : `Add ${player.name} to watchlist`
              }
            >
              <Ionicons
                name={isWatched ? "eye" : "eye-outline"}
                size={ms(21)}
                color={isWatched ? c.link : c.secondaryText}
              />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <TouchableOpacity
        onPress={onClose}
        hitSlop={8}
        style={styles.closeBtn}
        accessibilityRole="button"
        accessibilityLabel="Close player details"
      >
        <Ionicons name="close" size={ms(24)} color={c.secondaryText} />
      </TouchableOpacity>
    </View>
  );
}

const HEADSHOT = s(72);

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: s(16),
    paddingBottom: s(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headshotWrap: {
    position: "relative",
    marginRight: s(12),
  },
  headshotRing: {
    width: HEADSHOT,
    height: HEADSHOT,
    borderRadius: HEADSHOT / 2,
    borderWidth: 1.5,
    overflow: "hidden",
  },
  headshotImg: {
    position: "absolute",
    bottom: s(-2),
    left: 0,
    right: 0,
    height: s(66),
  },
  chipStack: {
    position: "absolute",
    top: s(-4),
    left: s(-6),
    gap: s(3),
  },
  statusChip: {
    paddingHorizontal: s(4),
    paddingVertical: s(1),
    borderRadius: 3,
    alignSelf: "flex-start",
  },
  statusChipText: {
    color: "#FFFFFF",
    fontSize: ms(8),
    letterSpacing: 0.5,
  },
  info: {
    flex: 1,
    paddingTop: s(2),
  },
  name: {
    fontSize: ms(23),
    lineHeight: ms(29),
  },
  eyebrowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(5),
    marginTop: s(3),
  },
  teamLogo: {
    width: s(15),
    height: s(15),
    opacity: 0.7,
  },
  eyebrow: {
    flexShrink: 1,
    fontSize: ms(10),
  },
  badgesRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(12),
    marginTop: s(9),
  },
  badges: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(6),
    flexShrink: 1,
  },
  iconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(16),
  },
  closeBtn: {
    padding: s(2),
    marginLeft: s(8),
  },
});
