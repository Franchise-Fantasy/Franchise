import { LogoSpinner } from "@/components/ui/LogoSpinner";
import { ThemedText } from "@/components/ui/ThemedText";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";
import { PlayerSeasonStats } from "@/types/player";
import { formatPosition } from "@/utils/formatting";
import { getInjuryBadge } from "@/utils/injuryBadge";
import { formatGameTime, ScheduleEntry } from "@/utils/nbaSchedule";
import { getPlayerHeadshotUrl } from "@/utils/playerHeadshot";
import { slotLabel } from "@/utils/rosterSlots";
import { ms, s } from "@/utils/scale";
import {
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

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

function getActionMeta(c: ReturnType<typeof Colors['light' & 'dark']>): Record<
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
  starter: "Swap with Starter",
  bench: "Replace with Bench Player",
  ir: "Injured Reserve",
  taxi: "Taxi Squad",
};

const FILL_SECTION_LABELS: Record<string, string> = {
  bench: "From Bench",
  starter: "From Starters",
  ir: "From Injured Reserve",
  taxi: "From Taxi Squad",
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
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];

  const ACTION_META = getActionMeta(c);

  if (!sourceSlot) return null;

  const player = sourceSlot.player;
  const label = slotLabel(sourceSlot.slotPosition);
  const isIrOrTaxi =
    sourceSlot.slotPosition === "IR" || sourceSlot.slotPosition === "TAXI";

  // Dest mode: occupied starter/bench. Fill mode: empty slot or IR/TAXI.
  const isDestMode = !!player && !isIrOrTaxi;

  // ─── Helpers ─────────────────────────────────────────────────────────────

  const getScheduleEntry = (p: RosterPlayer) =>
    p.nbaTricode ? daySchedule?.get(p.nbaTricode) ?? null : null;

  const gameInfo = (p: RosterPlayer): string | null => {
    const entry = getScheduleEntry(p);
    if (!entry) return null;
    const time = entry.gameTimeUtc ? formatGameTime(entry.gameTimeUtc) : null;
    return time ? `${entry.matchup} · ${time}` : entry.matchup;
  };

  // Group destinations by section
  const groupedDests = new Map<string, DestinationSlot[]>();
  for (const d of destinations) {
    const list = groupedDests.get(d.section) ?? [];
    list.push(d);
    groupedDests.set(d.section, list);
  }

  // Group eligible players by section (fill mode)
  const benchFillPlayers = eligiblePlayers.filter(
    (p) => !p.roster_slot || p.roster_slot === "BE",
  );
  const starterFillPlayers = eligiblePlayers.filter(
    (p) =>
      p.roster_slot &&
      p.roster_slot !== "BE" &&
      p.roster_slot !== "IR" &&
      p.roster_slot !== "TAXI",
  );
  const irFillPlayers = eligiblePlayers.filter(
    (p) => p.roster_slot === "IR",
  );

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
            <View style={{ flex: 1 }}>
              <ThemedText
                accessibilityRole="header"
                type="defaultSemiBold"
                style={{ fontSize: ms(17) }}
              >
                {label} Slot
              </ThemedText>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={styles.closeBtn}
            >
              <ThemedText style={{ fontSize: ms(16) }}>✕</ThemedText>
            </TouchableOpacity>
          </View>

          {isAssigning ? (
            <View style={{ padding: s(20) }}><LogoSpinner /></View>
          ) : (
            <ScrollView style={styles.scroll} bounces={false}>
              {/* ─── Player card (occupied) ─── */}
              {player ? (
                <View
                  style={[
                    styles.playerCard,
                    { borderBottomColor: c.border, borderBottomWidth: StyleSheet.hairlineWidth },
                  ]}
                >
                  {(() => {
                    const url = getPlayerHeadshotUrl(player.external_id_nba);
                    return (
                      <View
                        style={[
                          styles.headshotCircle,
                          { borderColor: c.gold, backgroundColor: c.cardAlt },
                        ]}
                      >
                        {url && (
                          <Image
                            source={{ uri: url }}
                            style={styles.headshotImg}
                            resizeMode="cover"
                            accessible={false}
                          />
                        )}
                      </View>
                    );
                  })()}
                  <View style={{ flex: 1 }}>
                    <ThemedText
                      type="defaultSemiBold"
                      style={{ fontSize: ms(16) }}
                    >
                      {player.name}
                    </ThemedText>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: s(4),
                        marginTop: s(2),
                      }}
                    >
                      <ThemedText
                        style={{ color: c.secondaryText, fontSize: ms(12) }}
                      >
                        {formatPosition(player.position)} · {player.nba_team}
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
                  </View>
                  {gameInfo(player) && (
                    <View
                      style={[
                        styles.gameChip,
                        { backgroundColor: c.cardAlt },
                      ]}
                    >
                      <Text
                        style={[styles.gameChipText, { color: c.secondaryText }]}
                      >
                        {gameInfo(player)}
                      </Text>
                    </View>
                  )}
                </View>
              ) : (
                /* ─── Empty slot header ─── */
                <View
                  style={[
                    styles.playerCard,
                    { borderBottomColor: c.border, borderBottomWidth: StyleSheet.hairlineWidth },
                  ]}
                >
                  <View
                    style={[
                      styles.emptyCircle,
                      { borderColor: c.border, backgroundColor: c.cardAlt },
                    ]}
                  >
                    <ThemedText
                      style={{ color: c.secondaryText, fontSize: ms(18) }}
                    >
                      +
                    </ThemedText>
                  </View>
                  <ThemedText
                    style={{ color: c.secondaryText, fontSize: ms(14) }}
                  >
                    Select a player to start at {label}
                  </ThemedText>
                </View>
              )}

              {/* ─── Quick actions ─── */}
              {activeQuickActions.length > 0 && (
                <View
                  style={[
                    styles.quickActions,
                    { borderBottomColor: c.border, borderBottomWidth: StyleSheet.hairlineWidth },
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
                          { borderColor: meta.color },
                        ]}
                        onPress={() => onQuickAction(action)}
                      >
                        <Text
                          style={[
                            styles.quickActionText,
                            { color: meta.color },
                          ]}
                        >
                          {actionLabel}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
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
                        <View key={section}>
                          <View
                            style={[
                              styles.sectionHeader,
                              { backgroundColor: c.cardAlt },
                            ]}
                          >
                            <ThemedText
                              accessibilityRole="header"
                              style={[
                                styles.sectionHeaderText,
                                { color: c.secondaryText },
                              ]}
                            >
                              {SECTION_LABELS[section]}
                            </ThemedText>
                          </View>
                          {dests.map((dest, idx) =>
                            renderDestRow(dest, idx, dests.length, c),
                          )}
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

  // ─── Dest row (move mode) ────────────────────────────────────────────────

  function renderDestRow(
    dest: DestinationSlot,
    idx: number,
    total: number,
    c: any,
  ) {
    const occ = dest.slot.player;
    const occGame = occ ? gameInfo(occ) : null;

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
            borderBottomColor: c.border,
            borderBottomWidth: StyleSheet.hairlineWidth,
          },
        ]}
        onPress={() => onSelectDestination(dest)}
      >
        <View style={[styles.slotChip, { backgroundColor: c.cardAlt }]}>
          <Text
            style={[
              styles.slotChipText,
              { color: occ ? c.accent : c.secondaryText },
            ]}
          >
            {slotLabel(dest.slot.slotPosition)}
          </Text>
        </View>
        {occ ? (
          <>
            {(() => {
              const url = getPlayerHeadshotUrl(occ.external_id_nba);
              return (
                <View
                  style={[
                    styles.rowHeadshot,
                    { borderColor: c.gold, backgroundColor: c.cardAlt },
                  ]}
                >
                  {url && (
                    <Image
                      source={{ uri: url }}
                      style={styles.rowHeadshotImg}
                      resizeMode="cover"
                      accessible={false}
                    />
                  )}
                </View>
              );
            })()}
            <View style={{ flex: 1 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: s(4),
                }}
              >
                <ThemedText
                  type="defaultSemiBold"
                  numberOfLines={1}
                  style={{ flexShrink: 1 }}
                >
                  {occ.name}
                </ThemedText>
                {(() => {
                  const badge = getInjuryBadge(occ.status);
                  return badge ? (
                    <View
                      style={[
                        styles.injuryBadge,
                        { backgroundColor: badge.color },
                      ]}
                    >
                      <Text style={[styles.injuryText, { color: c.statusText }]}>{badge.label}</Text>
                    </View>
                  ) : null;
                })()}
              </View>
              <ThemedText
                style={{ color: c.secondaryText, fontSize: ms(12) }}
              >
                {formatPosition(occ.position)} · {occ.nba_team}
              </ThemedText>
            </View>
            {occGame && (
              <View
                style={[
                  styles.gameChip,
                  { backgroundColor: c.cardAlt },
                ]}
              >
                <Text
                  style={[styles.gameChipText, { color: c.secondaryText }]}
                >
                  {occGame}
                </Text>
              </View>
            )}
          </>
        ) : (
          <ThemedText
            style={{ flex: 1, color: c.accent, fontWeight: "500" }}
          >
            Empty — tap to start here
          </ThemedText>
        )}
      </TouchableOpacity>
    );
  }

  // ─── Fill section (fill mode) ─────────────────────────────────────────────

  function renderFillSection(
    section: string,
    players: RosterPlayer[],
    c: any,
  ) {
    if (players.length === 0) return null;
    return (
      <View key={section}>
        <View style={[styles.sectionHeader, { backgroundColor: c.cardAlt }]}>
          <ThemedText
            accessibilityRole="header"
            style={[styles.sectionHeaderText, { color: c.secondaryText }]}
          >
            {FILL_SECTION_LABELS[section] ?? section}
          </ThemedText>
        </View>
        {players.map((item, idx) => {
          const itemGame = gameInfo(item);
          return (
            <TouchableOpacity
              key={item.player_id}
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, ${formatPosition(item.position)}, ${item.nba_team}${itemGame ? `, ${itemGame}` : ""}`}
              style={[
                styles.destRow,
                idx < players.length - 1 && {
                  borderBottomColor: c.border,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                },
              ]}
              onPress={() => onSelectPlayer(item)}
            >
              <View
                style={[styles.slotChip, { backgroundColor: c.cardAlt }]}
              >
                <Text
                  style={[
                    styles.slotChipText,
                    { color: c.secondaryText },
                  ]}
                >
                  {slotLabel(item.roster_slot ?? "BE")}
                </Text>
              </View>
              {(() => {
                const url = getPlayerHeadshotUrl(item.external_id_nba);
                return (
                  <View
                    style={[
                      styles.rowHeadshot,
                      { borderColor: c.gold, backgroundColor: c.cardAlt },
                    ]}
                  >
                    {url && (
                      <Image
                        source={{ uri: url }}
                        style={styles.rowHeadshotImg}
                        resizeMode="cover"
                        accessible={false}
                      />
                    )}
                  </View>
                );
              })()}
              <View style={{ flex: 1 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: s(4),
                  }}
                >
                  <ThemedText
                    type="defaultSemiBold"
                    numberOfLines={1}
                    style={{ flexShrink: 1 }}
                  >
                    {item.name}
                  </ThemedText>
                  {(() => {
                    const badge = getInjuryBadge(item.status);
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
                  style={{ color: c.secondaryText, fontSize: ms(12) }}
                >
                  {formatPosition(item.position)} · {item.nba_team}
                </ThemedText>
              </View>
              {itemGame && (
                <View
                  style={[
                    styles.gameChip,
                    { backgroundColor: c.cardAlt },
                  ]}
                >
                  <Text
                    style={[styles.gameChipText, { color: c.secondaryText }]}
                  >
                    {itemGame}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    );
  }
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    maxHeight: "70%",
    overflow: "hidden",
    paddingBottom: s(32),
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: s(16),
    paddingTop: s(14),
    paddingBottom: s(10),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  closeBtn: { padding: s(8), marginTop: s(-4), marginRight: s(-4) },
  scroll: { flexGrow: 0 },
  playerCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: s(16),
    paddingVertical: s(8),
    gap: s(10),
  },
  headshotCircle: {
    width: s(44),
    height: s(44),
    borderRadius: 22,
    borderWidth: 1,
    overflow: "hidden" as const,
  },
  headshotImg: {
    position: "absolute" as const,
    bottom: s(-2),
    left: 0,
    right: 0,
    height: s(38),
  },
  emptyCircle: {
    width: s(44),
    height: s(44),
    borderRadius: 22,
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  quickActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: s(16),
    paddingVertical: s(6),
    gap: s(8),
  },
  quickActionBtn: {
    paddingHorizontal: s(14),
    paddingVertical: s(7),
    borderRadius: 8,
    borderWidth: 1,
  },
  quickActionText: {
    fontSize: ms(13),
    fontWeight: "600",
  },
  sectionHeader: {
    paddingHorizontal: s(16),
    paddingVertical: s(4),
  },
  sectionHeaderText: {
    fontSize: ms(11),
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  destRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: s(7),
    paddingHorizontal: s(16),
    gap: s(8),
  },
  rowHeadshot: {
    width: s(32),
    height: s(32),
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden" as const,
  },
  rowHeadshotImg: {
    position: "absolute" as const,
    bottom: s(-1),
    left: 0,
    right: 0,
    height: s(28),
  },
  slotChip: {
    width: s(36),
    paddingVertical: s(4),
    borderRadius: 6,
    alignItems: "center",
  },
  slotChipText: {
    fontSize: ms(10),
    fontWeight: "700",
  },
  gameChip: {
    paddingHorizontal: s(6),
    paddingVertical: s(3),
    borderRadius: 4,
  },
  gameChipText: {
    fontSize: ms(10),
    fontWeight: "600",
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
});
