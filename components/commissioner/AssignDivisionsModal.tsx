import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  Alert,
  StyleSheet,
  View,
} from 'react-native';

import { TeamLogo } from '@/components/team/TeamLogo';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { BrandButton } from '@/components/ui/BrandButton';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ThemedText } from '@/components/ui/ThemedText';
import { useColors } from '@/hooks/useColors';
import { supabase } from '@/lib/supabase';
import { ms, s } from '@/utils/scale';

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
  const c = useColors();
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
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Assign Divisions"
      subtitle={`${division1Name}: ${div1Count}  •  ${division2Name}: ${div2Count}`}
      footer={
        <View style={styles.footer}>
          <BrandButton
            label="Randomize"
            variant="ghost"
            size="large"
            onPress={handleRandomize}
            style={styles.footerBtn}
            accessibilityLabel="Randomize division assignments"
          />
          <BrandButton
            label="Cancel"
            variant="secondary"
            size="large"
            onPress={onClose}
            style={styles.footerBtn}
            accessibilityLabel="Cancel"
          />
          <BrandButton
            label="Save"
            variant="primary"
            size="large"
            onPress={handleSave}
            loading={saving}
            disabled={!isBalanced}
            style={styles.footerSaveBtn}
            accessibilityLabel="Save"
          />
        </View>
      }
    >
      {!isBalanced && (
        <ThemedText style={[styles.balanceWarn, { color: c.danger }]}>
          Divisions must be balanced (±1)
        </ThemedText>
      )}

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
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  balanceWarn: {
    fontSize: ms(12),
    fontWeight: '600',
    marginBottom: s(8),
    textAlign: 'center',
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: s(10),
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: s(8),
  },
  teamInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    flex: 1,
    minWidth: 0,
  },
  teamName: {
    fontSize: ms(14),
    flexShrink: 1,
  },
  segmentWrap: {
    width: s(180),
  },
  footer: {
    flexDirection: 'row',
    gap: s(8),
    alignItems: 'center',
  },
  footerBtn: {
    flex: 1,
  },
  footerSaveBtn: {
    flex: 1.5,
  },
});
