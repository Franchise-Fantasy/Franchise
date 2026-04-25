import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';

interface StepIndicatorProps {
  currentStep: number;
  steps: string[];
}

/**
 * Compact wizard progress — varsity-caps label on the left names the
 * current step (so the step title is never repeated in the page body),
 * a pip row on the right visualizes progress (filled pips for
 * completed + current, hollow for upcoming). Same design language as
 * HomeHero's offseason pip stepper so the app's progress indicators
 * share a visual vocabulary.
 *
 * Intentionally drops the carousel + "X of N" counter — the filled
 * pips already convey position and the label names the active step.
 */
export function StepIndicator({ currentStep, steps }: StepIndicatorProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <View style={styles.row}>
      <ThemedText
        type="varsity"
        style={[styles.label, { color: c.text }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {steps[currentStep]}
      </ThemedText>

      <View style={styles.pips}>
        {steps.map((_, i) => {
          const isFilled = i <= currentStep;
          return (
            <View
              key={i}
              style={[
                styles.pip,
                {
                  backgroundColor: isFilled ? Brand.vintageGold : 'transparent',
                  borderColor: isFilled ? Brand.vintageGold : c.border,
                },
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: s(10),
    // Extra bottom space so the first FormSection of each step doesn't
    // hug the indicator — gives the page a breath before content.
    paddingBottom: s(20),
    gap: s(16),
  },
  // Label leans bigger than the pips so the current step name is the
  // clear anchor of the header.
  label: {
    flex: 1,
    fontSize: ms(17),
    letterSpacing: 1.4,
  },
  pips: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(5),
  },
  pip: {
    width: s(8),
    height: s(8),
    borderRadius: s(4),
    borderWidth: 1,
  },
});
