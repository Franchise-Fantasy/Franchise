import { pStyles } from '@/components/matchup/PlayerCell';
import { useEffect, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  View,
} from 'react-native';

// ─── Skeleton primitives ─────────────────────────────────────────────────────

const SKELETON_SLOTS = 8;

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

// ─── MatchupSkeleton ─────────────────────────────────────────────────────────

export function MatchupSkeleton({ c }: { c: any }) {
  const blockColor = c.border;

  return (
    <View style={skeletonStyles.body} accessibilityLabel="Loading matchup">
      {/* Score header skeleton */}
      <View style={skeletonStyles.scoreHeader}>
        <View style={[skeletonStyles.scoreCol, { alignItems: 'flex-start' }]}>
          <SkeletonBlock width={100} height={14} color={blockColor} />
          <SkeletonBlock width={60} height={20} color={blockColor} style={{ marginTop: 2 }} />
          <SkeletonBlock width={50} height={11} color={blockColor} style={{ marginTop: 2 }} />
        </View>
        <Text style={[skeletonStyles.vsText, { color: c.secondaryText }]}>vs</Text>
        <View style={[skeletonStyles.scoreCol, { alignItems: 'flex-end' }]}>
          <SkeletonBlock width={100} height={14} color={blockColor} />
          <SkeletonBlock width={60} height={20} color={blockColor} style={{ marginTop: 2 }} />
          <SkeletonBlock width={50} height={11} color={blockColor} style={{ marginTop: 2 }} />
        </View>
      </View>

      {/* Slot rows skeleton */}
      {Array.from({ length: SKELETON_SLOTS }).map((_, i) => (
        <View key={i} style={[pStyles.slotRow, { borderBottomColor: c.border }]}>
          {/* Left player cell */}
          <View style={[pStyles.cell, { alignItems: 'flex-start' }]}>
            <SkeletonBlock width={80} height={12} color={blockColor} />
            <SkeletonBlock width={40} height={10} color={blockColor} style={{ marginTop: 3 }} />
            <SkeletonBlock width={28} height={13} color={blockColor} style={{ marginTop: 3 }} />
          </View>
          {/* Center slot label */}
          <View style={pStyles.slotCenter}>
            <SkeletonBlock width={24} height={10} color={blockColor} />
          </View>
          {/* Right player cell */}
          <View style={[pStyles.cell, { alignItems: 'flex-end' }]}>
            <SkeletonBlock width={80} height={12} color={blockColor} />
            <SkeletonBlock width={40} height={10} color={blockColor} style={{ marginTop: 3 }} />
            <SkeletonBlock width={28} height={13} color={blockColor} style={{ marginTop: 3 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const skeletonStyles = StyleSheet.create({
  body: { flexGrow: 1 },
  scoreHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  scoreCol: { flex: 1 },
  vsText: { fontSize: 12, fontWeight: '600', marginHorizontal: 10 },
});
