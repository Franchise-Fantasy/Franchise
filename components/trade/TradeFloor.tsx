import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
// Lanes always stack vertically (column). The half-width side-by-side
// experiment had visible bugs at phone widths — chip rows wrapping to
// 3 lines, lane heights mismatching, asset names truncating — so the
// `isTwoTeam` branching was dropped in favor of a single layout that
// scales from 2-team up through n-team.

import { TradeFairnessBar } from '@/components/trade/TradeFairnessBar';
import { TradeLane } from '@/components/trade/TradeLane';
import { Badge } from '@/components/ui/Badge';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { TradeBuilderTeam } from '@/types/trade';
import { ms, s } from '@/utils/scale';

type PickerType = 'player' | 'pick' | 'swap';

interface FairnessEntry {
  teamName: string;
  netFpts: number;
}

interface LeagueTeam {
  id: string;
  name: string;
}

interface TradeFloorProps {
  myTeamId: string;
  builderTeams: TradeBuilderTeam[];
  /** All other teams in the league — eligible to be added as partners. */
  otherTeams: LeagueTeam[];
  /** Currently-selected partner team IDs (excludes me). */
  selectedTeamIds: string[];
  teamNameMap: Record<string, string>;

  /** Scoring shape — drives FPTS readout / fairness bar visibility. */
  isCategories: boolean;
  pickConditionsEnabled: boolean;

  /** Live fairness + roster warnings. */
  fairness: FairnessEntry[];
  rosterWarnings: string[] | undefined;
  hasAssets: boolean;

  /** Notes input. Auto-expands if seeded by counteroffer/edit. */
  notes: string;
  onNotesChange: (next: string) => void;
  notesSeeded: boolean;

  /** Counteroffer / edit mode flags — drives the badge cluster. */
  isCounteroffer: boolean;
  isEdit: boolean;

  /** Team chip controls. */
  onToggleTeam: (team: LeagueTeam) => void;

  /** Open a fullscreen picker for a given (team, asset type). Lifted to the parent
   *  so the picker stacks above the floor as a real modal page. */
  onOpenPicker: (teamId: string, type: PickerType) => void;

  /** Asset removal / destination editing — keyed by source team. */
  onRemovePlayer: (forTeamId: string, playerId: string) => void;
  onRemovePick: (forTeamId: string, pickId: string) => void;
  onRemoveSwap: (forTeamId: string, season: string, round: number) => void;
  onSetPlayerDest: (forTeamId: string, playerId: string, toTeamId: string) => void;
  onSetPickDest: (forTeamId: string, pickId: string, toTeamId: string) => void;
}

/**
 * Single-pane live trade builder canvas. Replaces the prior 3-step
 * funnel — partner chips, sender lanes, fairness, and notes coexist
 * here so the user iterates without losing the trade-in-progress.
 *
 * Asset selection (player/pick/swap) opens as a fullscreen overlay
 * managed by the parent — no inline reveal cramped into half a column.
 *
 * Layout: 2-team trades render lanes side-by-side at all widths;
 * 3+ team trades stack vertically.
 */
export function TradeFloor({
  myTeamId,
  builderTeams,
  otherTeams,
  selectedTeamIds,
  teamNameMap,
  isCategories,
  pickConditionsEnabled,
  fairness,
  rosterWarnings,
  hasAssets,
  notes,
  onNotesChange,
  notesSeeded,
  isCounteroffer,
  isEdit,
  onToggleTeam,
  onOpenPicker,
  onRemovePlayer,
  onRemovePick,
  onRemoveSwap,
  onSetPlayerDest,
  onSetPickDest,
}: TradeFloorProps) {
  const c = useColors();
  const { width } = useWindowDimensions();

  const [addTeamOpen, setAddTeamOpen] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(notesSeeded);

  const allTradeTeamIds = [myTeamId, ...selectedTeamIds];

  const partnerTeamsFor = (teamId: string) =>
    builderTeams
      .filter((bt) => bt.team_id !== teamId)
      .map((bt) => ({ id: bt.team_id, name: bt.team_name }));

  const eligibleAddTeams = otherTeams.filter((t) => !selectedTeamIds.includes(t.id));

  return (
    <View style={styles.layout}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Counteroffer / edit badges */}
        {(isCounteroffer || isEdit) && (
          <View style={styles.badgeRow}>
            {isCounteroffer && <Badge label="Counteroffer" variant="gold" />}
            {isEdit && <Badge label="Editing" variant="warning" />}
          </View>
        )}

        {/* Team chip row — partners + add-team affordance. */}
        <View style={styles.teamChipRow}>
          {builderTeams
            .filter((bt) => bt.team_id !== myTeamId)
            .map((bt) => (
              <TouchableOpacity
                key={bt.team_id}
                accessibilityRole="button"
                accessibilityLabel={`${bt.team_name} in trade — tap to remove`}
                style={[styles.teamChip, { backgroundColor: c.gold }]}
                onPress={() =>
                  onToggleTeam({ id: bt.team_id, name: bt.team_name })
                }
              >
                <ThemedText
                  style={[styles.teamChipText, { color: Brand.ink }]}
                  numberOfLines={1}
                >
                  {bt.team_name}
                </ThemedText>
                <Ionicons name="close" size={12} color={Brand.ink} />
              </TouchableOpacity>
            ))}
          {eligibleAddTeams.length > 0 && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Add team to trade"
              style={[styles.addTeamChip, { borderColor: c.border, backgroundColor: c.cardAlt }]}
              onPress={() => setAddTeamOpen(true)}
            >
              <Ionicons name="add" size={14} color={c.gold} />
              <ThemedText style={[styles.addTeamChipText, { color: c.gold }]}>
                Add Team
              </ThemedText>
            </TouchableOpacity>
          )}
        </View>

        {/* Lanes */}
        {builderTeams.length === 0 ? (
          <View style={styles.emptyState}>
            <ThemedText style={[styles.emptyTitle, { color: c.secondaryText }]}>
              Add a team to begin.
            </ThemedText>
          </View>
        ) : (
          <View style={styles.lanesCol}>
            {builderTeams.map((bt) => {
              const isMe = bt.team_id === myTeamId;
              const partners = partnerTeamsFor(bt.team_id);

              return (
                <View key={bt.team_id} style={styles.fullCol}>

                  <TradeLane
                    team={bt}
                    isMe={isMe}
                    partnerTeams={partners}
                    teamNameMap={teamNameMap}
                    isMultiTeam={allTradeTeamIds.length > 2}
                    isCategories={isCategories}
                    pickConditionsEnabled={pickConditionsEnabled}
                    onAddChipPress={(type) => onOpenPicker(bt.team_id, type)}
                    onRemovePlayer={(playerId) => onRemovePlayer(bt.team_id, playerId)}
                    onRemovePick={(pickId) => onRemovePick(bt.team_id, pickId)}
                    onRemoveSwap={(season, round) => onRemoveSwap(bt.team_id, season, round)}
                    onSetPlayerDest={(playerId, toTeamId) => onSetPlayerDest(bt.team_id, playerId, toTeamId)}
                    onSetPickDest={(pickId, toTeamId) => onSetPickDest(bt.team_id, pickId, toTeamId)}
                    onRemoveTeam={
                      !isMe
                        ? () => onToggleTeam({ id: bt.team_id, name: bt.team_name })
                        : undefined
                    }
                  />
                </View>
              );
            })}
          </View>
        )}

        {/* Roster capacity warning */}
        {rosterWarnings && rosterWarnings.length > 0 && (
          <View
            accessibilityRole="alert"
            style={[styles.rosterWarning, { backgroundColor: c.warningMuted, borderColor: c.warning }]}
          >
            <Ionicons name="warning" size={16} color={c.warning} />
            <ThemedText style={{ fontSize: ms(12), color: c.warning, flex: 1 }}>
              {rosterWarnings.length === 1
                ? `${rosterWarnings[0]} would exceed the roster limit. They'll need to drop a player.`
                : `${rosterWarnings.join(' and ')} would exceed the roster limit.`}
            </ThemedText>
          </View>
        )}

        {/* Notes — collapsed by default, auto-expanded when seeded. */}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={notesExpanded ? 'Collapse notes' : 'Expand notes'}
          accessibilityState={{ expanded: notesExpanded }}
          onPress={() => setNotesExpanded((v) => !v)}
          style={[styles.notesToggle, { borderColor: c.border }]}
        >
          <ThemedText
            type="varsitySmall"
            style={[styles.notesEyebrow, { color: c.gold }]}
          >
            Notes
          </ThemedText>
          <Ionicons
            name={notesExpanded ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={c.gold}
          />
        </TouchableOpacity>
        {notesExpanded && (
          <TextInput
            accessibilityLabel="Trade note"
            style={[styles.notesInput, { backgroundColor: c.cardAlt, color: c.text, borderColor: c.border }]}
            placeholder="Add a note (optional)"
            placeholderTextColor={c.secondaryText}
            value={notes}
            onChangeText={onNotesChange}
            multiline
          />
        )}
      </ScrollView>

      {/* Pinned live fairness — points leagues only. */}
      {!isCategories && hasAssets && (
        <View style={[styles.pinnedFairness, { borderTopColor: c.border }]}>
          <TradeFairnessBar teams={fairness} />
        </View>
      )}

      {/* Add-team picker — small centered list of eligible partners. */}
      <Modal
        visible={addTeamOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setAddTeamOpen(false)}
      >
        <Pressable
          accessibilityLabel="Close add team picker"
          style={styles.addTeamBackdrop}
          onPress={() => setAddTeamOpen(false)}
        >
          <Pressable
            onPress={() => {}}
            style={[
              styles.addTeamSheet,
              { backgroundColor: c.card, borderColor: c.border, maxWidth: width * 0.85 },
            ]}
          >
            <View style={styles.addTeamHeader}>
              <View style={[styles.headerRule, { backgroundColor: c.gold }]} />
              <ThemedText
                type="varsitySmall"
                style={[styles.addTeamEyebrow, { color: c.gold }]}
              >
                Add Team
              </ThemedText>
            </View>
            {eligibleAddTeams.map((t) => (
              <TouchableOpacity
                key={t.id}
                accessibilityRole="button"
                accessibilityLabel={`Add ${t.name} to trade`}
                style={[styles.addTeamRow, { borderBottomColor: c.border }]}
                onPress={() => {
                  onToggleTeam(t);
                  setAddTeamOpen(false);
                }}
              >
                <ThemedText
                  type="defaultSemiBold"
                  style={{ color: c.text, fontSize: ms(14) }}
                >
                  {t.name}
                </ThemedText>
                <Ionicons name="add-circle-outline" size={18} color={c.gold} />
              </TouchableOpacity>
            ))}
            {eligibleAddTeams.length === 0 && (
              <ThemedText style={[styles.emptyText, { color: c.secondaryText }]}>
                No more teams available.
              </ThemedText>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  layout: { flex: 1 },
  scroll: {
    paddingHorizontal: s(12),
    paddingTop: s(8),
    paddingBottom: s(12),
    gap: s(10),
  },

  badgeRow: {
    flexDirection: 'row',
    gap: s(6),
  },

  teamChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: s(6),
    marginBottom: s(2),
  },
  teamChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
    paddingHorizontal: s(10),
    paddingVertical: s(4),
    borderRadius: 12,
  },
  teamChipText: {
    fontSize: ms(11),
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  addTeamChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
    paddingHorizontal: s(10),
    paddingVertical: s(4),
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  addTeamChipText: {
    fontSize: ms(10),
    fontWeight: '700',
    letterSpacing: 0.6,
  },

  lanesCol: {
    flexDirection: 'column',
    gap: s(10),
  },
  fullCol: { width: '100%' },

  emptyState: {
    paddingVertical: s(40),
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: ms(14),
    fontStyle: 'italic',
  },

  rosterWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    borderWidth: 1,
    borderRadius: 10,
    padding: s(10),
  },

  notesToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    paddingVertical: s(8),
    paddingHorizontal: s(10),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  notesEyebrow: {
    flex: 1,
    fontSize: ms(9),
    letterSpacing: 1.4,
  },
  notesInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: s(10),
    fontSize: ms(13),
    minHeight: s(50),
    textAlignVertical: 'top',
  },

  pinnedFairness: {
    paddingHorizontal: s(12),
    paddingTop: s(8),
    paddingBottom: s(4),
    borderTopWidth: StyleSheet.hairlineWidth,
  },

  addTeamBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: s(20),
  },
  addTeamSheet: {
    width: '100%',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: s(8),
    overflow: 'hidden',
  },
  addTeamHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    paddingHorizontal: s(14),
    paddingVertical: s(10),
  },
  headerRule: { height: 2, width: s(14) },
  addTeamEyebrow: {
    fontSize: ms(9),
    letterSpacing: 1.4,
  },
  addTeamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: s(14),
    paddingVertical: s(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  emptyText: {
    fontSize: ms(13),
    paddingHorizontal: s(14),
    paddingVertical: s(20),
    textAlign: 'center',
  },
});
