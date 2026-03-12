import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { TradeBlockPlayer, TradeBlockTeamGroup } from '@/hooks/useTrades';
import { Ionicons } from '@expo/vector-icons';
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
  teamId: string;
  onClose: () => void;
  onPlayerPress: (player: TradeBlockPlayer) => void;
}

export function TradeBlockSheet({ visible, tradeBlock, teamId, onClose, onPlayerPress }: TradeBlockSheetProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const totalPlayers = tradeBlock.reduce((sum, g) => sum + g.players.length, 0);

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
              </ThemedText>
            </View>
            <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close trade block">
              <ThemedText style={styles.closeText}>✕</ThemedText>
            </TouchableOpacity>
          </View>

          {/* Player list */}
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {tradeBlock.map((group) => (
              <View key={group.team_id} style={[styles.section, { borderColor: c.border }]}>
                <ThemedText style={[styles.teamName, { color: c.secondaryText }]}>
                  {group.team_id === teamId ? 'Your Team' : group.team_name}
                </ThemedText>
                {group.players.map((p) => (
                  <TouchableOpacity
                    key={p.player_id}
                    style={[styles.playerRow, { backgroundColor: c.card }]}
                    onPress={() => onPlayerPress(p)}
                    activeOpacity={p.team_id === teamId ? 1 : 0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`${p.name}, ${p.position}, ${p.nba_team}`}
                    accessibilityHint={p.team_id !== teamId ? 'Propose a trade for this player' : undefined}
                  >
                    <View style={styles.playerInfo}>
                      <ThemedText style={styles.playerName} numberOfLines={1}>{p.name}</ThemedText>
                      <ThemedText style={[styles.playerMeta, { color: c.secondaryText }]}>
                        {p.position} · {p.nba_team}
                      </ThemedText>
                    </View>
                    {p.team_id !== teamId && (
                      <Ionicons name="swap-horizontal-outline" size={16} color={c.accent} accessible={false} />
                    )}
                  </TouchableOpacity>
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
});
