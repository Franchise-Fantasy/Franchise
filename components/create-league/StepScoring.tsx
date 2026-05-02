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

interface StepScoringProps {
  state: LeagueWizardState;
  onScoringChange: (index: number, value: number) => void;
  onResetScoring: () => void;
  onScoringTypeChange: (type: ScoringTypeOption) => void;
  onCategoryToggle: (index: number, enabled: boolean) => void;
  onResetCategories: () => void;
}

export function StepScoring({
  state,
  onScoringChange,
  onResetScoring,
  onScoringTypeChange,
  onCategoryToggle,
  onResetCategories,
}: StepScoringProps) {
  const c = useColors();
  const isCategories = state.scoringType === 'H2H Categories';
  const enabledCount = state.categories.filter((cat) => cat.is_enabled).length;

  return (
    <View style={styles.container}>
      <FormSection title="Scoring Type">
        <SegmentedControl
          options={SCORING_TYPE_OPTIONS}
          selectedIndex={SCORING_TYPE_OPTIONS.indexOf(state.scoringType)}
          onSelect={(i) => onScoringTypeChange(SCORING_TYPE_OPTIONS[i])}
        />

        <ThemedText style={[styles.description, { color: c.secondaryText }]}>
          {isCategories
            ? 'Each stat is a category. Win the majority of categories to win the week.'
            : 'Adjust point values for each stat category.'}
        </ThemedText>
      </FormSection>

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
              label={`${cat.stat_name} - ${cat.label}`}
              value={cat.point_value}
              onValueChange={(v) => onScoringChange(index, v)}
              min={-10}
              max={10}
              step={0.5}
              last={index === state.scoring.length - 1}
            />
          ))}

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
});
