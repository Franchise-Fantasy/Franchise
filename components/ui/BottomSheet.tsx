/**
 * Brand-styled bottom sheet primitive. Slide-up panel anchored to the
 * bottom of the screen, used for action-heavy modals — trade partner
 * pickers, slot pickers, edit-settings forms, the trade block, etc.
 *
 * Replaces the scattered hand-rolled `<Modal animationType="slide" transparent>`
 * pattern across ~20 components. Each of those reimplements the same
 * scrim + sheet layout with subtle inconsistencies; this primitive is
 * the canonical version with brand chrome (gold rule, drag handle,
 * Alfa Slab title).
 *
 * Animation: matches TradeBlockSheet's pattern — Modal's own animation
 * is disabled (`animationType="none"`); the scrim and sheet animate in
 * parallel via Animated.parallel so the backdrop fades in (0 → 0.55)
 * while the sheet rises (translateY: windowHeight → 0). Close runs the
 * reverse before calling `onClose()`.
 *
 * Bottom clearance: a fixed `paddingBottom: s(32)` lives on the sheet
 * shell itself (which carries the brand background) — same approach as
 * TradeBlockSheet. The brand bg fills the home-indicator zone, so no
 * transparent gap below the sheet on notched devices.
 *
 * Keyboard handling: pass `keyboardAvoiding` for sheets containing text
 * inputs. Defaults off because most sheets don't need it.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import { DialogHost } from '@/context/ConfirmProvider';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Sheet title in Alfa Slab. Optional — pass null to render no header. */
  title?: string | null;
  /** Sub-title beneath the title (e.g. "12 players available"). */
  subtitle?: string;
  /** Right-aligned slot in the header — e.g. a "Reset" link or count badge. */
  headerAction?: React.ReactNode;
  /**
   * Footer area docked to the sheet's bottom. Use for primary action
   * buttons (e.g. "Save", "Propose Trade"). Sits above the body's
   * scroll, with hairline border separation.
   */
  footer?: React.ReactNode;
  /** When true, body wraps in a KeyboardAvoidingView (text-input sheets). */
  keyboardAvoiding?: boolean;
  /**
   * Override the sheet's height. Defaults to flexible (auto-sized to
   * content, capped at 85% screen). Pass a percentage or fixed number.
   */
  height?: number | `${number}%`;
  /** Body wrapper style — useful for custom inner padding overrides. */
  bodyStyle?: StyleProp<ViewStyle>;
  /** Set to false to disable the body's built-in ScrollView (when body has its own scroll). */
  scrollableBody?: boolean;
  children: React.ReactNode;
}

export function BottomSheet({
  visible,
  onClose,
  title,
  subtitle,
  headerAction,
  footer,
  keyboardAvoiding = false,
  height,
  bodyStyle,
  scrollableBody = true,
  children,
}: BottomSheetProps) {
  const c = useColors();

  const slideAnim = useRef(new Animated.Value(Dimensions.get('window').height)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 0,
          speed: 14,
        }),
      ]).start();
    }
  }, [visible, fadeAnim, slideAnim]);

  const handleClose = useCallback(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: Dimensions.get('window').height,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => onClose());
  }, [fadeAnim, slideAnim, onClose]);

  const sheetStyle: StyleProp<ViewStyle> = [
    styles.sheet,
    {
      backgroundColor: c.background,
      borderColor: c.border,
      transform: [{ translateY: slideAnim }],
    },
    height != null && { height },
    height == null && { maxHeight: '85%' as const },
  ];

  const body = scrollableBody ? (
    <ScrollView
      style={styles.bodyScroll}
      contentContainerStyle={[styles.bodyContent, bodyStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.bodyView, bodyStyle]}>{children}</View>
  );

  const sheet = (
    <Animated.View style={sheetStyle} accessibilityViewIsModal>
      {/* Drag handle pill */}
      <View style={styles.handleWrap} pointerEvents="none">
        <View style={[styles.handle, { backgroundColor: c.border }]} />
      </View>

      {/* Top gold rule */}
      <View style={[styles.topRule, { backgroundColor: c.gold }]} />

      {/* Header */}
      {title != null && (
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
          {headerAction}
          <TouchableOpacity
            onPress={handleClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={styles.closeBtn}
          >
            <Ionicons name="close" size={ms(22)} color={c.secondaryText} />
          </TouchableOpacity>
        </View>
      )}

      {body}

      {footer ? (
        <View
          style={[
            styles.footer,
            { backgroundColor: c.background, borderTopColor: c.border },
          ]}
        >
          {footer}
        </View>
      ) : null}
    </Animated.View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={handleClose}
    >
      <View style={styles.root}>
        {/* Backdrop scrim — fades independently of the sheet's slide */}
        <Animated.View style={[styles.scrim, { opacity: fadeAnim }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
          />
        </Animated.View>

        {keyboardAvoiding ? (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.keyboardWrap}
          >
            {sheet}
          </KeyboardAvoidingView>
        ) : (
          sheet
        )}

        <DialogHost />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(20, 16, 16, 0.55)', // Brand.ink @ 55%
  },
  keyboardWrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    paddingTop: s(8),
    paddingBottom: s(32), // home-indicator clearance, brand bg flows into this zone
    overflow: 'hidden',
  },
  handleWrap: {
    alignItems: 'center',
    paddingTop: s(2),
    paddingBottom: s(8),
  },
  handle: {
    width: s(40),
    height: 4,
    borderRadius: 2,
  },
  topRule: {
    height: 2,
    marginHorizontal: s(20),
    marginBottom: s(14),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    paddingHorizontal: s(20),
    marginBottom: s(12),
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: ms(22),
    lineHeight: ms(26),
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
  bodyScroll: {
    flexShrink: 1,
  },
  bodyContent: {
    paddingHorizontal: s(20),
    paddingBottom: s(8),
  },
  bodyView: {
    flex: 1,
    paddingHorizontal: s(20),
    paddingBottom: s(8),
  },
  footer: {
    paddingHorizontal: s(20),
    paddingTop: s(12),
    paddingBottom: s(8),
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
