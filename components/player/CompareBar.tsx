import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { BottomTabBarHeightContext } from 'expo-router/js-tabs';
import { useContext } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PlayerHeadshotImage } from '@/components/player/PlayerHeadshotImage';
import { ThemedText } from '@/components/ui/ThemedText';
import { useCompareSelection } from '@/context/CompareSelectionProvider';
import { useActiveLeagueSport } from '@/hooks/useActiveLeagueSport';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

/**
 * Sticky footer shown while compare mode is active. Renders the picked players
 * as removable mini-headshots and a "Compare (N)" CTA that opens the
 * full-screen comparison. Self-contained — each entry screen just drops one
 * `<CompareBar />` inside its container; it anchors to the container's bottom.
 *
 * Pass `docked` when rendering inside a chrome that already provides the bottom
 * positioning + border (e.g. a BottomSheet `footer`); it then renders inline
 * instead of absolutely pinned.
 */
export function CompareBar({ docked = false }: { docked?: boolean } = {}) {
  const { isCompareMode, selected, remove, setCompareMode, min } = useCompareSelection();
  const c = useColors();
  const sport = useActiveLeagueSport();
  const router = useRouter();
  // Sit above the (absolute, on iOS) tab bar so the CTA isn't hidden behind it.
  // Falls back to the safe-area inset when rendered outside a tab navigator.
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? 0;
  const insets = useSafeAreaInsets();
  const bottomOffset = tabBarHeight || insets.bottom;

  if (!isCompareMode) return null;

  const canCompare = selected.length >= min;
  const hint =
    selected.length === 0
      ? 'Select players to compare'
      : selected.length === 1
        ? 'Select 1 more'
        : null;

  return (
    <View
      style={
        docked
          ? styles.barDocked
          : [styles.bar, { bottom: bottomOffset, backgroundColor: c.card, borderTopColor: c.border }]
      }
      accessibilityLabel="Compare selection"
    >
      <TouchableOpacity
        onPress={() => setCompareMode(false)}
        style={styles.exit}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Exit compare mode"
      >
        <Ionicons name="close" size={ms(20)} color={c.secondaryText} />
      </TouchableOpacity>

      {hint ? (
        <View style={styles.hintWrap}>
          <ThemedText style={[styles.hint, { color: c.secondaryText }]}>{hint}</ThemedText>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          style={styles.chipsScroll}
        >
          {selected.map((p) => (
            <TouchableOpacity
              key={p.player_id}
              onPress={() => remove(p.player_id)}
              style={styles.chip}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${p.name} from comparison`}
            >
              <View style={[styles.chipCircle, { borderColor: c.heritageGold, backgroundColor: c.cardAlt }]}>
                <PlayerHeadshotImage
                  externalIdNba={p.external_id_nba}
                  sport={sport}
                  style={styles.chipImg}
                  accessible={false}
                />
              </View>
              <View style={[styles.chipRemove, { backgroundColor: c.card }]}>
                <Ionicons name="close-circle" size={ms(15)} color={c.secondaryText} />
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <TouchableOpacity
        onPress={() => canCompare && router.push('/player-compare' as any)}
        disabled={!canCompare}
        style={[
          styles.cta,
          { backgroundColor: canCompare ? c.gold : c.buttonDisabled },
        ]}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canCompare }}
        accessibilityLabel={`Compare ${selected.length} players`}
      >
        <Ionicons name="git-compare" size={ms(16)} color={c.statusText} />
        <ThemedText type="varsitySmall" style={[styles.ctaText, { color: c.statusText }]}>
          {`Compare (${selected.length})`}
        </ThemedText>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    paddingHorizontal: s(12),
    paddingVertical: s(8),
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  // Inline variant for hosts that own the bottom chrome (e.g. BottomSheet footer).
  barDocked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  exit: {
    width: s(28),
    height: s(28),
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintWrap: { flex: 1 },
  hint: { fontSize: ms(13) },
  chipsScroll: { flex: 1 },
  chips: { alignItems: 'center', gap: s(8), paddingRight: s(4) },
  chip: { width: s(40), height: s(40) },
  chipCircle: {
    width: s(40),
    height: s(40),
    borderRadius: s(20),
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  chipImg: {
    position: 'absolute',
    bottom: s(-2),
    left: 0,
    right: 0,
    height: s(34),
  },
  chipRemove: {
    position: 'absolute',
    top: s(-4),
    right: s(-4),
    borderRadius: s(10),
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    paddingHorizontal: s(14),
    paddingVertical: s(10),
    borderRadius: s(10),
  },
  ctaText: { fontSize: ms(11), letterSpacing: 1.0 },
});
