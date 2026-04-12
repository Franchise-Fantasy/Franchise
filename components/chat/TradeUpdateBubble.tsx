import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import type { TradeUpdateEvent } from '@/types/chat';
import { ms, s } from '@/utils/scale';
import { Pressable, StyleSheet, View } from 'react-native';

const EVENT_CONFIG: Record<TradeUpdateEvent, { icon: string; label: string; color: string }> = {
  proposed:  { icon: '📨', label: 'proposed a trade',  color: '#3B82F6' },
  countered: { icon: '↩️', label: 'countered',         color: '#8B5CF6' },
  accepted:  { icon: '✅', label: 'accepted',           color: '#22C55E' },
  rejected:  { icon: '❌', label: 'declined',           color: '#EF4444' },
  cancelled: { icon: '🚫', label: 'withdrew the trade', color: '#9CA3AF' },
  completed: { icon: '🤝', label: 'Trade completed',    color: '#22C55E' },
  vetoed:    { icon: '🛑', label: 'Trade vetoed',       color: '#EF4444' },
};

interface Props {
  event: TradeUpdateEvent;
  teamName: string | null;
  onPress?: () => void;
}

export function TradeUpdateBubble({ event, teamName, onPress }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const config = EVENT_CONFIG[event] ?? EVENT_CONFIG.proposed;

  // System-level events (completed, vetoed) don't show a team name
  const text = teamName
    ? `${config.icon} ${teamName} ${config.label}`
    : `${config.icon} ${config.label}`;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[styles.card, { backgroundColor: c.cardAlt, borderLeftColor: config.color }]}
      accessibilityRole="button"
      accessibilityLabel={`Trade update: ${text}`}
    >
      <ThemedText style={[styles.text, { color: c.secondaryText }]}>
        {text}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 10,
    borderLeftWidth: 3,
    paddingVertical: s(8),
    paddingHorizontal: s(14),
    alignSelf: 'center',
  },
  text: {
    fontSize: ms(13),
    fontWeight: '600',
    textAlign: 'center',
  },
});
