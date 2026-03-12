import { ThemedText } from '@/components/ThemedText';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Colors } from '@/constants/Colors';
import { LeagueWizardState, SCORING_TYPE_OPTIONS, ScoringTypeOption } from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';
import { StyleSheet, Switch, TouchableOpacity, View } from 'react-native';

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
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const isCategories = state.scoringType === 'H2H Categories';
  const enabledCount = state.categories.filter((cat) => cat.is_enabled).length;

  return (
    <View style={styles.container}>
      <ThemedText accessibilityRole="header" type="subtitle" style={styles.heading}>
        Scoring Settings
      </ThemedText>

      <SegmentedControl
        options={SCORING_TYPE_OPTIONS}
        selectedIndex={SCORING_TYPE_OPTIONS.indexOf(state.scoringType)}
        onSelect={(i) => onScoringTypeChange(SCORING_TYPE_OPTIONS[i])}
      />

      <ThemedText style={[styles.description, { color: c.secondaryText, marginTop: 12 }]}>
        {isCategories
          ? 'Each stat is a category. Win the majority of categories to win the week.'
          : 'Adjust point values for each stat category.'}
      </ThemedText>

      {isCategories ? (
        <>
          <ThemedText style={[styles.categoryCount, { color: c.secondaryText }]}>
            {enabledCount} {enabledCount === 1 ? 'category' : 'categories'} active
          </ThemedText>

          {state.categories.map((cat, index) => (
            <View
              key={cat.stat_name}
              style={[styles.categoryRow, { borderBottomColor: c.border }]}
            >
              <View style={styles.categoryLeft}>
                <ThemedText style={styles.categoryLabel}>
                  {cat.stat_name}
                </ThemedText>
                <ThemedText style={[styles.categorySublabel, { color: c.secondaryText }]}>
                  {cat.label}
                  {cat.inverse ? ' (lower wins)' : ''}
                </ThemedText>
              </View>
              <Switch
                value={cat.is_enabled}
                onValueChange={(v) => onCategoryToggle(index, v)}
                trackColor={{ false: c.border, true: c.accent }}
                accessibilityLabel={`${cat.label}, ${cat.is_enabled ? 'enabled' : 'disabled'}`}
                accessibilityState={{ checked: cat.is_enabled }}
              />
            </View>
          ))}

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Reset to standard 9-cat"
            onPress={onResetCategories}
            style={styles.resetBtn}
          >
            <ThemedText style={{ color: c.accent }}>Reset to Standard 9-Cat</ThemedText>
          </TouchableOpacity>
        </>
      ) : (
        <>
          {state.scoring.map((cat, index) => (
            <NumberStepper
              key={cat.stat_name}
              label={`${cat.stat_name} - ${cat.label}`}
              value={cat.point_value}
              onValueChange={(v) => onScoringChange(index, v)}
              min={-10}
              max={10}
              step={0.5}
            />
          ))}

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Reset scoring to defaults"
            onPress={onResetScoring}
            style={styles.resetBtn}
          >
            <ThemedText style={{ color: c.accent }}>Reset to Defaults</ThemedText>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  heading: {
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    marginBottom: 12,
  },
  categoryCount: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  categoryLeft: {
    flex: 1,
    marginRight: 12,
  },
  categoryLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  categorySublabel: {
    fontSize: 12,
    marginTop: 1,
  },
  resetBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },
});
