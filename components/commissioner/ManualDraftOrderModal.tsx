import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { manuallyAssignDraftSlots } from '@/lib/draft';
import { ms, s } from '@/utils/scale';
import { supabase } from '@/lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import DraggableFlatList, {
  RenderItemParams,
  ScaleDecorator,
} from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

interface Team {
  id: string;
  name: string;
}

interface ManualDraftOrderModalProps {
  visible: boolean;
  onClose: () => void;
  leagueId: string;
  draftId: string;
}

export function ManualDraftOrderModal({
  visible,
  onClose,
  leagueId,
  draftId,
}: ManualDraftOrderModalProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const queryClient = useQueryClient();

  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    loadTeams();
  }, [visible, leagueId, draftId]);

  async function loadTeams() {
    setLoading(true);

    // Check if slots are already assigned by looking at draft picks
    const { data: picks } = await supabase
      .from('draft_picks')
      .select('slot_number, current_team_id, teams!draft_picks_current_team_id_fkey(id, name)')
      .eq('draft_id', draftId)
      .eq('round', 1)
      .not('current_team_id', 'is', null)
      .order('slot_number', { ascending: true });

    if (picks && picks.length > 0) {
      // Order from existing slot assignments
      const ordered = picks
        .filter((p: any) => p.teams)
        .map((p: any) => ({ id: p.teams.id, name: p.teams.name }));

      // Deduplicate (each team appears once per round)
      const seen = new Set<string>();
      const unique = ordered.filter((t: Team) => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      });

      if (unique.length > 0) {
        setTeams(unique);
        setLoading(false);
        return;
      }
    }

    // Fallback: load all teams alphabetically (slots not yet assigned)
    const { data: allTeams } = await supabase
      .from('teams')
      .select('id, name')
      .eq('league_id', leagueId)
      .order('name', { ascending: true });

    setTeams(allTeams ?? []);
    setLoading(false);
  }

  async function handleSave() {
    if (teams.length === 0) return;
    setSaving(true);

    try {
      await manuallyAssignDraftSlots(
        leagueId,
        draftId,
        teams.map((t) => t.id)
      );

      queryClient.invalidateQueries({ queryKey: ['activeDraft', leagueId] });
      queryClient.invalidateQueries({ queryKey: ['leagueDraft', leagueId] });
      onClose();
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to save draft order');
    } finally {
      setSaving(false);
    }
  }

  const renderItem = useCallback(
    ({ item, drag, isActive, getIndex }: RenderItemParams<Team>) => {
      const index = getIndex() ?? 0;
      return (
        <ScaleDecorator>
          <TouchableOpacity
            activeOpacity={0.7}
            onLongPress={drag}
            disabled={isActive}
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, pick ${index + 1}. Long press to reorder.`}
            accessibilityHint="Long press and drag to change draft position"
            style={[
              styles.teamRow,
              {
                backgroundColor: isActive ? c.cardAlt : c.card,
                borderColor: isActive ? c.accent : c.border,
              },
            ]}
          >
            <View style={styles.slotBadge}>
              <ThemedText style={styles.slotText}>{index + 1}</ThemedText>
            </View>
            <ThemedText style={styles.teamName}>{item.name}</ThemedText>
            <Ionicons
              name="reorder-three"
              size={22}
              color={c.secondaryText}
              accessibilityLabel="Drag handle"
            />
          </TouchableOpacity>
        </ScaleDecorator>
      );
    },
    [c]
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: c.card }]}
          onPress={() => {}}
          accessibilityViewIsModal={true}
        >
          {/* Handle */}
          <View style={[styles.handle, { backgroundColor: c.border }]} />

          {/* Title */}
          <View style={styles.titleRow}>
            <ThemedText accessibilityRole="header" style={styles.title}>
              Set Draft Order
            </ThemedText>
          </View>

          <ThemedText style={[styles.hint, { color: c.secondaryText }]}>
            Long press and drag to reorder teams. Team at the top picks first.
          </ThemedText>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" />
            </View>
          ) : (
            <GestureHandlerRootView style={styles.listContainer}>
              <DraggableFlatList
                data={teams}
                keyExtractor={(item) => item.id}
                renderItem={renderItem}
                onDragEnd={({ data }) => setTeams(data)}
                containerStyle={styles.list}
              />
            </GestureHandlerRootView>
          )}

          {/* Footer */}
          <View style={styles.footer}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              style={[styles.btn, { backgroundColor: c.cardAlt }]}
              onPress={onClose}
            >
              <ThemedText style={styles.btnText}>Cancel</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Save draft order"
              accessibilityState={{ disabled: saving || loading }}
              style={[
                styles.btn,
                { backgroundColor: saving || loading ? c.buttonDisabled : c.accent },
              ]}
              onPress={handleSave}
              disabled={saving || loading}
            >
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={[styles.btnText, { color: c.accentText }]}>
                  Save Order
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: s(12),
    paddingBottom: s(40),
    maxHeight: '85%',
  },
  handle: {
    width: s(40),
    height: s(4),
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: s(12),
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: s(16),
    marginBottom: s(8),
  },
  title: { fontSize: ms(17), fontWeight: '600' },
  hint: {
    fontSize: ms(13),
    paddingHorizontal: s(16),
    marginBottom: s(12),
    textAlign: 'center',
  },
  loadingContainer: {
    paddingVertical: s(40),
    alignItems: 'center',
  },
  listContainer: {
    flexShrink: 1,
  },
  list: {
    paddingHorizontal: s(16),
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(14),
    paddingHorizontal: s(12),
    marginBottom: s(6),
    borderRadius: 10,
    borderWidth: 1,
  },
  slotBadge: {
    width: s(28),
    alignItems: 'center',
  },
  slotText: {
    fontSize: ms(15),
    fontWeight: '700',
  },
  teamName: {
    flex: 1,
    fontSize: ms(15),
    marginLeft: s(8),
  },
  footer: {
    flexDirection: 'row',
    gap: s(12),
    paddingHorizontal: s(16),
    paddingTop: s(16),
  },
  btn: {
    flex: 1,
    paddingVertical: s(14),
    borderRadius: 10,
    alignItems: 'center',
  },
  btnText: { fontSize: ms(15), fontWeight: '600' },
});
