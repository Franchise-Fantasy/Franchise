import { ThemedText } from '@/components/ThemedText';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { Colors } from '@/constants/Colors';
import { LeagueWizardState } from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

interface StepScoringProps {
  state: LeagueWizardState;
  onScoringChange: (index: number, value: number) => void;
  onResetScoring: () => void;
}

export function StepScoring({ state, onScoringChange, onResetScoring }: StepScoringProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <View style={styles.container}>
      <ThemedText accessibilityRole="header" type="subtitle" style={styles.heading}>Scoring Settings</ThemedText>
      <ThemedText style={[styles.description, { color: c.secondaryText }]}>
        Adjust point values for each stat category.
      </ThemedText>

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

      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Reset scoring to defaults" onPress={onResetScoring} style={styles.resetBtn}>
        <ThemedText style={{ color: c.accent }}>Reset to Defaults</ThemedText>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  heading: {
    marginBottom: 4,
  },
  description: {
    fontSize: 14,
    marginBottom: 12,
  },
  resetBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },
});
