import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { ThemedText } from '@/components/ui/ThemedText';
import { useColors } from '@/hooks/useColors';
import { TradeBlockPlayer, TradeBlockTeamGroup, useToggleTradeBlockInterest } from '@/hooks/useTrades';
import { logger } from '@/utils/logger';
import { ms, s } from '@/utils/scale';

interface TradeBlockSheetProps {
  visible: boolean;
  tradeBlock: TradeBlockTeamGroup[];
  leagueId: string;
  teamId: string;
  onClose: () => void;
  onPlayerPress: (player: TradeBlockPlayer) => void;
}

export function TradeBlockSheet({
  visible,
  tradeBlock,
  leagueId,
  teamId,
  onClose,
  onPlayerPress,
}: TradeBlockSheetProps) {
  const c = useColors();
  const [hiddenPlayers, setHiddenPlayers] = useState<Set<string>>(new Set());
  const [expandedInterest, setExpandedInterest] = useState<string | null>(null);
  const [expandedNote, setExpandedNote] = useState<string | null>(null);
  const { mutate: toggleInterest } = useToggleTradeBlockInterest(leagueId);

  const storageKey = `hiddenTradeBlock:${leagueId}`;

  // Load hidden players from storage on mount
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(storageKey)
      .then((raw) => {
        if (cancelled || !raw) return;
        try {
          setHiddenPlayers(new Set(JSON.parse(raw)));
        } catch (e) {
          logger.warn('Parse hidden trade-block list failed', e);
        }
      })
      .catch((e) => logger.warn('Load hidden trade-block list failed', e));
    return () => {
      cancelled = true;
    };
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

  const subtitle = hiddenCount > 0 ? `Trade Block · ${hiddenCount} Hidden` : 'Trade Block';
  const title = `${totalPlayers} ${totalPlayers === 1 ? 'Player' : 'Players'} Available`;

  const headerAction = hiddenCount > 0 ? (
    <TouchableOpacity
      onPress={() => persistHidden(new Set())}
      style={[styles.showAllBtn, { borderColor: c.border }]}
      accessibilityRole="button"
      accessibilityLabel="Show all hidden players"
    >
      <ThemedText style={[styles.showAllText, { color: c.gold }]}>Show all</ThemedText>
    </TouchableOpacity>
  ) : null;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      headerAction={headerAction}
      bodyStyle={styles.body}
    >
      {filteredBlock.map((group) => (
        <View
          key={group.team_id}
          style={[styles.section, { borderColor: c.border, backgroundColor: c.card }]}
        >
          {/* Team eyebrow — gold-rule + varsity caps rhythm matching the
              receives blocks elsewhere in the trade UI. */}
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionRule, { backgroundColor: c.gold }]} />
            <ThemedText
              type="varsitySmall"
              style={[styles.teamName, { color: c.gold }]}
              numberOfLines={1}
            >
              {group.team_id === teamId ? 'Your Team' : group.team_name}
            </ThemedText>
          </View>
          {group.players.map((p) => (
            <View key={p.player_id}>
              <View style={[styles.playerRow, { backgroundColor: c.card }]}>
                <TouchableOpacity
                  style={styles.playerTouchable}
                  onPress={() => onPlayerPress(p)}
                  activeOpacity={p.team_id === teamId ? 1 : 0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`${p.name}, ${p.position}, ${p.pro_team}${p.trade_block_note ? `, looking for: ${p.trade_block_note}` : ''}`}
                  accessibilityHint={p.team_id !== teamId ? 'Propose a trade for this player' : undefined}
                >
                  <View style={styles.playerInfo}>
                    <ThemedText style={styles.playerName} numberOfLines={1}>{p.name}</ThemedText>
                    <ThemedText style={[styles.playerMeta, { color: c.secondaryText }]}>
                      {p.position} · {p.pro_team}
                    </ThemedText>
                    {p.trade_block_note ? (() => {
                      const willTruncate = p.trade_block_note.length > 35;
                      const isExpanded = expandedNote === p.player_id;
                      return (
                        <TouchableOpacity
                          onPress={() => willTruncate ? setExpandedNote(isExpanded ? null : p.player_id) : undefined}
                          activeOpacity={willTruncate ? 0.7 : 1}
                          style={styles.noteTouchable}
                          accessibilityRole={willTruncate ? 'button' : undefined}
                          accessibilityLabel={willTruncate
                            ? `Looking for: ${p.trade_block_note}. Tap to ${isExpanded ? 'collapse' : 'expand'}`
                            : `Looking for: ${p.trade_block_note}`}
                        >
                          {willTruncate && (
                            <Ionicons
                              name={isExpanded ? 'chevron-up' : 'chevron-down'}
                              size={11}
                              color={c.gold}
                              style={styles.noteChevron}
                              accessible={false}
                            />
                          )}
                          <ThemedText
                            style={[styles.askingPrice, { color: c.gold }]}
                            numberOfLines={isExpanded ? undefined : 1}
                          >
                            Looking for: {p.trade_block_note}
                          </ThemedText>
                        </TouchableOpacity>
                      );
                    })() : null}
                  </View>
                  {p.team_id !== teamId && (
                    <Ionicons name="swap-horizontal-outline" size={16} color={c.gold} accessible={false} />
                  )}
                </TouchableOpacity>
                {p.team_id === teamId && p.trade_block_interest.length > 0 && (
                  <TouchableOpacity
                    style={styles.interestBadge}
                    onPress={() =>
                      setExpandedInterest(expandedInterest === p.player_id ? null : p.player_id)
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`${p.trade_block_interest.length} ${p.trade_block_interest.length === 1 ? 'team' : 'teams'} interested in ${p.name}. Tap to ${expandedInterest === p.player_id ? 'hide' : 'show'} team names`}
                  >
                    <Ionicons name="eye" size={13} color={c.gold} />
                    <ThemedText style={[styles.interestCount, { color: c.gold }]}>
                      {p.trade_block_interest.length}
                    </ThemedText>
                    <Ionicons
                      name={expandedInterest === p.player_id ? 'chevron-up' : 'chevron-down'}
                      size={12}
                      color={c.gold}
                      accessible={false}
                    />
                  </TouchableOpacity>
                )}
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
                        color={p.trade_block_interest.includes(teamId) ? c.gold : c.secondaryText}
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
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: s(16),
  },
  showAllBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingHorizontal: s(8),
    paddingVertical: s(4),
  },
  showAllText: {
    fontSize: ms(12),
    fontWeight: '600',
  },
  section: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: s(12),
    marginBottom: s(12),
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    marginBottom: s(8),
  },
  sectionRule: { height: 2, width: s(14) },
  teamName: {
    fontSize: ms(10),
    letterSpacing: 1.4,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(10),
    paddingHorizontal: s(12),
    borderRadius: 8,
    marginBottom: s(4),
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
    fontSize: ms(14),
    fontWeight: '500',
  },
  playerMeta: {
    fontSize: ms(12),
  },
  noteTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: s(2),
  },
  askingPrice: {
    fontSize: ms(11),
    fontStyle: 'italic',
    flexShrink: 1,
  },
  noteChevron: {
    marginRight: s(3),
    marginTop: 1,
  },
  interestBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(3),
    paddingLeft: s(8),
  },
  interestCount: {
    fontSize: ms(12),
    fontWeight: '600',
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(16),
    paddingLeft: s(12),
  },
  actionBtn: {
    padding: s(6),
  },
  interestList: {
    marginHorizontal: s(12),
    marginBottom: s(6),
    paddingVertical: s(8),
    paddingHorizontal: s(12),
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    gap: s(6),
  },
  interestListHeader: {
    fontSize: ms(11),
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: s(2),
  },
  interestTeamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  interestTeamName: {
    fontSize: ms(13),
    fontWeight: '500',
    flex: 1,
  },
});
