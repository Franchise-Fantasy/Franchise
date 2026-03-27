import { useEffect, useRef } from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';

interface LogoSpinnerProps {
  size?: number;
}

const LOGO = require('@/assets/images/icon.png');

export function LogoSpinner({ size = 56 }: LogoSpinnerProps) {
  const opacity = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <View
      style={[styles.wrapper, { width: size, height: size }]}
      accessibilityLabel="Loading"
      accessibilityRole="progressbar"
    >
      <Animated.View style={{ opacity }}>
        <Image
          source={LOGO}
          style={{ width: size, height: size, borderRadius: size / 2 }}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
