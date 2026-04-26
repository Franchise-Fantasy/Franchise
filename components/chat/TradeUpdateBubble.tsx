import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Fonts } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import type { TradeUpdateEvent } from '@/types/chat';
import { ms, s } from '@/utils/scale';

const EVENT_CONFIG: Record<TradeUpdateEvent, { icon: string; label: string; color: string }> = {
  proposed:  { icon: '📨', label: 'PROPOSED A TRADE',  color: Brand.sapphire },
  countered: { icon: '↩️', label: 'COUNTERED',          color: Brand.vintageGold },
  accepted:  { icon: '✅', label: 'ACCEPTED',           color: Brand.turfGreen },
  rejected:  { icon: '❌', label: 'DECLINED',           color: Brand.merlot },
  cancelled: { icon: '🚫', label: 'WITHDREW THE TRADE', color: 'rgba(20, 16, 16, 0.45)' },
  completed: { icon: '🤝', label: 'TRADE COMPLETED',    color: Brand.turfGreen },
  vetoed:    { icon: '🛑', label: 'TRADE VETOED',       color: Brand.merlot },
};

interface Props {
  event: TradeUpdateEvent;
  teamName: string | null;
  onPress?: () => void;
}

export function TradeUpdateBubble({ event, teamName, onPress }: Props) {
  const c = useColors();

  const config = EVENT_CONFIG[event] ?? EVENT_CONFIG.proposed;

  const text = teamName
    ? `${config.icon}  ${teamName.toUpperCase()} ${config.label}`
    : `${config.icon}  ${config.label}`;

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
    fontFamily: Fonts.varsityBold,
    fontSize: ms(11),
    letterSpacing: 1.0,
    textAlign: 'center',
  },
});
