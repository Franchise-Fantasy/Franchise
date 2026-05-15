import { Image } from "expo-image";
import { useCallback, useMemo } from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { MatchupChip } from "@/components/player/MatchupChip";
import { PlayerHeadshotImage } from "@/components/player/PlayerHeadshotImage";
import { SectionEyebrow } from "@/components/roster/SectionEyebrow";
import { LogoSpinner } from "@/components/ui/LogoSpinner";
import { ThemedText } from "@/components/ui/ThemedText";
import { cardShadow, Colors, Fonts } from "@/constants/Colors";
import { useActiveLeagueSport } from "@/hooks/useActiveLeagueSport";
import { useColors } from "@/hooks/useColors";
import { PlayerSeasonStats } from "@/types/player";
import { formatPosition } from "@/utils/formatting";
import { getInjuryBadge } from "@/utils/nba/injuryBadge";
import { formatGameTime, ScheduleEntry } from "@/utils/nba/nbaSchedule";
import { slotLabel } from "@/utils/roster/rosterSlots";
import { ms, s } from "@/utils/scale";


// ─── Types ───────────────────────────────────────────────────────────────────

export interface RosterPlayer extends PlayerSeasonStats {
  roster_slot: string | null;
  nbaTricode: string | null;
  acquired_at?: string | null;
}

export interface SlotEntry {
  slotPosition: string;
  slotIndex: number;
  player: RosterPlayer | null;
}

export type QuickAction = "bench" | "activate" | "ir" | "taxi" | "promote";

export interface DestinationSlot {
  slot: SlotEntry;
  section: "starter" | "bench" | "ir" | "taxi";
}

// ─── Constants ───────────────────────────────────────────────────────────────

function getActionMeta(c: typeof Colors.light): Record<
  QuickAction,
  { label: string; deferredLabel?: string; color: string }
> {
  return {
    bench: { label: "Move to Bench", color: c.danger },
    activate: {
      label: "Activate",
      deferredLabel: "Activate (tomorrow)",
      color: c.success,
    },
    promote: {
      label: "Promote",
      deferredLabel: "Promote (tomorrow)",
      color: c.success,
    },
    ir: {
      label: "Move to IR",
      deferredLabel: "Move to IR (tomorrow)",
      color: c.warning,
    },
    taxi: {
      label: "Move to Taxi",
      deferredLabel: "Move to Taxi (tomorrow)",
      color: c.secondaryText,
    },
  };
}

const SECTION_LABELS: Record<string, string> = {
  starter: "SWAP WITH STARTER",
  bench: "REPLACE WITH BENCH PLAYER",
  ir: "INJURED RESERVE",
  taxi: "TAXI SQUAD",
};

const FILL_SECTION_LABELS: Record<string, string> = {
  bench: "FROM BENCH",
  starter: "FROM STARTERS",
  ir: "FROM INJURED RESERVE",
  taxi: "FROM TAXI SQUAD",
};

// ─── Props ───────────────────────────────────────────────────────────────────

interface SlotPickerModalProps {
  visible: boolean;
  sourceSlot: SlotEntry | null;
  /** Destination slots the player can move to (dest mode). */
  destinations: DestinationSlot[];
  /** One-tap actions for the selected player (dest mode). */
  quickActions: QuickAction[];
  /** Players that can fill the slot (fill mode). */
  eligiblePlayers: RosterPlayer[];
  daySchedule: Map<string, ScheduleEntry> | undefined;
  isAssigning: boolean;
  /** True when the player is locked and IR/TAXI moves would defer to tomorrow. */
  deferredToTomorrow: boolean;
  onSelectDestination: (dest: DestinationSlot) => void;
  onSelectPlayer: (player: RosterPlayer) => void;
  onQuickAction: (action: QuickAction) => void;
  onClose: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SlotPickerModal({
  visible,
  sourceSlot,
  destinations,
  quickActions,
  eligiblePlayers,
  daySchedule,
  isAssigning,
  deferredToTomorrow,
  onSelectDestination,
  onSelectPlayer,
  onQuickAction,
  onClose,
}: SlotPickerModalProps) {
  const c = useColors();
  const sport = useActiveLeagueSport();

  const ACTION_META = getActionMeta(c);

  // ─── Helpers (closures — must be defined before hooks that depend on them) ──

  const gameInfo = useCallback(
    (p: RosterPlayer): string | null => {
      const entry = p.nbaTricode ? daySchedule?.get(p.nbaTricode) ?? null : null;
      if (!entry) return null;
      const time = entry.gameTimeUtc ? formatGameTime(entry.gameTimeUtc) : null;
      return time ? `${entry.matchup} · ${time}` : entry.matchup;
    },
    [daySchedule],
  );

  // Group destinations by section (memoized so grouped map doesn't rebuild every render)
  const groupedDests = useMemo(() => {
    const m = new Map<string, DestinationSlot[]>();
    for (const d of destinations) {
      const list = m.get(d.section) ?? [];
      list.push(d);
      m.set(d.section, list);
    }
    return m;
  }, [destinations]);

  // Group eligible players by section (fill mode)
  const { benchFillPlayers, starterFillPlayers, irFillPlayers } = useMemo(() => ({
    benchFillPlayers: eligiblePlayers.filter(
      (p) => !p.roster_slot || p.roster_slot === "BE",
    ),
    starterFillPlayers: eligiblePlayers.filter(
      (p) =>
        p.roster_slot &&
        p.roster_slot !== "BE" &&
        p.roster_slot !== "IR" &&
        p.roster_slot !== "TAXI",
    ),
    irFillPlayers: eligiblePlayers.filter((p) => p.roster_slot === "IR"),
  }), [eligiblePlayers]);

  // ─── Row renderers (hooks — must run on every render) ──────────────────────

  const renderDestRow = useCallback(
    (dest: DestinationSlot, idx: number, total: number, cc: typeof c) => {
      const occ = dest.slot.player;
      const occGame = occ ? gameInfo(occ) : null;
      const occBadge = occ ? getInjuryBadge(occ.status) : null;
      return (
        <TouchableOpacity
          key={`${dest.slot.slotPosition}-${dest.slot.slotIndex}`}
          accessibilityRole="button"
          accessibilityLabel={
            occ
              ? `${dest.section === "bench" ? "Replace with" : "Swap with"} ${occ.name} at ${slotLabel(dest.slot.slotPosition)}${occGame ? `, ${occGame}` : ""}`
              : `Start at ${slotLabel(dest.slot.slotPosition)}, empty`
          }
          style={[
            styles.destRow,
            idx < total - 1 && {
              borderBottomColor: cc.border,
              borderBottomWidth: StyleSheet.hairlineWidth,
            },
          ]}
          onPress={() => onSelectDestination(dest)}
        >
          <View
            style={[
              styles.slotPill,
              {
                backgroundColor: occ ? cc.cardAlt : "transparent",
                borderColor: cc.border,
              },
            ]}
          >
            <Text
              style={[
                styles.slotPillText,
                { color: occ ? cc.text : cc.secondaryText },
              ]}
            >
              {slotLabel(dest.slot.slotPosition)}
            </Text>
          </View>
          {occ ? (
            <>
              <View style={[styles.rowHeadshot, { borderColor: cc.gold, backgroundColor: cc.cardAlt }]}>
                <PlayerHeadshotImage
                  externalIdNba={occ.external_id_nba}
                  sport={sport}
                  style={styles.rowHeadshotImg}
                  accessible={false}
                />
              </View>
              <View style={styles.rowInfo}>
                <View style={styles.nameLine}>
                  <ThemedText type="defaultSemiBold" numberOfLines={1} style={styles.nameText}>
                    {occ.name}
                  </ThemedText>
                  {occBadge && (
                    <View style={[styles.injuryBadge, { backgroundColor: occBadge.color }]}>
                      <Text style={[styles.injuryText, { color: cc.statusText }]}>{occBadge.label}</Text>
                    </View>
                  )}
                </View>
                <ThemedText
                  type="varsitySmall"
                  style={[styles.metaText, { color: cc.secondaryText }]}
                >
                  {formatPosition(occ.position)}
                </ThemedText>
              </View>
              {occGame && <MatchupChip matchup={occGame} c={cc} />}
            </>
          ) : (
            <View style={styles.rowInfo}>
              <ThemedText
                type="varsitySmall"
                style={[styles.emptyEyebrow, { color: cc.gold }]}
              >
                EMPTY SLOT
              </ThemedText>
              <ThemedText style={[styles.emptyHint, { color: cc.secondaryText }]}>
                Tap to start here
              </ThemedText>
            </View>
          )}
        </TouchableOpacity>
      );
    },
    [onSelectDestination, gameInfo, sport],
  );

  const renderFillSection = useCallback(
    (section: string, players: RosterPlayer[], cc: typeof c) => {
      if (players.length === 0) return null;
      return (
        <View key={section} style={styles.fillSection}>
          <SectionEyebrow label={FILL_SECTION_LABELS[section] ?? section.toUpperCase()} />
          <View
            style={[
              styles.card,
              { backgroundColor: cc.card, borderColor: cc.border },
            ]}
          >
            {players.map((item, idx) => {
              const itemGame = gameInfo(item);
              const itemBadge = getInjuryBadge(item.status);
              return (
                <TouchableOpacity
                  key={item.player_id}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.name}, ${formatPosition(item.position)}${itemGame ? `, ${itemGame}` : ""}`}
                  style={[
                    styles.destRow,
                    idx < players.length - 1 && {
                      borderBottomColor: cc.border,
                      borderBottomWidth: StyleSheet.hairlineWidth,
                    },
                  ]}
                  onPress={() => onSelectPlayer(item)}
                >
                  <View
                    style={[
                      styles.slotPill,
                      { backgroundColor: cc.cardAlt, borderColor: cc.border },
                    ]}
                  >
                    <Text style={[styles.slotPillText, { color: cc.text }]}>
                      {slotLabel(item.roster_slot ?? "BE")}
                    </Text>
                  </View>
                  <View style={[styles.rowHeadshot, { borderColor: cc.gold, backgroundColor: cc.cardAlt }]}>
                    <PlayerHeadshotImage
                      externalIdNba={item.external_id_nba}
                      sport={sport}
                      style={styles.rowHeadshotImg}
                      accessible={false}
                    />
                  </View>
                  <View style={styles.rowInfo}>
                    <View style={styles.nameLine}>
                      <ThemedText type="defaultSemiBold" numberOfLines={1} style={styles.nameText}>
                        {item.name}
                      </ThemedText>
                      {itemBadge && (
                        <View style={[styles.injuryBadge, { backgroundColor: itemBadge.color }]}>
                          <Text style={[styles.injuryText, { color: cc.statusText }]}>{itemBadge.label}</Text>
                        </View>
                      )}
                    </View>
                    <ThemedText
                      type="varsitySmall"
                      style={[styles.metaText, { color: cc.secondaryText }]}
                    >
                      {formatPosition(item.position)}
                    </ThemedText>
                  </View>
                  {itemGame && <MatchupChip matchup={itemGame} c={cc} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      );
    },
    [onSelectPlayer, gameInfo, sport],
  );

  if (!sourceSlot) return null;

  const player = sourceSlot.player;
  const label = slotLabel(sourceSlot.slotPosition);
  const isIrOrTaxi =
    sourceSlot.slotPosition === "IR" || sourceSlot.slotPosition === "TAXI";

  // Dest mode: occupied starter/bench. Fill mode: empty slot or IR/TAXI.
  const isDestMode = !!player && !isIrOrTaxi;

  // Quick actions for fill mode (occupied IR/TAXI)
  const fillQuickActions: QuickAction[] = [];
  if (player && sourceSlot.slotPosition === "IR") fillQuickActions.push("activate");
  if (player && sourceSlot.slotPosition === "TAXI") fillQuickActions.push("promote");

  const activeQuickActions = isDestMode ? quickActions : fillQuickActions;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <View
          accessibilityViewIsModal
          style={[styles.sheet, { backgroundColor: c.background }]}
          // Prevent taps inside the sheet from closing the modal
          onStartShouldSetResponder={() => true}
        >
          {/* ─── Header ─── */}
          <View style={[styles.header, { borderBottomColor: c.border }]}>
            <View style={styles.headerLeft}>
              <View style={[styles.headerRule, { backgroundColor: c.gold }]} />
              <ThemedText
                type="sectionLabel"
                accessibilityRole="header"
                style={[styles.headerEyebrow, { color: c.text }]}
              >
                {label} SLOT
              </ThemedText>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={styles.closeBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <ThemedText style={{ fontSize: ms(16), color: c.secondaryText }}>✕</ThemedText>
            </TouchableOpacity>
          </View>

          {isAssigning ? (
            <View style={{ padding: s(20) }}><LogoSpinner /></View>
          ) : (
            <ScrollView style={styles.scroll} bounces={false} contentContainerStyle={styles.scrollContent}>
              {/* ─── Player card (occupied or empty) ─── */}
              {player ? (
                <View
                  style={[
                    styles.playerCard,
                    {
                      backgroundColor: c.card,
                      borderColor: c.border,
                    },
                  ]}
                >
                  <View style={styles.playerCardBody}>
                    <View
                      style={[
                        styles.headshotCircle,
                        { borderColor: c.gold, backgroundColor: c.cardAlt },
                      ]}
                    >
                      <PlayerHeadshotImage
                        externalIdNba={player.external_id_nba}
                        sport={sport}
                        style={styles.headshotImg}
                        accessible={false}
                      />
                    </View>
                    <View style={styles.rowInfo}>
                      <View style={styles.nameLine}>
                        <ThemedText
                          type="defaultSemiBold"
                          numberOfLines={1}
                          style={[styles.nameText, { fontSize: ms(15) }]}
                        >
                          {player.name}
                        </ThemedText>
                        {(() => {
                          const badge = getInjuryBadge(player.status);
                          return badge ? (
                            <View
                              style={[
                                styles.injuryBadge,
                                { backgroundColor: badge.color },
                              ]}
                            >
                              <Text style={[styles.injuryText, { color: c.statusText }]}>
                                {badge.label}
                              </Text>
                            </View>
                          ) : null;
                        })()}
                      </View>
                      <ThemedText
                        type="varsitySmall"
                        style={[styles.metaText, { color: c.secondaryText }]}
                      >
                        {formatPosition(player.position)}
                      </ThemedText>
                    </View>
                    {gameInfo(player) && (
                      <MatchupChip matchup={gameInfo(player)!} c={c} />
                    )}
                  </View>
                  {activeQuickActions.length > 0 && (
                    <View
                      style={[
                        styles.playerCardActions,
                        { borderTopColor: c.border },
                      ]}
                    >
                      {activeQuickActions.map((action) => {
                        const meta = ACTION_META[action];
                        const actionLabel =
                          deferredToTomorrow && meta.deferredLabel
                            ? meta.deferredLabel
                            : meta.label;
                        return (
                          <TouchableOpacity
                            key={action}
                            accessibilityRole="button"
                            accessibilityLabel={actionLabel}
                            style={[
                              styles.quickActionBtn,
                              { borderColor: meta.color, backgroundColor: meta.color + "14" },
                            ]}
                            onPress={() => onQuickAction(action)}
                          >
                            <Text
                              style={[
                                styles.quickActionText,
                                { color: meta.color },
                              ]}
                            >
                              {actionLabel.toUpperCase()}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </View>
              ) : (
                /* ─── Empty slot header ─── */
                <View
                  style={[
                    styles.playerCard,
                    {
                      backgroundColor: c.card,
                      borderColor: c.border,
                    },
                  ]}
                >
                  <View style={styles.playerCardBody}>
                    <View
                      style={[
                        styles.emptyCircle,
                        { borderColor: c.border, backgroundColor: c.cardAlt },
                      ]}
                    >
                      <ThemedText style={{ color: c.secondaryText, fontSize: ms(20) }}>
                        +
                      </ThemedText>
                    </View>
                    <View style={styles.rowInfo}>
                      <ThemedText
                        type="varsitySmall"
                        style={[styles.emptyEyebrow, { color: c.secondaryText }]}
                      >
                        EMPTY SLOT
                      </ThemedText>
                      <ThemedText style={[styles.emptyHint, { color: c.text }]}>
                        Pick a player to start at {label}
                      </ThemedText>
                    </View>
                  </View>
                </View>
              )}

              {/* ─── Destinations (dest mode) ─── */}
              {isDestMode && (
                <>
                  {destinations.length === 0 &&
                    activeQuickActions.length === 0 && (
                      <View style={{ padding: s(20), alignItems: "center" }}>
                        <ThemedText style={{ color: c.secondaryText }}>
                          No eligible moves
                        </ThemedText>
                      </View>
                    )}
                  {(["starter", "bench", "ir", "taxi"] as const).map(
                    (section) => {
                      const dests = groupedDests.get(section);
                      if (!dests || dests.length === 0) return null;
                      return (
                        <View key={section} style={styles.fillSection}>
                          <SectionEyebrow label={SECTION_LABELS[section]} />
                          <View
                            style={[
                              styles.card,
                              { backgroundColor: c.card, borderColor: c.border },
                            ]}
                          >
                            {dests.map((dest, idx) =>
                              renderDestRow(dest, idx, dests.length, c),
                            )}
                          </View>
                        </View>
                      );
                    },
                  )}
                </>
              )}

              {/* ─── Eligible players (fill mode) ─── */}
              {!isDestMode && (
                <>
                  {eligiblePlayers.length === 0 && (
                    <View style={{ padding: 20, alignItems: "center" }}>
                      <ThemedText style={{ color: c.secondaryText }}>
                        {sourceSlot.slotPosition === "IR"
                          ? "No players with OUT designation on your roster"
                          : "No eligible players available"}
                      </ThemedText>
                    </View>
                  )}
                  {renderFillSection("bench", benchFillPlayers, c)}
                  {renderFillSection("starter", starterFillPlayers, c)}
                  {renderFillSection("ir", irFillPlayers, c)}
                </>
              )}
            </ScrollView>
          )}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: "75%",
    overflow: "hidden",
    paddingBottom: s(32),
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: s(16),
    paddingTop: s(14),
    paddingBottom: s(10),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: s(10),
  },
  headerRule: {
    height: 2,
    width: s(18),
  },
  headerEyebrow: {
    fontSize: ms(13),
    letterSpacing: 1.0,
  },
  closeBtn: { padding: s(4), marginRight: s(-4) },
  scroll: { flexGrow: 0 },
  scrollContent: {
    paddingTop: s(12),
    paddingBottom: s(8),
  },

  // Player card (the source slot's current occupant or empty state) — uses
  // the same brand chrome as the roster slot card: rounded 12, hairline
  // border, cardShadow. Body row + optional inline quick-actions footer
  // share the bordered container so we don't pay an extra section gap.
  playerCard: {
    marginHorizontal: s(16),
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
    ...cardShadow,
  },
  playerCardBody: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: s(12),
    paddingVertical: s(10),
    gap: s(10),
  },
  // Footer strip inside the player card — quick action pills sit hairline-
  // divided beneath the player's row, no extra section padding.
  playerCardActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: s(10),
    paddingVertical: s(8),
    gap: s(6),
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  headshotCircle: {
    width: s(48),
    height: s(48),
    borderRadius: s(24),
    borderWidth: 1.5,
    overflow: "hidden" as const,
  },
  headshotImg: {
    position: "absolute" as const,
    bottom: -2,
    left: 0,
    right: 0,
    height: s(42),
  },
  emptyCircle: {
    width: s(48),
    height: s(48),
    borderRadius: s(24),
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },

  // Quick action pill — semantic color (success/danger/warning) on a tinted
  // bg, varsity caps label. Sits inline as a footer in the player card.
  quickActionBtn: {
    paddingHorizontal: s(10),
    paddingVertical: s(5),
    borderRadius: 6,
    borderWidth: 1,
  },
  quickActionText: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(11),
    letterSpacing: 1.0,
  },

  // Section block (eyebrow + card) — matches the rhythm of the roster page
  // Bench / IR / Taxi sections.
  fillSection: {
    paddingHorizontal: s(16),
    paddingTop: s(14),
  },
  card: {
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    ...cardShadow,
  },

  // Row layout
  destRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: s(56),
    paddingVertical: s(8),
    paddingHorizontal: s(10),
    gap: s(8),
  },
  rowInfo: { flex: 1 },
  nameLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(4),
  },
  nameText: { fontSize: ms(14), flexShrink: 1 },
  metaText: {
    fontSize: ms(9.5),
    letterSpacing: 1.0,
    marginTop: s(2),
  },

  // Destination headshot — matches the smaller variant used in compact rows.
  rowHeadshot: {
    width: s(36),
    height: s(36),
    borderRadius: s(18),
    borderWidth: 1,
    overflow: "hidden" as const,
  },
  rowHeadshotImg: {
    position: "absolute" as const,
    bottom: -1,
    left: 0,
    right: 0,
    height: s(32),
  },

  // Slot pill — matches the roster page's slotPill chrome exactly.
  slotPill: {
    width: s(40),
    paddingVertical: s(6),
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  slotPillText: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(10),
    letterSpacing: 1.0,
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

  // Empty-row eyebrow + helper text — same treatment as the empty starter
  // slot in the roster card itself.
  emptyEyebrow: {
    fontSize: ms(10),
    letterSpacing: 1.2,
  },
  emptyHint: {
    fontSize: ms(12),
    marginTop: s(2),
  },
});
