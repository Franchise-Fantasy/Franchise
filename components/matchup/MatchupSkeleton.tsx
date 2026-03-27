import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';

// ─── Skeleton primitives ─────────────────────────────────────────────────────

export function SkeletonBlock({ width, height, color, style }: { width: number | string; height: number; color: string; style?: any }) {
  const opacity = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return <Animated.View style={[{ width: width as any, height, borderRadius: 4, backgroundColor: color, opacity }, style]} />;
}
