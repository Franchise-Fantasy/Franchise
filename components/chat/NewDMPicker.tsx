import { Ionicons } from '@expo/vector-icons';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeague } from '@/hooks/useLeague';
import { ms, s } from '@/utils/scale';

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
        <View style={[styles.content, { backgroundColor: c.card }]} onStartShouldSetResponder={() => true} accessibilityViewIsModal={true}>
          <View style={styles.header}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" onPress={onClose}>
              <Ionicons name="close" size={24} color={c.text} />
            </TouchableOpacity>
            <ThemedText accessibilityRole="header" type="subtitle">New Message</ThemedText>
            <View style={{ width: s(24) }} />
          </View>

          {isLoading ? (
            <View style={{ marginTop: s(20) }}><LogoSpinner /></View>
          ) : teams.length === 0 ? (
            <ThemedText style={[styles.empty, { color: c.secondaryText }]}>
              No other teams in this league
            </ThemedText>
          ) : (
            <FlatList
              data={teams}
              keyExtractor={(item: any) => item.id}
              renderItem={({ item, index }: { item: any; index: number }) => (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`Message ${item.name}`}
                  style={[styles.row, { borderBottomColor: c.border }, index === teams.length - 1 && { borderBottomWidth: 0 }]}
                  onPress={() => onSelect(item.id)}
                  activeOpacity={0.7}
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
    padding: s(20),
    paddingBottom: s(32),
    minHeight: '40%',
    maxHeight: '70%',
    overflow: 'hidden' as const,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: s(16),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(12),
    borderBottomWidth: 1,
  },
  teamName: {
    fontSize: ms(15),
    fontWeight: '500',
    flex: 1,
  },
  empty: {
    textAlign: 'center',
    marginTop: s(24),
    fontSize: ms(14),
  },
});
