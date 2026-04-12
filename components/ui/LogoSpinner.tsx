import { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';

interface LogoSpinnerProps {
  size?: number;
  /**
   * Delay in ms before the spinner becomes visible. Prevents flashing when
   * content loads quickly. Pass 0 to show immediately.
   */
  delay?: number;
}

const LOGO = require('@/assets/images/icon.png');

export function LogoSpinner({ size = 40, delay = 400 }: LogoSpinnerProps) {
  const opacity = useRef(new Animated.Value(0.35)).current;
  const [visible, setVisible] = useState(delay <= 0);

  useEffect(() => {
    if (delay <= 0) return;
    const t = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  useEffect(() => {
    if (!visible) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [visible]);

  return (
    <View
      style={[styles.wrapper, { width: size, height: size }]}
      accessibilityLabel="Loading"
      accessibilityRole="progressbar"
    >
      {visible && (
        <Animated.View style={{ opacity }}>
          <Image
            source={LOGO}
            style={{ width: size, height: size, borderRadius: size / 2 }}
          />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
