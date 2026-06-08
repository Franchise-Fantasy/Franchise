import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useState } from "react";
import {
  Alert,
  Animated,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { PlayerHeadshotImage } from "@/components/player/PlayerHeadshotImage";
import { LogoSpinner } from "@/components/ui/LogoSpinner";
import { ThemedText } from "@/components/ui/ThemedText";
import { Fonts } from "@/constants/Colors";
import { DialogHost, useConfirm } from "@/context/ConfirmProvider";
import { useActiveLeagueSport } from "@/hooks/useActiveLeagueSport";
import { useColors } from "@/hooks/useColors";
import { PlayerSeasonStats } from "@/types/player";
import { formatPosition } from "@/utils/formatting";
import { GameTimeMap, isGameStarted } from "@/utils/nba/gameStarted";
import { getInjuryBadge } from "@/utils/nba/injuryBadge";
import { getTeamLogoUrl } from "@/utils/nba/playerHeadshot";
import { ms, s } from "@/utils/scale";
import { calculateAvgFantasyPoints } from "@/utils/scoring/fantasyPoints";

import { playerDetailStyles as sheetStyles } from "./playerDetailStyles";

interface DropPickerModalProps {
  player: PlayerSeasonStats;
  rosterPlayers: PlayerSeasonStats[] | undefined;
  isProcessing: boolean;
  activateFromIR: boolean;
  startInDropPicker?: boolean;
  startInActivateFromIR?: boolean;
  needsWaiverClaim: boolean;
  scoringWeights: Parameters<typeof calculateAvgFantasyPoints>[1] | undefined;
  /** Categories leagues have no fantasy points — hides the FPTS readout */
  isCategories: boolean;
  playerLockType: "daily" | "individual" | undefined;
  gameTimeMap: GameTimeMap;
  translateY: Animated.Value;
  panHandlers: object;
  onClose: () => void;
  onDismissDropPicker: () => void;
  onDropForClaim: ((dropPlayer: PlayerSeasonStats) => void) | undefined;
  onDropAndActivateFromIR: (dropPlayer: PlayerSeasonStats) => void;
  onDropPlayer: (dropPlayer: PlayerSeasonStats) => void;
  onSubmitWaiverClaim: (dropPlayerId?: string) => Promise<void>;
}

function pct(made: number | null, attempted: number | null): string {
  if (!attempted || attempted <= 0) return "–";
  return (((made ?? 0) / attempted) * 100).toFixed(1);
}

function fmt(v: number | null | undefined, digits = 1): string {
  return v == null ? "–" : v.toFixed(digits);
}

export function DropPickerModal({
  player,
  rosterPlayers,
  isProcessing,
  activateFromIR,
  startInDropPicker,
  startInActivateFromIR,
  needsWaiverClaim,
  scoringWeights,
  isCategories,
  playerLockType,
  gameTimeMap,
  translateY,
  panHandlers,
  onClose,
  onDismissDropPicker,
  onDropForClaim,
  onDropAndActivateFromIR,
  onDropPlayer,
  onSubmitWaiverClaim,
}: DropPickerModalProps) {
  const c = useColors();
  const sport = useActiveLeagueSport();
  const confirm = useConfirm();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const dropCandidates = (rosterPlayers ?? []).filter(
    (p) => playerLockType === "daily" || !isGameStarted(p.pro_team, gameTimeMap),
  );

  const eyebrow = activateFromIR
    ? "ACTIVATE FROM IR"
    : needsWaiverClaim || onDropForClaim
      ? "WAIVER CLAIM"
      : "ADD PLAYER";

  const subtitle = activateFromIR
    ? `Your active roster is full. Pick a player to drop so ${player.name} can come off IR.`
    : `Your roster is full. Pick a player to drop to make room for ${player.name}.`;

  const triggerDrop = (item: PlayerSeasonStats) => {
    if (activateFromIR) {
      confirm({
        title: "Confirm Transaction",
        message: `Drop ${item.name} to activate ${player.name} from IR?`,
        action: {
          label: "Confirm",
          destructive: true,
          onPress: () => onDropAndActivateFromIR(item),
        },
      });
    } else if (onDropForClaim) {
      confirm({
        title: "Select Drop for Claim",
        message: `Drop ${item.name} when your claim for ${player.name} processes?`,
        action: {
          label: "Confirm",
          onPress: () => {
            onDropForClaim(item);
            onClose();
          },
        },
      });
    } else if (needsWaiverClaim) {
      confirm({
        title: "Select Drop for Claim",
        message: `Drop ${item.name} when your claim for ${player.name} processes?`,
        action: {
          label: "Submit Claim",
          onPress: async () => {
            try {
              await onSubmitWaiverClaim(item.player_id);
              onClose();
            } catch (err: any) {
              Alert.alert("Error", err.message ?? "Failed to submit claim");
            }
          },
        },
      });
    } else {
      confirm({
        title: "Confirm Transaction",
        message: `Drop ${item.name} to add ${player.name}?`,
        action: {
          label: "Confirm",
          destructive: true,
          onPress: () => onDropPlayer(item),
        },
      });
    }
  };

  const renderRow = ({
    item,
    index,
  }: {
    item: PlayerSeasonStats;
    index: number;
  }) => {
    const fpts = scoringWeights && !isCategories
      ? calculateAvgFantasyPoints(item, scoringWeights)
      : null;
    const badge = getInjuryBadge(item.status);
    const logoUrl = getTeamLogoUrl(item.pro_team, sport);
    const isExpanded = expandedId === item.player_id;
    const isLast = index === dropCandidates.length - 1;

    const topStats = [
      { label: "MIN", value: fmt(item.avg_min) },
      { label: "FG%", value: pct(item.total_fgm, item.total_fga) },
      { label: "3P%", value: pct(item.total_3pm, item.total_3pa) },
      { label: "FT%", value: pct(item.total_ftm, item.total_fta) },
    ];
    const bottomStats = [
      { label: "STL", value: fmt(item.avg_stl) },
      { label: "BLK", value: fmt(item.avg_blk) },
      { label: "TOV", value: fmt(item.avg_tov) },
      { label: "GP", value: item.games_played != null ? String(item.games_played) : "–" },
    ];

    return (
      <View
        style={[
          styles.rowWrap,
          { backgroundColor: c.card },
          !isLast && {
            borderBottomColor: c.border,
            borderBottomWidth: StyleSheet.hairlineWidth,
          },
        ]}
      >
        <TouchableOpacity
          style={styles.row}
          accessibilityRole="button"
          accessibilityLabel={`${item.name}, ${formatPosition(item.position)}, ${item.pro_team}${fpts !== null ? `, ${fpts} fantasy points` : ""}`}
          accessibilityHint={
            isExpanded
              ? "Double tap to collapse preview"
              : "Double tap to expand preview and reveal drop button"
          }
          accessibilityState={{ expanded: isExpanded }}
          onPress={() =>
            setExpandedId(isExpanded ? null : item.player_id)
          }
          disabled={isProcessing}
          activeOpacity={0.7}
        >
          <ThemedText
            type="varsitySmall"
            style={[styles.position, { color: c.secondaryText }]}
          >
            {formatPosition(item.position)}
          </ThemedText>
          <View
            style={[
              styles.headshotCircle,
              { borderColor: c.heritageGold, backgroundColor: c.cardAlt },
            ]}
            accessibilityLabel={`${item.name} headshot`}
          >
            <PlayerHeadshotImage
              externalIdNba={item.external_id_nba}
              sport={sport}
              style={styles.headshotImg}
              accessible={false}
            />
          </View>
          <View style={styles.info}>
            <View style={styles.nameRow}>
              <ThemedText
                type="defaultSemiBold"
                numberOfLines={1}
                style={styles.nameText}
              >
                {item.name}
              </ThemedText>
              {badge && (
                <View
                  style={[styles.injuryBadge, { backgroundColor: badge.color }]}
                >
                  <Text style={[styles.injuryText, { color: c.statusText }]}>
                    {badge.label}
                  </Text>
                </View>
              )}
            </View>
            <View style={styles.teamRow}>
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
                style={[styles.teamText, { color: c.secondaryText }]}
              >
                {item.pro_team}
              </ThemedText>
            </View>
          </View>
          <View style={styles.stats}>
            <ThemedText
              style={[styles.slashLine, { color: c.secondaryText }]}
            >
              {fmt(item.avg_pts)}/{fmt(item.avg_reb)}/{fmt(item.avg_ast)}
            </ThemedText>
            {fpts !== null && (
              <ThemedText style={[styles.fpts, { color: c.accent }]}>
                {fpts} FPTS
              </ThemedText>
            )}
          </View>
          <Ionicons
            name={isExpanded ? "chevron-up" : "chevron-down"}
            size={ms(16)}
            color={c.secondaryText}
            style={styles.chevron}
          />
        </TouchableOpacity>

        {isExpanded && (
          <View
            style={[
              styles.expandedPanel,
              { backgroundColor: c.cardAlt, borderTopColor: c.border },
            ]}
          >
            <View
              style={[styles.statGrid, { borderColor: c.border }]}
              accessibilityLabel={`Season averages for ${item.name}`}
            >
              {topStats.map((stat, i) => (
                <View
                  key={stat.label}
                  style={[
                    styles.statCell,
                    i < topStats.length - 1 && {
                      borderRightColor: c.border,
                      borderRightWidth: StyleSheet.hairlineWidth,
                    },
                  ]}
                >
                  <ThemedText
                    type="varsitySmall"
                    style={[styles.statLabel, { color: c.secondaryText }]}
                  >
                    {stat.label}
                  </ThemedText>
                  <ThemedText style={[styles.statValue, { color: c.text }]}>
                    {stat.value}
                  </ThemedText>
                </View>
              ))}
            </View>
            <View
              style={[
                styles.statGrid,
                {
                  borderColor: c.border,
                  borderTopWidth: StyleSheet.hairlineWidth,
                },
              ]}
            >
              {bottomStats.map((stat, i) => (
                <View
                  key={stat.label}
                  style={[
                    styles.statCell,
                    i < bottomStats.length - 1 && {
                      borderRightColor: c.border,
                      borderRightWidth: StyleSheet.hairlineWidth,
                    },
                  ]}
                >
                  <ThemedText
                    type="varsitySmall"
                    style={[styles.statLabel, { color: c.secondaryText }]}
                  >
                    {stat.label}
                  </ThemedText>
                  <ThemedText style={[styles.statValue, { color: c.text }]}>
                    {stat.value}
                  </ThemedText>
                </View>
              ))}
            </View>
            <TouchableOpacity
              style={[styles.dropBtn, { backgroundColor: c.danger }]}
              accessibilityRole="button"
              accessibilityLabel={`Drop ${item.name}`}
              onPress={() => triggerDrop(item)}
              disabled={isProcessing}
            >
              <Text style={[styles.dropBtnText, { color: c.statusText }]}>
                {activateFromIR
                  ? `DROP TO ACTIVATE ${player.name.toUpperCase()}`
                  : needsWaiverClaim || onDropForClaim
                    ? `DROP ${item.name.toUpperCase()} ON CLAIM`
                    : `DROP ${item.name.toUpperCase()}`}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const onHeaderClose =
    startInDropPicker || startInActivateFromIR ? onClose : onDismissDropPicker;

  return (
    <Modal visible animationType="slide" transparent>
      <View style={sheetStyles.overlay}>
        <Animated.View
          style={[
            sheetStyles.sheet,
            { backgroundColor: c.background, transform: [{ translateY }] },
          ]}
          accessibilityViewIsModal={true}
        >
          <View {...panHandlers}>
            <View style={styles.handleWrap} pointerEvents="none">
              <View style={[styles.handle, { backgroundColor: c.border }]} />
            </View>
            <View style={[styles.topRule, { backgroundColor: c.gold }]} />
            <View style={[styles.header, { borderBottomColor: c.border }]}>
              <View style={styles.headerText}>
                <ThemedText
                  type="varsitySmall"
                  style={[styles.eyebrow, { color: c.gold }]}
                >
                  {eyebrow}
                </ThemedText>
                <ThemedText
                  type="display"
                  style={[styles.title, { color: c.text }]}
                  accessibilityRole="header"
                >
                  Drop a Player
                </ThemedText>
                <ThemedText
                  style={[styles.subtitle, { color: c.secondaryText }]}
                >
                  {subtitle}
                </ThemedText>
              </View>
              <TouchableOpacity
                onPress={onHeaderClose}
                style={styles.closeButton}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={ms(22)} color={c.secondaryText} />
              </TouchableOpacity>
            </View>
          </View>

          {isProcessing ? (
            <View style={sheetStyles.loading}>
              <LogoSpinner />
            </View>
          ) : (
            <FlatList
              data={dropCandidates}
              renderItem={renderRow}
              keyExtractor={(item) => item.player_id}
              contentContainerStyle={styles.listContent}
              maxToRenderPerBatch={10}
              windowSize={5}
              extraData={expandedId}
              ListEmptyComponent={
                <View style={styles.emptyWrap}>
                  <ThemedText
                    style={{ color: c.secondaryText, textAlign: "center" }}
                  >
                    All your roster players have games that already started. Try
                    again tomorrow.
                  </ThemedText>
                </View>
              }
            />
          )}
        </Animated.View>
        <DialogHost />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  handleWrap: {
    alignItems: "center",
    paddingTop: s(8),
    paddingBottom: s(6),
  },
  handle: {
    width: s(40),
    height: 4,
    borderRadius: 2,
  },
  topRule: {
    height: 2,
    marginHorizontal: s(20),
    marginBottom: s(10),
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: s(20),
    paddingBottom: s(14),
    gap: s(10),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    fontSize: ms(10),
    letterSpacing: 1.3,
    marginBottom: s(4),
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: ms(24),
    lineHeight: ms(28),
    letterSpacing: -0.2,
  },
  subtitle: {
    fontSize: ms(12),
    lineHeight: ms(16),
    marginTop: s(4),
  },
  closeButton: {
    padding: s(2),
    marginTop: s(2),
  },
  listContent: {
    paddingVertical: s(8),
  },
  rowWrap: {
    marginHorizontal: s(12),
    marginVertical: s(4),
    borderRadius: 10,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: s(10),
    paddingHorizontal: s(12),
    gap: s(8),
  },
  position: {
    width: s(28),
    fontSize: ms(10),
    letterSpacing: 1.0,
    textAlign: "left",
  },
  headshotCircle: {
    width: s(44),
    height: s(44),
    borderRadius: s(22),
    borderWidth: 1.5,
    overflow: "hidden",
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
    minWidth: 0,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(4),
  },
  nameText: {
    fontSize: ms(14),
    flexShrink: 1,
  },
  injuryBadge: {
    paddingHorizontal: s(4),
    paddingVertical: 1,
    borderRadius: 3,
  },
  injuryText: {
    fontSize: ms(8),
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  teamRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(3),
    marginTop: s(1),
  },
  teamLogo: {
    width: s(12),
    height: s(12),
    opacity: 0.6,
  },
  teamText: {
    fontSize: ms(11),
  },
  stats: {
    alignItems: "flex-end",
  },
  slashLine: {
    fontSize: ms(12),
  },
  fpts: {
    fontSize: ms(11),
    fontWeight: "600",
    marginTop: s(1),
  },
  chevron: {
    marginLeft: s(2),
  },
  expandedPanel: {
    paddingVertical: s(10),
    paddingHorizontal: s(12),
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: s(10),
  },
  statGrid: {
    flexDirection: "row",
  },
  statCell: {
    flex: 1,
    alignItems: "center",
    paddingVertical: s(8),
  },
  statLabel: {
    fontSize: ms(9),
    letterSpacing: 1.0,
  },
  statValue: {
    fontSize: ms(14),
    fontWeight: "600",
    marginTop: s(2),
  },
  dropBtn: {
    paddingVertical: s(12),
    borderRadius: 8,
    alignItems: "center",
  },
  dropBtnText: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(12),
    letterSpacing: 1.2,
  },
  emptyWrap: {
    padding: s(24),
    alignItems: "center",
  },
});
