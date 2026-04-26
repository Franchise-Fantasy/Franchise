import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import type { ReadReceipt } from '@/hooks/chat/useReadReceipts';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

interface Props {
  /** DM = single "Seen", group = tricode badges */
  isDM: boolean;
  /** Other members whose last_read_message_id matches this message */
  readers: ReadReceipt[];
}

export function ReadReceiptIndicator({ isDM, readers }: Props) {
  const c = useColors();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [opacity]);

  if (readers.length === 0) return null;

  if (isDM) {
    return (
      <Animated.View style={[styles.container, styles.dmContainer, { opacity }]}>
        <ThemedText
          style={[styles.seenText, { color: c.secondaryText }]}
          accessibilityLabel="Message seen"
        >
          SEEN
        </ThemedText>
      </Animated.View>
    );
  }

  // Group chat: show tricode badges
  return (
    <Animated.View style={[styles.container, styles.groupContainer, { opacity }]}>
      {readers.map((r) => (
        <View
          key={r.team_id}
          style={[styles.tricodeBadge, { backgroundColor: c.cardAlt }]}
          accessibilityLabel={`Read by ${r.team_name}`}
        >
          <ThemedText style={[styles.tricodeText, { color: c.secondaryText }]}>
            {r.tricode || r.team_name.slice(0, 3).toUpperCase()}
          </ThemedText>
        </View>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: s(2),
    marginBottom: s(2),
  },
  dmContainer: {
    alignItems: 'flex-end',
    paddingRight: s(4),
  },
  groupContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: s(4),
    paddingRight: s(4),
  },
  seenText: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(9),
    letterSpacing: 1.0,
  },
  tricodeBadge: {
    paddingHorizontal: s(6),
    paddingVertical: s(2),
    borderRadius: 8,
  },
  tricodeText: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(9),
    letterSpacing: 0.8,
  },
});
