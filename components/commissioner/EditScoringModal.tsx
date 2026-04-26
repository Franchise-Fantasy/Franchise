import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  Alert,
  StyleSheet,
  Switch,
  View,
} from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { BrandButton } from '@/components/ui/BrandButton';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { ThemedText } from '@/components/ui/ThemedText';
import { DEFAULT_CATEGORIES, DEFAULT_SCORING } from '@/constants/LeagueDefaults';
import { useColors } from '@/hooks/useColors';
import { supabase } from '@/lib/supabase';
import { ms, s } from '@/utils/scale';

function statLabel(stat: string): string {
  return DEFAULT_SCORING.find((d) => d.stat_name === stat)?.label
    ?? DEFAULT_CATEGORIES.find((d) => d.stat_name === stat)?.label
    ?? stat;
}

interface EditScoringModalProps {
  visible: boolean;
  onClose: () => void;
  leagueId: string;
  scoring: { stat_name: string; point_value: number; is_enabled?: boolean; inverse?: boolean }[] | undefined;
  scoringType?: string;
}

export function EditScoringModal({ visible, onClose, leagueId, scoring, scoringType }: EditScoringModalProps) {
  const c = useColors();
  const queryClient = useQueryClient();
  const isCategories = scoringType === 'h2h_categories';

  const [editScoring, setEditScoring] = useState<{ stat_name: string; point_value: number }[]>([]);
  const [editCategories, setEditCategories] = useState<{ stat_name: string; is_enabled: boolean; inverse: boolean }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible && scoring) {
      if (isCategories) {
        const merged = DEFAULT_CATEGORIES.map((d) => {
          const existing = scoring.find((s) => s.stat_name === d.stat_name);
          return {
            stat_name: d.stat_name,
            is_enabled: existing?.is_enabled ?? d.is_enabled,
            inverse: d.inverse,
          };
        });
        setEditCategories(merged);
      } else {
        const merged = DEFAULT_SCORING.map((d) => {
          const existing = scoring.find((s) => s.stat_name === d.stat_name);
          return { stat_name: d.stat_name, point_value: existing?.point_value ?? d.point_value };
        });
        setEditScoring(merged);
      }
    }
  }, [visible]);

  async function handleSave() {
    setSaving(true);
    const { error: delErr } = await supabase.from('league_scoring_settings').delete().eq('league_id', leagueId);
    if (delErr) { setSaving(false); Alert.alert('Error', delErr.message); return; }

    const rows = isCategories
      ? editCategories
          .filter((cat) => cat.is_enabled)
          .map((cat) => ({
            league_id: leagueId,
            stat_name: cat.stat_name,
            point_value: 0,
            is_enabled: true,
            inverse: cat.inverse,
          }))
      : editScoring.map((row) => ({
          league_id: leagueId,
          stat_name: row.stat_name,
          point_value: row.point_value,
          is_enabled: true,
          inverse: false,
        }));

    const { error: insErr } = await supabase.from('league_scoring_settings').insert(rows);
    if (insErr) { setSaving(false); Alert.alert('Error', insErr.message); return; }
    setSaving(false);
    queryClient.invalidateQueries({ queryKey: ['leagueScoring', leagueId] });
    onClose();
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={isCategories ? 'Edit Categories' : 'Edit Scoring'}
      footer={
        <View style={styles.footer}>
          <BrandButton
            label="Cancel"
            variant="secondary"
            size="large"
            onPress={onClose}
            fullWidth
            style={styles.footerBtn}
            accessibilityLabel="Cancel"
          />
          <BrandButton
            label="Save"
            variant="primary"
            size="large"
            onPress={handleSave}
            loading={saving}
            fullWidth
            style={styles.footerBtn}
            accessibilityLabel="Save"
          />
        </View>
      }
    >
      {isCategories ? (
        editCategories.map((cat, idx) => (
          <View key={cat.stat_name} style={[styles.catRow, { borderBottomColor: c.border }, idx === editCategories.length - 1 && { borderBottomWidth: 0 }]}>
            <View style={styles.catLeft}>
              <ThemedText style={styles.catLabel}>{cat.stat_name}</ThemedText>
              <ThemedText style={[styles.catSublabel, { color: c.secondaryText }]}>
                {statLabel(cat.stat_name)}
                {cat.inverse ? ' (lower wins)' : ''}
              </ThemedText>
            </View>
            <Switch
              value={cat.is_enabled}
              onValueChange={(v) => {
                const next = [...editCategories];
                next[idx] = { ...cat, is_enabled: v };
                setEditCategories(next);
              }}
              trackColor={{ false: c.border, true: c.accent }}
              accessibilityLabel={`${statLabel(cat.stat_name)}, ${cat.is_enabled ? 'enabled' : 'disabled'}`}
              accessibilityState={{ checked: cat.is_enabled }}
            />
          </View>
        ))
      ) : (
        editScoring.map((row, idx) => (
          <NumberStepper
            key={row.stat_name}
            label={statLabel(row.stat_name)}
            value={row.point_value}
            onValueChange={(v) => {
              const next = [...editScoring];
              next[idx] = { ...row, point_value: v };
              setEditScoring(next);
            }}
            min={-10}
            max={10}
            step={0.5}
          />
        ))
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', gap: s(12) },
  footerBtn: { flex: 1 },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: s(10),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  catLeft: { flex: 1, marginRight: s(12) },
  catLabel: { fontSize: ms(16), fontWeight: '600' },
  catSublabel: { fontSize: ms(12), marginTop: 1 },
});
