/**
 * Shared chrome for the Inline* dialog primitives (`InlineConfirm`,
 * `InlineAction`, `InlineInput`). Centered card with the brand chrome:
 * gold rule along the top, Alfa Slab title, optional varsity-caps subtitle,
 * optional message body, and an optional close button. Body content is
 * passed in as `children` so each primitive supplies its own rows / inputs
 * / buttons.
 *
 * Mechanically a plain `View` — no `<Modal>` wrapper. The Inline primitives
 * stack their own scrim + animation around this card.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { type ReactNode } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts, cardShadow } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

interface Props {
  title: string;
  subtitle?: string;
  message?: string;
  /** Renders an X close button in the header that calls this. */
  onClose?: () => void;
  children: ReactNode;
}

export function BrandDialogCard({ title, subtitle, message, onClose, children }: Props) {
  const c = useColors();

  return (
    <View
      style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
      accessibilityViewIsModal
      onStartShouldSetResponder={() => true}
    >
      <View style={[styles.topRule, { backgroundColor: c.gold }]} />

      <View style={styles.header}>
        <View style={styles.headerText}>
          <ThemedText
            type="display"
            style={[styles.title, { color: c.text }]}
            accessibilityRole="header"
            numberOfLines={2}
          >
            {title}
          </ThemedText>
          {subtitle ? (
            <ThemedText
              type="varsitySmall"
              style={[styles.subtitle, { color: c.secondaryText }]}
              numberOfLines={1}
            >
              {subtitle}
            </ThemedText>
          ) : null}
        </View>
        {onClose ? (
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={styles.closeBtn}
          >
            <Ionicons name="close" size={ms(20)} color={c.secondaryText} accessible={false} />
          </TouchableOpacity>
        ) : null}
      </View>

      {message ? (
        <ThemedText style={[styles.message, { color: c.secondaryText }]}>
          {message}
        </ThemedText>
      ) : null}

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 16,
    paddingTop: s(10),
    paddingBottom: s(16),
    paddingHorizontal: s(20),
    width: '100%',
    maxWidth: s(360),
    overflow: 'hidden',
    ...cardShadow,
  },
  topRule: {
    height: 2,
    marginHorizontal: -s(20),
    marginBottom: s(14),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    marginBottom: s(8),
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: ms(20),
    lineHeight: ms(24),
    letterSpacing: -0.2,
  },
  subtitle: {
    fontSize: ms(10),
    letterSpacing: 1.3,
    marginTop: s(2),
  },
  closeBtn: {
    padding: s(2),
  },
  message: {
    fontSize: ms(13),
    lineHeight: ms(19),
    marginBottom: s(16),
  },
});
