import { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  type StyleProp,
  type TextStyle,
  View,
} from "react-native";

import { formatScore } from "@/utils/scoring/fantasyPoints";

interface AnimatedFptsProps {
  value: number | null;
  accentColor: string;
  dimColor: string;
  textStyle: StyleProp<TextStyle>;
  animate?: boolean;
  projected?: boolean;
}

/** FPTS number that pops (translateY 14 → 0) when its value changes. */
export function AnimatedFpts({
  value,
  accentColor,
  dimColor,
  textStyle,
  animate = false,
  projected = false,
}: AnimatedFptsProps) {
  const translateY = useRef(new Animated.Value(0)).current;
  const prev = useRef<number | null | undefined>(undefined);
  const wasAnimating = useRef(false);

  useEffect(() => {
    if (
      animate &&
      wasAnimating.current &&
      prev.current !== undefined &&
      value !== prev.current
    ) {
      const goingUp = (value ?? 0) > (prev.current ?? 0);
      translateY.setValue(goingUp ? 14 : -14);
      Animated.timing(translateY, {
        toValue: 0,
        duration: 500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
    prev.current = value;
    wasAnimating.current = animate;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, animate]);

  return (
    <View style={{ overflow: "hidden", height: 18, justifyContent: "center" }}>
      <Animated.Text
        style={[
          textStyle,
          {
            transform: [{ translateY }],
            color: value !== null ? accentColor : dimColor,
          },
        ]}
      >
        {value !== null
          ? projected
            ? value.toFixed(1)
            : formatScore(value)
          : "—"}
      </Animated.Text>
    </View>
  );
}
