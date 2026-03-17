import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import type { ReadReceipt } from '@/hooks/chat/useReadReceipts';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

interface Props {
  /** DM = single "Seen", group = tricode badges */
  isDM: boolean;
  /** Other members whose last_read_message_id matches this message */
  readers: ReadReceipt[];
}

export function ReadReceiptIndicator({ isDM, readers }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
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
          Seen
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
    marginTop: 2,
    marginBottom: 2,
  },
  dmContainer: {
    alignItems: 'flex-end',
    paddingRight: 4,
  },
  groupContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 4,
    paddingRight: 4,
  },
  seenText: {
    fontSize: 11,
    fontWeight: '500',
  },
  tricodeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  tricodeText: {
    fontSize: 10,
    fontWeight: '600',
  },
});
