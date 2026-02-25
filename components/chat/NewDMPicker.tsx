import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeague } from '@/hooks/useLeague';
import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

interface Props {
  visible: boolean;
  currentTeamId: string;
  onSelect: (teamId: string) => void;
  onClose: () => void;
}

export function NewDMPicker({ visible, currentTeamId, onSelect, onClose }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { data: league, isLoading } = useLeague();

  const teams = (league?.league_teams ?? []).filter(
    (t: any) => t.id !== currentTeamId,
  );

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <View style={[styles.content, { backgroundColor: c.card }]} onStartShouldSetResponder={() => true}>
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={c.text} />
            </TouchableOpacity>
            <ThemedText type="subtitle">New Message</ThemedText>
            <View style={{ width: 24 }} />
          </View>

          {isLoading ? (
            <ActivityIndicator style={{ marginTop: 20 }} />
          ) : teams.length === 0 ? (
            <ThemedText style={[styles.empty, { color: c.secondaryText }]}>
              No other teams in this league
            </ThemedText>
          ) : (
            <FlatList
              data={teams}
              keyExtractor={(item: any) => item.id}
              renderItem={({ item }: { item: any }) => (
                <TouchableOpacity
                  style={[styles.row, { borderBottomColor: c.border }]}
                  onPress={() => onSelect(item.id)}
                >
                  <ThemedText style={styles.teamName}>{item.name}</ThemedText>
                  <Ionicons name="chevron-forward" size={18} color={c.secondaryText} />
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  content: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    padding: 20,
    paddingBottom: 32,
    minHeight: '40%',
    maxHeight: '70%',
    overflow: 'hidden' as const,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  teamName: {
    fontSize: 15,
    fontWeight: '500',
    flex: 1,
  },
  empty: {
    textAlign: 'center',
    marginTop: 24,
    fontSize: 14,
  },
});
