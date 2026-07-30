import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  StyleSheet,
  Switch,
  View,
} from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { BrandButton } from '@/components/ui/BrandButton';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import { DEFAULT_CATEGORIES, DEFAULT_SCORING, type Sport } from '@/constants/LeagueDefaults';
import { useColors } from '@/hooks/useColors';
import { supabase } from '@/lib/supabase';
import { Json } from '@/types/database.types';
import { ms, s } from '@/utils/scale';
import { DST_PA_TIERS } from '@/utils/scoring/nflStatLine';
import { getSportModule, scoringStep } from '@/utils/sports/registry';

/** Friendly label for a stat key, from the league's OWN sport sheet (falling
 *  back to the basketball sheets, which is where the category names live). */
function statLabel(stat: string, sheet: readonly { stat_name: string; label: string }[]): string {
  return sheet.find((d) => d.stat_name === stat)?.label
    ?? DEFAULT_SCORING.find((d) => d.stat_name === stat)?.label
    ?? DEFAULT_CATEGORIES.find((d) => d.stat_name === stat)?.label
    ?? stat;
}

interface EditScoringModalProps {
  visible: boolean;
  onClose: () => void;
  leagueId: string;
  /** The league's sport — REQUIRED. This sheet is delete-and-replace, so
   *  building it from the wrong sport's stat list overwrites the league's real
   *  scoring with another sport's (and scores every player 0 forever). */
  sport: Sport;
  scoring: { stat_name: string; point_value: number; is_enabled?: boolean; inverse?: boolean }[] | undefined;
  scoringType?: string;
}

export function EditScoringModal({ visible, onClose, leagueId, sport, scoring, scoringType }: EditScoringModalProps) {
  const c = useColors();
  const queryClient = useQueryClient();
  const sportModule = getSportModule(sport);
  // Categories are basketball-only; a points sport can't be in categories mode.
  const isCategories = sportModule.supportsCategories && scoringType === 'h2h_categories';
  const defaultScoring = sportModule.defaultScoring;

  const [editScoring, setEditScoring] = useState<{ stat_name: string; point_value: number }[]>([]);
  const [editCategories, setEditCategories] = useState<{ stat_name: string; is_enabled: boolean; inverse: boolean }[]>([]);
  const [saving, setSaving] = useState(false);

  // Prevents a background query refetch from clobbering in-progress edits, and
  // (with the `scoring` gate below) prevents seeding from an unresolved query.
  const hydrated = useRef(false);

  useEffect(() => {
    if (!visible) {
      hydrated.current = false;
      return;
    }
    // `scoring` comes from a SEPARATE async query and can be null on the first
    // render after opening. Seeding then would leave editScoring/editCategories
    // empty and never re-sync (dep is `[visible, scoring]`), and Save would run
    // replace_scoring_settings with an empty row set — wiping every scoring
    // setting the league configured in the wizard. Wait for it to resolve.
    if (hydrated.current || !scoring) return;
    hydrated.current = true;

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
      // Seed from the LEAGUE'S sport sheet, not the NBA one — see the `sport`
      // prop doc. Any stat the league already scores that isn't in the sheet
      // is preserved rather than dropped on save.
      const merged = defaultScoring.map((d) => {
        const existing = scoring.find((s) => s.stat_name === d.stat_name);
        return { stat_name: d.stat_name, point_value: existing?.point_value ?? d.point_value };
      });
      const extras = scoring
        .filter((s) => !defaultScoring.some((d) => d.stat_name === s.stat_name))
        .map((s) => ({ stat_name: s.stat_name, point_value: s.point_value }));
      setEditScoring([...merged, ...extras]);
    }
  }, [visible, scoring]);

  async function handleSave() {
    // Never persist un-hydrated state: without the source rows an empty save
    // would blow away the league's scoring via replace_scoring_settings.
    if (!scoring) return;
    setSaving(true);

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

    // One transaction. As a delete followed by an insert, a failed insert left
    // the league with NO scoring settings — every matchup unscoreable — until
    // the commissioner happened to save again.
    const { error } = await supabase.rpc('replace_scoring_settings', {
      p_league_id: leagueId,
      p_rows: rows as unknown as Json,
    });
    if (error) { setSaving(false); Alert.alert('Error', error.message); return; }
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
                {statLabel(cat.stat_name, defaultScoring)}
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
              thumbColor={Platform.OS === 'android' ? '#FFFFFF' : undefined}
              ios_backgroundColor={c.border}
              accessibilityLabel={`${statLabel(cat.stat_name, defaultScoring)}, ${cat.is_enabled ? 'enabled' : 'disabled'}`}
              accessibilityState={{ checked: cat.is_enabled }}
            />
          </View>
        ))
      ) : (
        <>
          {editScoring.map((row, idx) => (
            <NumberStepper
              key={row.stat_name}
              label={statLabel(row.stat_name, defaultScoring)}
              value={row.point_value}
              onValueChange={(v) => {
                const next = [...editScoring];
                next[idx] = { ...row, point_value: v };
                setEditScoring(next);
              }}
              min={-10}
              max={10}
              // Fractional stats (NFL yardage: 0.04/yd passing) need a 0.01 step —
              // a 0.5 step can't express them. See scoringStep.
              step={scoringStep(
                defaultScoring.find((d) => d.stat_name === row.stat_name)?.point_value ?? 1,
              )}
              // DST_PA's number is a multiplier on the tier table below, not a
              // points-per-occurrence rate like every other row — the "×"
              // marks that distinction at a glance. Matches StepScoring.
              suffix={row.stat_name === 'DST_PA' ? '×' : undefined}
            />
          ))}

          {sport === 'nfl' && (
            <View style={styles.tierNote}>
              <ThemedText style={[styles.description, { color: c.secondaryText }]}>
                <ThemedText style={[styles.tierNoteLead, { color: c.text }]}>
                  How Points Allowed Tier works:{' '}
                </ThemedText>
                Unlike the stats above, D/ST doesn't score at a flat rate — it
                scores from the tier table below, based on total points the
                defense allows in the game. The number in "Points Allowed Tier"
                is a multiplier on that table: 1× applies the standard tiers
                shown, 2× doubles them, 0× turns the bonus off.
              </ThemedText>
              <View style={styles.tierGrid}>
                {DST_PA_TIERS.map((t) => (
                  <View
                    key={t.label}
                    style={[styles.tierChip, { borderColor: c.border }]}
                    accessible
                    accessibilityLabel={`Allowing ${t.label} points scores ${t.pts} fantasy points`}
                  >
                    <ThemedText style={[styles.tierChipRange, { color: c.secondaryText }]}>
                      {t.label}
                    </ThemedText>
                    <ThemedText
                      style={[
                        styles.tierChipPts,
                        { color: t.pts > 0 ? c.success : t.pts < 0 ? c.danger : c.secondaryText },
                      ]}
                    >
                      {t.pts > 0 ? `+${t.pts}` : t.pts}
                    </ThemedText>
                  </View>
                ))}
              </View>
            </View>
          )}
        </>
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
  description: {
    fontSize: ms(13),
    lineHeight: ms(18),
  },
  tierNote: {
    gap: s(8),
    paddingTop: s(12),
  },
  tierNoteLead: {
    fontSize: ms(13),
    lineHeight: ms(18),
    fontWeight: '700',
  },
  tierGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(6),
  },
  tierChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(5),
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: s(4),
    paddingHorizontal: s(8),
  },
  tierChipRange: {
    fontFamily: Fonts.mono,
    fontSize: ms(11),
  },
  tierChipPts: {
    fontFamily: Fonts.mono,
    fontSize: ms(11),
    fontWeight: '700',
  },
});
