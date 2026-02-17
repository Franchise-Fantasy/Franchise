import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { StyleSheet, Text, View } from 'react-native';

interface StepIndicatorProps {
  currentStep: number;
  steps: string[];
}

export function StepIndicator({ currentStep, steps }: StepIndicatorProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {steps.map((label, index) => {
          const isActive = index === currentStep;
          const isCompleted = index < currentStep;

          return (
            <View key={label} style={styles.stepWrapper}>
              {index > 0 && (
                <View
                  style={[
                    styles.line,
                    { backgroundColor: isCompleted ? c.accent : c.border },
                  ]}
                />
              )}
              <View
                style={[
                  styles.circle,
                  {
                    backgroundColor: isActive || isCompleted ? c.accent : 'transparent',
                    borderColor: isActive || isCompleted ? c.accent : c.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.circleText,
                    {
                      color: isActive || isCompleted ? c.accentText : c.secondaryText,
                    },
                  ]}
                >
                  {isCompleted ? '\u2713' : index + 1}
                </Text>
              </View>
              <Text
                style={[
                  styles.label,
                  {
                    color: isActive ? c.text : c.secondaryText,
                    fontWeight: isActive ? '600' : '400',
                  },
                ]}
              >
                {label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  stepWrapper: {
    alignItems: 'center',
    flex: 1,
    position: 'relative',
  },
  line: {
    position: 'absolute',
    top: 14,
    right: '50%',
    left: '-50%',
    height: 2,
    zIndex: -1,
  },
  circle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleText: {
    fontSize: 13,
    fontWeight: '700',
  },
  label: {
    fontSize: 11,
    marginTop: 4,
    textAlign: 'center',
  },
});
