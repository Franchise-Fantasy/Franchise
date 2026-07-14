import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { BrandButton } from '@/components/ui/BrandButton';
import { FormSection } from '@/components/ui/FormSection';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Fonts } from '@/constants/Colors';
import { LeagueWizardState, SCORING_TYPE_OPTIONS, ScoringTypeOption } from '@/constants/LeagueDefaults';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';
import { DST_PA_TIERS } from '@/utils/scoring/nflStatLine';
import { getSportModule, scoringStep } from '@/utils/sports/registry';

interface StepScoringProps {
  state: LeagueWizardState;
  onScoringChange: (index: number, value: number) => void;
  onResetScoring: () => void;
  onScoringTypeChange: (type: ScoringTypeOption) => void;
  onCategoryToggle: (index: number, enabled: boolean) => void;
  onResetCategories: () => void;
  /** Applies a named registry preset (NFL Standard / Half PPR / Full PPR). */
  onScoringPreset?: (key: string) => void;
}

// NFL preset picker labels ↔ registry scoringPresets keys.
const NFL_PRESETS: { label: string; key: string }[] = [
  { label: 'Standard', key: 'standard' },
  { label: 'Half PPR', key: 'half_ppr' },
  { label: 'Full PPR', key: 'full_ppr' },
];

export function StepScoring({
  state,
  onScoringChange,
  onResetScoring,
  onScoringTypeChange,
  onCategoryToggle,
  onResetCategories,
  onScoringPreset,
}: StepScoringProps) {
  const c = useColors();
  // Categories are basketball-only — NFL leagues are points-only, so the
  // scoring-type picker is replaced by the PPR preset picker.
  const sportModule = getSportModule(state.sport);
  const supportsCategories = sportModule.supportsCategories;
  const sportDefaults = sportModule.defaultScoring;
  const isCategories = supportsCategories && state.scoringType === 'H2H Categories';
  const enabledCount = state.categories.filter((cat) => cat.is_enabled).length;
  // Active preset derived from the REC weight (0 / 0.5 / 1); a hand-edited
  // sheet matches none and renders with no segment selected.
  const recValue = state.scoring.find((s) => s.stat_name === 'REC')?.point_value;
  const activePresetIdx = NFL_PRESETS.findIndex(
    (p) => (p.key === 'standard' ? 0 : p.key === 'half_ppr' ? 0.5 : 1) === recValue,
  );

  return (
    <View style={styles.container}>
      {supportsCategories ? (
        <FormSection title="Scoring Type">
          <SegmentedControl
            options={SCORING_TYPE_OPTIONS}
            selectedIndex={SCORING_TYPE_OPTIONS.indexOf(state.scoringType)}
            onSelect={(i) => onScoringTypeChange(SCORING_TYPE_OPTIONS[i])}
            accessibilityLabel="Scoring type"
          />

          <ThemedText style={[styles.description, { color: c.secondaryText }]}>
            {isCategories
              ? 'Each stat is a category. Win the majority of categories to win the week.'
              : 'Adjust point values for each stat category.'}
          </ThemedText>
        </FormSection>
      ) : (
        <FormSection title="Scoring Preset">
          <SegmentedControl
            options={NFL_PRESETS.map((p) => p.label)}
            selectedIndex={activePresetIdx}
            onSelect={(i) => onScoringPreset?.(NFL_PRESETS[i].key)}
            accessibilityLabel="Scoring preset"
          />
          <ThemedText style={[styles.description, { color: c.secondaryText }]}>
            {activePresetIdx === -1
              ? 'Custom point values — selecting a preset resets every value below to that preset.'
              : 'Points per reception: Standard 0 · Half 0.5 · Full 1. Every value below stays editable.'}
          </ThemedText>
        </FormSection>
      )}

      {isCategories ? (
        <FormSection title="Categories">
          <ThemedText style={[styles.categoryCount, { color: c.secondaryText }]}>
            {enabledCount} {enabledCount === 1 ? 'category' : 'categories'} active · tap to toggle · {' '}
            <ThemedText type="mono" style={styles.inverseMark}>▾</ThemedText>
            {' '}= lower wins
          </ThemedText>

          {/* Chip grid — each category is a tappable pill. Active chips
              fill with turfGreen + ecru text (scoreboard-on feel);
              inactive chips are outlined. Dense layout fixes the
              previous "big empty list of switches" look. */}
          <View style={styles.categoryGrid}>
            {state.categories.map((cat, index) => {
              const active = cat.is_enabled;
              return (
                <TouchableOpacity
                  key={cat.stat_name}
                  onPress={() => onCategoryToggle(index, !active)}
                  activeOpacity={0.75}
                  style={[
                    styles.categoryChip,
                    {
                      backgroundColor: active ? c.primary : 'transparent',
                      borderColor: active ? c.primary : c.border,
                    },
                  ]}
                  accessibilityRole="switch"
                  accessibilityLabel={`${cat.label}${cat.inverse ? ', lower wins' : ''}`}
                  accessibilityState={{ checked: active }}
                >
                  <ThemedText
                    style={[
                      styles.categoryChipText,
                      { color: active ? Brand.ecru : c.text },
                    ]}
                  >
                    {cat.stat_name}
                    {cat.inverse ? (
                      <ThemedText style={{ color: active ? Brand.ecru : c.secondaryText }}>
                        {' '}▾
                      </ThemedText>
                    ) : null}
                  </ThemedText>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.resetWrap}>
            <BrandButton
              label="Reset to Standard 9-Cat"
              variant="ghost"
              size="small"
              onPress={onResetCategories}
              accessibilityLabel="Reset to standard 9-cat"
            />
          </View>
        </FormSection>
      ) : (
        <FormSection title="Point Values">
          {state.scoring.map((cat, index) => (
            <NumberStepper
              key={cat.stat_name}
              // Friendly label only — the raw stat key ("PASS_YD") is an
              // implementation detail. Matches EditScoringModal's statLabel().
              label={cat.label}
              value={cat.point_value}
              onValueChange={(v) => onScoringChange(index, v)}
              min={-100}
              max={100}
              // NFL yardage is fractional (0.04/passing yd) — a 0.5 step can't
              // express it. Step off the sport's default for this stat.
              step={scoringStep(
                sportDefaults.find((d) => d.stat_name === cat.stat_name)?.point_value ?? 1,
              )}
              last={index === state.scoring.length - 1}
            />
          ))}

          {state.sport === 'nfl' && (
            <View style={styles.tierNote}>
              <ThemedText style={[styles.description, { color: c.secondaryText }]}>
                <ThemedText style={[styles.tierNoteLead, { color: c.text }]}>
                  How Points Allowed Tier works:{' '}
                </ThemedText>
                a defense earns points based on how few points it gives up in the
                game — not per point allowed. Keep the value at 1 to use these
                standard tiers, 0 to turn the bonus off, or raise it to amplify them.
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

          <View style={styles.resetWrap}>
            <BrandButton
              label="Reset to Defaults"
              variant="ghost"
              size="small"
              onPress={onResetScoring}
              accessibilityLabel="Reset scoring to defaults"
            />
          </View>
        </FormSection>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  description: {
    fontSize: ms(13),
    lineHeight: ms(18),
  },
  categoryCount: {
    fontSize: ms(12),
    lineHeight: ms(17),
  },
  inverseMark: {
    fontFamily: Fonts.mono,
    fontSize: ms(11),
  },
  // Chip grid wraps; each chip sized to its stat-name content.
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(8),
  },
  categoryChip: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: s(7),
    paddingHorizontal: s(12),
  },
  categoryChipText: {
    fontFamily: Fonts.mono,
    fontSize: ms(12),
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  // No vertical padding/margin — FormSection's gap handles the
  // spacing above, and the ghost button brings its own touch target.
  resetWrap: {
    alignItems: 'center',
  },
  tierNote: {
    gap: s(8),
  },
  tierNoteLead: {
    fontSize: ms(13),
    lineHeight: ms(18),
    fontWeight: '700',
  },
  // Range → points chips, so the bracket reads as a table rather than a
  // run-on sentence of arrows.
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
