/**
 * Branded action-picker overlay — a vertical list of choices, each row
 * with a leading icon, Alfa Slab label, and optional destructive
 * treatment. Replaces every `ActionSheetIOS.showActionSheetWithOptions`
 * (and the older `ActionModal`).
 *
 * Mechanically a plain absolute-positioned overlay (no `<Modal>`), so
 * it stacks reliably inside other Modals when rendered from a
 * `DialogHost`.
 *
 * Tap dismisses first, then fires `onPress` after the fade-out so the
 * next picker doesn't overlap with the dismissing card.
 */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { BrandDialogCard } from '@/components/ui/BrandDialogCard';
import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

export type ModalAction = {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  destructive?: boolean;
  /** Set to true to omit the row entirely (e.g. role-gated options). */
  hidden?: boolean;
};

export interface ActionConfig {
  title: string;
  subtitle?: string;
  actions: ModalAction[];
}

interface Props {
  config: ActionConfig;
  onClose: () => void;
}

const CLOSE_DELAY_MS = 180;

export function InlineAction({ config, onClose }: Props) {
  const c = useColors();
  const { title, subtitle, actions } = config;
  const visibleActions = actions.filter((a) => !a.hidden);

  const handleSelect = (action: ModalAction) => {
    onClose();
    setTimeout(action.onPress, CLOSE_DELAY_MS);
  };

  return (
    <Animated.View
      entering={FadeIn.duration(140)}
      exiting={FadeOut.duration(120)}
      style={styles.scrim}
    >
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
      />

      <BrandDialogCard title={title} subtitle={subtitle} onClose={onClose}>
        <View style={styles.body}>
          {visibleActions.map((action, i) => {
            const isLast = i === visibleActions.length - 1;
            const fg = action.destructive ? c.danger : c.text;
            const iconBg = action.destructive ? c.dangerMuted : c.cardAlt;
            return (
              <TouchableOpacity
                key={action.id}
                onPress={() => handleSelect(action)}
                style={[
                  styles.row,
                  !isLast && {
                    borderBottomColor: c.border,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                activeOpacity={0.65}
              >
                <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
                  <Ionicons name={action.icon} size={ms(18)} color={fg} accessible={false} />
                </View>
                <ThemedText style={[styles.label, { color: fg }]} numberOfLines={1}>
                  {action.label}
                </ThemedText>
              </TouchableOpacity>
            );
          })}
        </View>
      </BrandDialogCard>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(20, 16, 16, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: s(24),
  },
  body: {
    paddingTop: s(2),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(12),
    paddingVertical: s(12),
  },
  iconWrap: {
    width: s(32),
    height: s(32),
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flex: 1,
    fontFamily: Fonts.display,
    fontSize: ms(15),
    lineHeight: ms(19),
    letterSpacing: -0.2,
  },
});
