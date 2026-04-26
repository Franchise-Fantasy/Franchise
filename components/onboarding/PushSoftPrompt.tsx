import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { BrandButton } from '@/components/ui/BrandButton';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';

const CATEGORIES: { icon: keyof typeof Ionicons.glyphMap; label: string; description: string }[] = [
  { icon: 'flash-outline',     label: 'Live game updates',      description: 'Score swings and matchup deltas in real time' },
  { icon: 'swap-horizontal',   label: 'Trades & waivers',       description: 'Proposals, accepts, and weekly waiver results' },
  { icon: 'megaphone-outline', label: 'Commissioner actions',   description: 'Polls, schedule changes, payouts' },
  { icon: 'people-outline',    label: 'Draft & league chat',    description: "When it's your pick or a teammate posts" },
];

interface Props {
  visible: boolean;
  onEnable: () => void;
  onDismiss: () => void;
}

// Apple expects a contextual soft-prompt before the OS-level push permission
// dialog. This screen explains what we'd actually use notifications for, and
// only on "Enable" do we trigger the system prompt.
export function PushSoftPrompt({ visible, onEnable, onDismiss }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <Pressable
        style={styles.overlay}
        onPress={onDismiss}
        accessibilityLabel="Dismiss notification prompt"
      >
        <Pressable
          style={[styles.sheet, { backgroundColor: c.card, borderColor: c.border }]}
          accessibilityLabel="Notification permission explanation"
        >
          <View style={[styles.iconCircle, { backgroundColor: c.activeCard }]}>
            <Ionicons
              name="notifications"
              size={ms(28)}
              color={c.accent}
              accessible={false}
            />
          </View>
          <ThemedText type="title" style={styles.title}>
            Stay in the game
          </ThemedText>
          <ThemedText style={[styles.subtitle, { color: c.secondaryText }]}>
            Turn on notifications and we'll only ping you for things that actually matter:
          </ThemedText>

          <View style={styles.list}>
            {CATEGORIES.map((cat) => (
              <View key={cat.label} style={styles.row}>
                <Ionicons
                  name={cat.icon}
                  size={ms(20)}
                  color={c.accent}
                  accessible={false}
                />
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.rowLabel}>{cat.label}</ThemedText>
                  <ThemedText style={[styles.rowDescription, { color: c.secondaryText }]}>
                    {cat.description}
                  </ThemedText>
                </View>
              </View>
            ))}
          </View>

          <ThemedText style={[styles.footnote, { color: c.secondaryText }]}>
            You can change which notifications you receive any time in your profile settings.
          </ThemedText>

          <BrandButton
            label="Enable Notifications"
            onPress={onEnable}
            variant="primary"
            fullWidth
            style={styles.primaryAction}
          />
          <BrandButton
            label="Maybe Later"
            onPress={onDismiss}
            variant="ghost"
            fullWidth
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: s(16),
  },
  sheet: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: s(20),
    paddingTop: s(20),
    paddingBottom: s(20),
    gap: s(8),
  },
  iconCircle: {
    width: s(56),
    height: s(56),
    borderRadius: 28,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: s(8),
  },
  title: {
    textAlign: 'center',
    fontSize: ms(20),
  },
  subtitle: {
    textAlign: 'center',
    fontSize: ms(13),
    lineHeight: ms(18),
    marginBottom: s(8),
    paddingHorizontal: s(4),
  },
  list: {
    gap: s(10),
    marginVertical: s(8),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: s(10),
  },
  rowLabel: {
    fontSize: ms(14),
    fontWeight: '600',
  },
  rowDescription: {
    fontSize: ms(12),
    lineHeight: ms(16),
    marginTop: s(1),
  },
  footnote: {
    fontSize: ms(11),
    lineHeight: ms(15),
    textAlign: 'center',
    marginTop: s(6),
    marginBottom: s(4),
    paddingHorizontal: s(4),
  },
  primaryAction: {
    marginTop: s(8),
  },
});
