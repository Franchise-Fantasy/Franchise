import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { TradeBlockPlayer, TradeBlockTeamGroup } from '@/hooks/useTrades';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
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
                  <View key={p.player_id} style={[styles.playerRow, { backgroundColor: c.card }]}>
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
                          <ThemedText style={[styles.askingPrice, { color: c.accent }]} numberOfLines={1}>
                            Looking for: {p.trade_block_note}
                          </ThemedText>
                        ) : null}
                      </View>
                      {p.team_id !== teamId && (
                        <Ionicons name="swap-horizontal-outline" size={16} color={c.accent} accessible={false} />
                      )}
                    </TouchableOpacity>
                    {/* Hide button for other teams' players */}
                    {p.team_id !== teamId && (
                      <TouchableOpacity
                        style={styles.hideBtn}
                        onPress={() => toggleHidden(p.player_id)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityRole="button"
                        accessibilityLabel={`Not interested in ${p.name}`}
                      >
                        <Ionicons name="eye-off-outline" size={14} color={c.secondaryText} />
                      </TouchableOpacity>
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
  askingPrice: {
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 2,
  },
  hideBtn: {
    paddingLeft: 10,
  },
});
