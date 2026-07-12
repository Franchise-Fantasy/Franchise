import { Ionicons } from '@expo/vector-icons';
import { Modal, StyleSheet, TouchableOpacity, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
  useSafeAreaFrame,
} from 'react-native-safe-area-context';

import { LeagueChatPanel } from '@/components/chat/LeagueChatPanel';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors, Fonts } from '@/constants/Colors';
import { DialogHost } from '@/context/ConfirmProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useReanimatedKeyboardAnimation } from '@/utils/keyboardController';
import { ms, s } from '@/utils/scale';

interface DraftChatModalProps {
  visible: boolean;
  leagueId: string;
  teamId: string;
  teamName: string;
  isCommissioner: boolean;
  onClose: () => void;
}

/**
 * Full-screen league chat sheet for the phone draft room. Owns only the sheet
 * chrome — header, keyboard lift, safe-area re-seed, DialogHost; the
 * conversation itself is `LeagueChatPanel`, which the desktop draft room mounts
 * directly as a permanent rail.
 */
export function DraftChatModal({
  visible,
  leagueId,
  teamId,
  teamName,
  isCommissioner,
  onClose,
}: DraftChatModalProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const outerInsets = useSafeAreaInsets();
  const outerFrame = useSafeAreaFrame();

  // Drive the chat surface's bottom padding from the same shared value the
  // keyboard animates on — guarantees the page slides in lockstep with the
  // keyboard rather than the OS-driven keyboard preceding the JS-driven
  // KeyboardAvoidingView. `kbHeight` is 0 when closed and -keyboardHeight
  // when open. We subtract `insets.bottom` because the SafeAreaView already
  // pads that much at the bottom for the home indicator — without the
  // subtraction, the input ends up insets.bottom above the keyboard top.
  const { height: kbHeight } = useReanimatedKeyboardAnimation();
  const safeBottom = outerInsets.bottom;
  const chatBodyAnim = useAnimatedStyle(() => ({
    paddingBottom: Math.max(0, -kbHeight.value - safeBottom),
  }));

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      {/* fullScreen presentation makes the modal === screen, so the
          KeyboardAvoidingView's frame measurement aligns with screen
          coordinates and the keyboard math works cleanly (no pageSheet
          top-offset to compensate for). The catch: fullScreen Modals
          don't propagate the SafeAreaProvider context, so we re-seed it
          with the outer tree's insets/frame so the inner SafeAreaView
          renders the X button below the notch and the ChatInput above
          the home indicator. */}
      <SafeAreaProvider initialMetrics={{ insets: outerInsets, frame: outerFrame }}>
        <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
          {/* Modal header — varsity-caps centered title + X close on the right.
              No back chevron because this is a modal sheet, not a route. The
              title is absolute-centered so the close button can grow without
              displacing it. Presence avatars live in the draft room header,
              not here, to avoid duplication. */}
          <View style={[styles.header, { borderBottomColor: c.border }]}>
            <View style={styles.headerTitleAbsolute} pointerEvents="none">
              <ThemedText
                type="varsity"
                style={[styles.headerText, { color: c.secondaryText }]}
                accessibilityRole="header"
              >
                League Chat
              </ThemedText>
            </View>
            <View style={styles.headerSide} />
            <TouchableOpacity
              onPress={onClose}
              style={styles.headerSide}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close chat"
            >
              <Ionicons name="close" size={22} color={c.icon} accessible={false} />
            </TouchableOpacity>
          </View>

          {/* Reanimated bottom padding driven directly by the keyboard's
              shared animation value — keyboard rise/fall and chat lift run
              on the same frame so they slide together. Replaces the
              KeyboardAvoidingView lift, which had visibly delayed timing
              relative to the OS-driven keyboard animation. */}
          <Animated.View style={[styles.flex, chatBodyAnim]}>
            <LeagueChatPanel
              leagueId={leagueId}
              teamId={teamId}
              teamName={teamName}
              isCommissioner={isCommissioner}
              active={visible}
            />
          </Animated.View>

          {/* Host the attach action-picker inside this fullScreen modal's tree —
              without a DialogHost here it renders at the app root, beneath the
              modal, so the picker is invisible/unreachable. */}
          <DialogHost />
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  // Modal header — centered title + close on the right.
  header: {
    flexDirection: 'row',
    paddingHorizontal: s(8),
    paddingVertical: s(8),
    height: s(50),
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitleAbsolute: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(12),
    letterSpacing: 1.2,
  },
  headerSide: {
    width: s(36),
    height: s(36),
    alignItems: 'center',
    justifyContent: 'center',
  },
});
