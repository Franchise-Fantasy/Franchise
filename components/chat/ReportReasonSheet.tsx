import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

export type ReportReason = 'spam' | 'harassment' | 'hate' | 'sexual' | 'other';

const REASONS: { key: ReportReason; label: string; description: string }[] = [
  { key: 'spam',       label: 'Spam',                 description: 'Repetitive, unsolicited, or off-topic' },
  { key: 'harassment', label: 'Harassment or bullying', description: 'Targeted attacks or threats' },
  { key: 'hate',       label: 'Hate speech',          description: 'Slurs, discrimination, or extremism' },
  { key: 'sexual',     label: 'Sexual content',       description: 'Nudity or sexual material' },
  { key: 'other',      label: 'Something else',       description: "Doesn't fit the above" },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  onSubmit: (reason: ReportReason) => void;
}

export function ReportReasonSheet({ visible, onClose, onSubmit }: Props) {
  const c = useColors();

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Report Message"
      subtitle="GOES TO YOUR COMMISSIONER · REVIEWED BY OUR TEAM"
      scrollableBody={false}
    >
      {REASONS.map((r, i) => (
        <TouchableOpacity
          key={r.key}
          style={[
            styles.row,
            i < REASONS.length - 1 && {
              borderBottomColor: c.border,
              borderBottomWidth: StyleSheet.hairlineWidth,
            },
          ]}
          onPress={() => onSubmit(r.key)}
          accessibilityRole="button"
          accessibilityLabel={`Report reason: ${r.label}`}
          accessibilityHint={r.description}
          activeOpacity={0.65}
        >
          <View style={{ flex: 1 }}>
            <ThemedText style={[styles.rowLabel, { color: c.text }]}>
              {r.label}
            </ThemedText>
            <ThemedText style={[styles.rowDescription, { color: c.secondaryText }]}>
              {r.description}
            </ThemedText>
          </View>
          <Ionicons name="chevron-forward" size={ms(16)} color={c.secondaryText} accessible={false} />
        </TouchableOpacity>
      ))}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(14),
    gap: s(10),
  },
  rowLabel: {
    fontFamily: Fonts.display,
    fontSize: ms(15),
    lineHeight: ms(19),
    letterSpacing: -0.2,
  },
  rowDescription: {
    fontSize: ms(12),
    marginTop: s(2),
  },
});
