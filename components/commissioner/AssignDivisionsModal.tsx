import { ThemedText } from '@/components/ThemedText';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { TeamLogo } from '@/components/team/TeamLogo';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

interface Team {
  id: string;
  name: string;
  tricode: string | null;
  logo_key: string | null;
  division: number | null;
}

interface AssignDivisionsModalProps {
  visible: boolean;
  onClose: () => void;
  leagueId: string;
  division1Name: string;
  division2Name: string;
  teams: Team[];
}

export function AssignDivisionsModal({
  visible,
  onClose,
  leagueId,
  division1Name,
  division2Name,
  teams,
}: AssignDivisionsModalProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const queryClient = useQueryClient();

  const [assignments, setAssignments] = useState<Record<string, 1 | 2>>({});
  const [saving, setSaving] = useState(false);

  // Initialize from current team divisions
  useEffect(() => {
    if (visible && teams.length > 0) {
      const init: Record<string, 1 | 2> = {};
      for (const t of teams) {
        init[t.id] = (t.division === 1 || t.division === 2) ? t.division : 1;
      }
      setAssignments(init);
    }
  }, [visible, teams]);

  const div1Count = Object.values(assignments).filter(v => v === 1).length;
  const div2Count = Object.values(assignments).filter(v => v === 2).length;
  const isBalanced = Math.abs(div1Count - div2Count) <= 1;

  function handleRandomize() {
    const ids = teams.map(t => t.id);
    const shuffled = [...ids].sort(() => Math.random() - 0.5);
    const half = Math.ceil(shuffled.length / 2);
    const newAssignments: Record<string, 1 | 2> = {};
    shuffled.forEach((id, i) => {
      newAssignments[id] = i < half ? 1 : 2;
    });
    setAssignments(newAssignments);
  }

  async function handleSave() {
    if (!isBalanced) {
      Alert.alert('Unbalanced', 'Divisions must be within 1 team of each other.');
      return;
    }
    setSaving(true);
    try {
      for (const [teamId, division] of Object.entries(assignments)) {
        const { error } = await supabase
          .from('teams')
          .update({ division })
          .eq('id', teamId);
        if (error) throw error;
      }
      queryClient.invalidateQueries({ queryKey: ['league', leagueId] });
      queryClient.invalidateQueries({ queryKey: ['standings', leagueId] });
      onClose();
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to save division assignments.');
    } finally {
      setSaving(false);
    }
  }

  const divNames = [division1Name, division2Name];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: c.card }]} accessibilityViewIsModal={true}>
          <View style={[styles.handle, { backgroundColor: c.border }]} />

          <View style={styles.titleRow}>
            <ThemedText accessibilityRole="header" style={styles.title}>Assign Divisions</ThemedText>
          </View>

          {/* Balance indicator */}
          <View style={[styles.balanceRow, { backgroundColor: c.cardAlt }]}>
            <ThemedText style={[styles.balanceText, { color: c.secondaryText }]}>
              {division1Name}: {div1Count}  •  {division2Name}: {div2Count}
            </ThemedText>
            {!isBalanced && (
              <ThemedText style={[styles.balanceWarn, { color: c.danger }]}>
                Divisions must be balanced (±1)
              </ThemedText>
            )}
          </View>

          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} nestedScrollEnabled>
            {teams.map((team) => (
              <View key={team.id} style={[styles.teamRow, { borderBottomColor: c.border }]}>
                <View style={styles.teamInfo}>
                  <TeamLogo logoKey={team.logo_key} teamName={team.name} tricode={team.tricode ?? undefined} size="small" />
                  <ThemedText style={styles.teamName} numberOfLines={1}>{team.name}</ThemedText>
                </View>
                <View style={styles.segmentWrap}>
                  <SegmentedControl
                    options={divNames}
                    selectedIndex={(assignments[team.id] ?? 1) - 1}
                    onSelect={(i) => setAssignments(prev => ({ ...prev, [team.id]: (i + 1) as 1 | 2 }))}
                  />
                </View>
              </View>
            ))}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Randomize division assignments"
              style={[styles.btn, { backgroundColor: c.cardAlt }]}
              onPress={handleRandomize}
            >
              <ThemedText style={styles.btnText}>Randomize</ThemedText>
            </TouchableOpacity>
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
              accessibilityLabel="Save"
              accessibilityState={{ disabled: saving || !isBalanced }}
              style={[styles.btn, styles.saveBtnWide, { backgroundColor: saving || !isBalanced ? c.buttonDisabled : c.accent }]}
              onPress={handleSave}
              disabled={saving || !isBalanced}
            >
              {saving ? (
                <ActivityIndicator color={c.statusText} size="small" />
              ) : (
                <ThemedText style={[styles.btnText, { color: c.accentText }]}>Save</ThemedText>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
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
    paddingTop: 12,
    paddingBottom: 40,
    maxHeight: '85%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
  balanceRow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginHorizontal: 16,
    borderRadius: 8,
    marginBottom: 8,
    alignItems: 'center',
  },
  balanceText: {
    fontSize: 13,
    fontWeight: '500',
  },
  balanceWarn: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  scroll: {
    flexShrink: 1,
    paddingHorizontal: 16,
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  teamInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  teamName: {
    fontSize: 14,
    flexShrink: 1,
  },
  segmentWrap: {
    width: 180,
  },
  footer: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  btn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveBtnWide: {
    flex: 1.5,
  },
  btnText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
