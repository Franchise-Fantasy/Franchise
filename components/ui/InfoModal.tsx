/**
 * Brand-styled centered popup. The default modal primitive for
 * informational content, small pickers, filter forms, and confirm
 * dialogs that don't warrant a full bottom sheet.
 *
 * Layout: gold rule top, Alfa Slab title row (with optional
 * `headerAction` slot like "Reset"), close X, scrollable body.
 *
 * Used by: standings, analytics, roster, matchup, FreeAgentList
 * filters, etc. Naming kept as `InfoModal` for back-compat with the
 * 9 existing call sites, but it covers more than info popups now.
 */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts, cardShadow } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

interface InfoModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** Plain-text message (rendered as a single paragraph). */
  message?: string;
  /** Right-aligned slot in the header — e.g. a "Reset" link. */
  headerAction?: React.ReactNode;
  /** For richer content, pass children instead of / in addition to message. */
  children?: React.ReactNode;
}

export function InfoModal({
  visible,
  onClose,
  title,
  message,
  headerAction,
  children,
}: InfoModalProps) {
  const c = useColors();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.scrim}
        activeOpacity={1}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
      >
        <View
          style={[
            styles.card,
            {
              backgroundColor: c.card,
              borderColor: c.border,
            },
          ]}
          // Block the scrim's onPress when tapping inside the card.
          onStartShouldSetResponder={() => true}
          accessibilityViewIsModal
        >
          {/* Top gold rule — the signature broadcast bug */}
          <View style={[styles.topRule, { backgroundColor: c.gold }]} />

          <View style={styles.header}>
            <ThemedText
              type="display"
              style={[styles.title, { color: c.text }]}
              accessibilityRole="header"
              numberOfLines={2}
            >
              {title}
            </ThemedText>
            {headerAction}
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={styles.closeBtn}
            >
              <Ionicons name="close" size={ms(20)} color={c.secondaryText} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} bounces={false}>
            {message ? (
              <ThemedText
                style={[styles.text, { color: c.secondaryText }]}
              >
                {message}
              </ThemedText>
            ) : null}
            {children}
          </ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(20, 16, 16, 0.55)', // Brand.ink @ 55%
    justifyContent: 'center',
    alignItems: 'center',
    padding: s(24),
  },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    paddingTop: s(10),
    paddingBottom: s(20),
    paddingHorizontal: s(20),
    width: '100%',
    maxWidth: s(360),
    maxHeight: '80%',
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
    marginBottom: s(14),
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: ms(20),
    lineHeight: ms(24),
    letterSpacing: -0.2,
    flex: 1,
  },
  closeBtn: {
    padding: s(2),
  },
  body: {
    flexGrow: 0,
  },
  text: {
    fontSize: ms(13),
    lineHeight: ms(19),
    marginBottom: s(12),
  },
});

