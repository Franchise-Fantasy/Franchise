import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

const STEP_WIDTH = 100;
const CIRCLE_SIZE = 32;
const CIRCLE_SIZE_ACTIVE = 38;
const CIRCLE_ROW_HEIGHT = CIRCLE_SIZE_ACTIVE;
const VISIBLE_STEPS = 3;
const WINDOW_WIDTH = STEP_WIDTH * VISIBLE_STEPS;

interface StepIndicatorProps {
  currentStep: number;
  steps: string[];
}

function getOffset(step: number) {
  // Center the given step index in the visible window.
  return WINDOW_WIDTH / 2 - STEP_WIDTH / 2 - step * STEP_WIDTH;
}

export function StepIndicator({ currentStep, steps }: StepIndicatorProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const translateX = useRef(new Animated.Value(getOffset(0))).current;

  useEffect(() => {
    Animated.spring(translateX, {
      toValue: getOffset(currentStep),
      useNativeDriver: true,
      tension: 60,
      friction: 12,
    }).start();
  }, [currentStep]);

  const stripWidth = steps.length * STEP_WIDTH;

  return (
    <View style={styles.container}>
      <View style={styles.window}>
        <Animated.View
          style={[
            styles.strip,
            {
              width: stripWidth,
              transform: [{ translateX }],
            },
          ]}
        >
          {steps.map((label, index) => {
            const isActive = index === currentStep;
            const isCompleted = index < currentStep;
            const size = isActive ? CIRCLE_SIZE_ACTIVE : CIRCLE_SIZE;

            return (
              <View key={label} style={[styles.stepWrapper, { width: STEP_WIDTH }]}>
                {/* Fixed-height row keeps all circles vertically aligned */}
                <View style={styles.circleRow}>
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
                        width: size,
                        height: size,
                        borderRadius: size / 2,
                        backgroundColor:
                          isActive || isCompleted ? c.accent : c.background,
                        borderColor:
                          isActive || isCompleted ? c.accent : c.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.circleText,
                        {
                          fontSize: isActive ? 15 : 13,
                          color:
                            isActive || isCompleted
                              ? c.accentText
                              : c.secondaryText,
                        },
                      ]}
                    >
                      {isCompleted ? '\u2713' : index + 1}
                    </Text>
                  </View>
                </View>
                <Text
                  style={[
                    styles.label,
                    {
                      color: isActive ? c.text : c.secondaryText,
                      fontWeight: isActive ? '700' : '400',
                      fontSize: isActive ? 12 : 11,
                    },
                  ]}
                  numberOfLines={1}
                >
                  {label}
                </Text>
              </View>
            );
          })}
        </Animated.View>
      </View>

      <Text style={[styles.counter, { color: c.secondaryText }]}>
        {currentStep + 1} of {steps.length}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  window: {
    width: WINDOW_WIDTH,
    overflow: 'hidden',
  },
  strip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  stepWrapper: {
    alignItems: 'center',
  },
  circleRow: {
    width: '100%',
    height: CIRCLE_ROW_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  line: {
    position: 'absolute',
    top: CIRCLE_ROW_HEIGHT / 2 - 1,
    height: 2,
    right: '50%',
    left: '-50%',
    zIndex: 0,
  },
  circle: {
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  circleText: {
    fontWeight: '700',
  },
  label: {
    marginTop: 6,
    textAlign: 'center',
  },
  counter: {
    marginTop: 8,
    fontSize: 12,
  },
});
