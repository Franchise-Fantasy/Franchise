import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';

interface Props {
  options: string[];
  value: number[] | null;
  onChange: (val: number[]) => void;
}

/**
 * Ranked choice input using up/down arrow buttons.
 * `value` is an array of option indices in ranked order (first = highest rank).
 */
export function RankedChoiceInput({ options, value, onChange }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  // Initialize with default order if no value set
  const ranking = value ?? options.map((_, i) => i);

  useEffect(() => {
    if (!value && options.length > 0) {
      onChange(options.map((_, i) => i));
    }
  }, [options.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function moveUp(pos: number) {
    if (pos <= 0) return;
    const next = [...ranking];
    [next[pos - 1], next[pos]] = [next[pos], next[pos - 1]];
    onChange(next);
  }

  function moveDown(pos: number) {
    if (pos >= ranking.length - 1) return;
    const next = [...ranking];
    [next[pos], next[pos + 1]] = [next[pos + 1], next[pos]];
    onChange(next);
  }

  return (
    <View style={styles.container} accessibilityLabel="Drag to reorder items by preference">
      {ranking.map((optIdx, pos) => (
        <View
          key={optIdx}
          style={[styles.row, { backgroundColor: c.cardAlt, borderColor: c.border }]}
          accessibilityLabel={`Rank ${pos + 1}: ${options[optIdx]}`}
        >
          {/* Rank number */}
          <View style={[styles.rankBadge, { backgroundColor: c.accent }]}>
            <ThemedText style={[styles.rankText, { color: c.statusText }]}>{pos + 1}</ThemedText>
          </View>

          {/* Option text */}
          <ThemedText style={[styles.optionText, { color: c.text }]} numberOfLines={2}>
            {options[optIdx]}
          </ThemedText>

          {/* Up/down controls */}
          <View style={styles.arrows}>
            <TouchableOpacity
              onPress={() => moveUp(pos)}
              disabled={pos === 0}
              accessibilityRole="button"
              accessibilityLabel={`Move ${options[optIdx]} up`}
              accessibilityState={{ disabled: pos === 0 }}
              hitSlop={8}
            >
              <Ionicons
                name="chevron-up"
                size={20}
                color={pos === 0 ? c.border : c.text}
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => moveDown(pos)}
              disabled={pos === ranking.length - 1}
              accessibilityRole="button"
              accessibilityLabel={`Move ${options[optIdx]} down`}
              accessibilityState={{ disabled: pos === ranking.length - 1 }}
              hitSlop={8}
            >
              <Ionicons
                name="chevron-down"
                size={20}
                color={pos === ranking.length - 1 ? c.border : c.text}
              />
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: s(6) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    padding: s(10),
    gap: s(10),
  },
  rankBadge: {
    width: s(26),
    height: s(26),
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: {
    fontSize: ms(13),
    fontWeight: '700',
  },
  optionText: {
    fontSize: ms(14),
    flex: 1,
  },
  arrows: {
    alignItems: 'center',
    gap: s(2),
  },
});
