import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { TradeBlockPlayer, TradeBlockTeamGroup, useToggleTradeBlockInterest } from '@/hooks/useTrades';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  TextLayoutEventData,
  TouchableOpacity,
  View,
} from 'react-native';

interface TradeBlockSheetProps {
  visible: boolean;
  tradeBlock: TradeBlockTeamGroup[];
  leagueId: string;
  teamId: string;
  onClose: () => void;
  onPlayerPress: (player: TradeBlockPlayer) => void;
}

export function TradeBlockSheet({ visible, tradeBlock, leagueId, teamId, onClose, onPlayerPress }: TradeBlockSheetProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [hiddenPlayers, setHiddenPlayers] = useState<Set<string>>(new Set());
  const [expandedInterest, setExpandedInterest] = useState<string | null>(null);
  const [expandedNote, setExpandedNote] = useState<string | null>(null);
  const { mutate: toggleInterest } = useToggleTradeBlockInterest(leagueId);
  const [truncatedNotes, setTruncatedNotes] = useState<Set<string>>(new Set());

  const storageKey = `hiddenTradeBlock:${leagueId}`;

  // Load hidden players from storage on mount
  useEffect(() => {
    AsyncStorage.getItem(storageKey).then((raw) => {
      if (raw) setHiddenPlayers(new Set(JSON.parse(raw)));
    });
  }, [storageKey]);

  const persistHidden = useCallback(
    (next: Set<string>) => {
      setHiddenPlayers(next);
      AsyncStorage.setItem(storageKey, JSON.stringify([...next]));
    },
    [storageKey],
  );

  const toggleHidden = (playerId: string) => {
    const next = new Set(hiddenPlayers);
    if (next.has(playerId)) next.delete(playerId);
    else next.add(playerId);
    persistHidden(next);
  };

  // Filter hidden players from other teams only (always show your own)
  const filteredBlock = tradeBlock
    .map((group) => ({
      ...group,
      players: group.players.filter(
        (p) => group.team_id === teamId || !hiddenPlayers.has(p.player_id),
      ),
    }))
    .filter((g) => g.players.length > 0);

  const totalPlayers = filteredBlock.reduce((sum, g) => sum + g.players.length, 0);
  const hiddenCount = hiddenPlayers.size;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: c.background }]} accessibilityViewIsModal>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: c.border }]}>
            <View>
              <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.headerTitle}>Trade Block</ThemedText>
              <ThemedText style={[styles.headerCount, { color: c.secondaryText }]}>
                {totalPlayers} {totalPlayers === 1 ? 'player' : 'players'} available
                {hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ''}
              </ThemedText>
            </View>
            <View style={styles.headerRight}>
              {hiddenCount > 0 && (
                <TouchableOpacity
                  onPress={() => persistHidden(new Set())}
                  style={[styles.showAllBtn, { borderColor: c.border }]}
                  accessibilityRole="button"
                  accessibilityLabel="Show all hidden players"
                >
                  <ThemedText style={[styles.showAllText, { color: c.accent }]}>Show all</ThemedText>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close trade block">
                <ThemedText style={styles.closeText}>✕</ThemedText>
              </TouchableOpacity>
            </View>
          </View>

          {/* Player list */}
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {filteredBlock.map((group) => (
              <View key={group.team_id} style={[styles.section, { borderColor: c.border }]}>
                <ThemedText style={[styles.teamName, { color: c.secondaryText }]}>
                  {group.team_id === teamId ? 'Your Team' : group.team_name}
                </ThemedText>
                {group.players.map((p) => (
                  <View key={p.player_id}>
                  <View style={[styles.playerRow, { backgroundColor: c.card }]}>
                    <TouchableOpacity
                      style={styles.playerTouchable}
                      onPress={() => onPlayerPress(p)}
                      activeOpacity={p.team_id === teamId ? 1 : 0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`${p.name}, ${p.position}, ${p.nba_team}${p.trade_block_note ? `, looking for: ${p.trade_block_note}` : ''}`}
                      accessibilityHint={p.team_id !== teamId ? 'Propose a trade for this player' : undefined}
                    >
                      <View style={styles.playerInfo}>
                        <ThemedText style={styles.playerName} numberOfLines={1}>{p.name}</ThemedText>
                        <ThemedText style={[styles.playerMeta, { color: c.secondaryText }]}>
                          {p.position} · {p.nba_team}
                        </ThemedText>
                        {p.trade_block_note ? (
                          <TouchableOpacity
                            onPress={() => truncatedNotes.has(p.player_id) ? setExpandedNote(expandedNote === p.player_id ? null : p.player_id) : undefined}
                            activeOpacity={truncatedNotes.has(p.player_id) ? 0.7 : 1}
                            style={styles.noteTouchable}
                            accessibilityRole={truncatedNotes.has(p.player_id) ? 'button' : undefined}
                            accessibilityLabel={truncatedNotes.has(p.player_id)
                              ? `Looking for: ${p.trade_block_note}. Tap to ${expandedNote === p.player_id ? 'collapse' : 'expand'}`
                              : `Looking for: ${p.trade_block_note}`}
                          >
                            <ThemedText
                              style={[styles.askingPrice, { color: c.accent }]}
                              numberOfLines={expandedNote === p.player_id ? undefined : 1}
                              onTextLayout={(e: NativeSyntheticEvent<TextLayoutEventData>) => {
                                // Only measure when collapsed (numberOfLines=1), otherwise expanding removes the chevron
                                if (expandedNote === p.player_id) return;
                                const lines = e.nativeEvent.lines;
                                const isTruncated = lines.length > 1 ||
                                  (lines.length === 1 && lines[0]?.text !== `Looking for: ${p.trade_block_note}`);
                                setTruncatedNotes((prev) => {
                                  if (isTruncated && !prev.has(p.player_id)) {
                                    const next = new Set(prev);
                                    next.add(p.player_id);
                                    return next;
                                  }
                                  if (!isTruncated && prev.has(p.player_id)) {
                                    const next = new Set(prev);
                                    next.delete(p.player_id);
                                    return next;
                                  }
                                  return prev;
                                });
                              }}
                            >
                              Looking for: {p.trade_block_note}
                            </ThemedText>
                            {truncatedNotes.has(p.player_id) && (
                              <Ionicons
                                name={expandedNote === p.player_id ? 'chevron-up' : 'chevron-down'}
                                size={11}
                                color={c.accent}
                                style={styles.noteChevron}
                                accessible={false}
                              />
                            )}
                          </TouchableOpacity>
                        ) : null}
                      </View>
                      {p.team_id !== teamId && (
                        <Ionicons name="swap-horizontal-outline" size={16} color={c.accent} accessible={false} />
                      )}
                    </TouchableOpacity>
                    {/* Interest badge for own players */}
                    {p.team_id === teamId && p.trade_block_interest.length > 0 && (
                      <TouchableOpacity
                        style={styles.interestBadge}
                        onPress={() =>
                          setExpandedInterest(expandedInterest === p.player_id ? null : p.player_id)
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`${p.trade_block_interest.length} ${p.trade_block_interest.length === 1 ? 'team' : 'teams'} interested in ${p.name}. Tap to ${expandedInterest === p.player_id ? 'hide' : 'show'} team names`}
                      >
                        <Ionicons name="eye" size={13} color={c.accent} />
                        <ThemedText style={[styles.interestCount, { color: c.accent }]}>
                          {p.trade_block_interest.length}
                        </ThemedText>
                        <Ionicons
                          name={expandedInterest === p.player_id ? 'chevron-up' : 'chevron-down'}
                          size={12}
                          color={c.accent}
                          accessible={false}
                        />
                      </TouchableOpacity>
                    )}
                    {/* Interest toggle + hide button for other teams' players */}
                    {p.team_id !== teamId && (
                      <View style={styles.actionButtons}>
                        <TouchableOpacity
                          style={styles.actionBtn}
                          onPress={() => {
                            toggleInterest({
                              playerId: p.player_id,
                              teamId,
                              currentInterest: p.trade_block_interest,
                              ownerTeamId: p.team_id,
                              playerName: p.name,
                            });
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={p.trade_block_interest.includes(teamId) ? `Withdraw interest in ${p.name}` : `Express interest in ${p.name}`}
                        >
                          <Ionicons
                            name={p.trade_block_interest.includes(teamId) ? 'hand-left' : 'hand-left-outline'}
                            size={18}
                            color={p.trade_block_interest.includes(teamId) ? c.accent : c.secondaryText}
                          />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.actionBtn}
                          onPress={() => toggleHidden(p.player_id)}
                          accessibilityRole="button"
                          accessibilityLabel={`Not interested in ${p.name}`}
                        >
                          <Ionicons name="eye-off-outline" size={18} color={c.secondaryText} />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                  {/* Expanded interest list */}
                  {p.team_id === teamId && expandedInterest === p.player_id && p.trade_block_interest.length > 0 && (
                    <View style={[styles.interestList, { backgroundColor: c.card, borderColor: c.border }]}>
                      <ThemedText style={[styles.interestListHeader, { color: c.secondaryText }]}>
                        Interested Teams
                      </ThemedText>
                      {p.trade_block_interest.map((tid) => (
                        <View key={tid} style={styles.interestTeamRow}>
                          <Ionicons name="people-outline" size={14} color={c.secondaryText} accessible={false} />
                          <ThemedText style={styles.interestTeamName} numberOfLines={1}>
                            {p.interest_team_names[tid] ?? 'Unknown'}
                          </ThemedText>
                        </View>
                      ))}
                    </View>
                  )}
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    maxHeight: '85%',
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 18,
    marginBottom: 4,
  },
  headerCount: {
    fontSize: 13,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  showAllBtn: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  showAllText: {
    fontSize: 12,
    fontWeight: '600',
  },
  closeText: {
    fontSize: 18,
    padding: 4,
  },
  content: {
    padding: 16,
    paddingBottom: 8,
  },
  section: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  teamName: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 4,
  },
  playerTouchable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  playerInfo: {
    flex: 1,
  },
  playerName: {
    fontSize: 14,
    fontWeight: '500',
  },
  playerMeta: {
    fontSize: 12,
  },
  noteTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  askingPrice: {
    fontSize: 11,
    fontStyle: 'italic',
    flexShrink: 1,
  },
  noteChevron: {
    marginLeft: 3,
    marginTop: 1,
  },
  interestBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingLeft: 8,
  },
  interestCount: {
    fontSize: 12,
    fontWeight: '600',
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingLeft: 12,
  },
  actionBtn: {
    padding: 6,
  },
  interestList: {
    marginHorizontal: 12,
    marginBottom: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  interestListHeader: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  interestTeamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  interestTeamName: {
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
});
