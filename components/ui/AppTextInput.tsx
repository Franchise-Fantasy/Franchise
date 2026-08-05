/**
 * TextInput + a keyboard-dismiss accessory bar (iOS).
 *
 * iOS gives a raised keyboard no built-in "put it away" control, which
 * is especially painful for multiline fields (the return key inserts a
 * newline instead of dismissing) and for numeric pads (no return key at
 * all). This drop-in wrapper attaches a "Done" control above the
 * keyboard via `InputAccessoryView` so every field can dismiss the
 * keyboard the way Apple's own apps do — a Liquid Glass pill on iOS 26+
 * (matching the keyboard's material), a plain text button on older iOS.
 *
 * Usage: swap `<TextInput …/>` for `<AppTextInput …/>`. All TextInput
 * props (including `ref`, `multiline`, `keyboardType`, `style`) pass
 * straight through. On Android/web there is no accessory (the platform
 * keyboards carry their own dismiss affordance) and this renders a plain
 * TextInput, so it is safe everywhere.
 *
 * Each instance owns its own `InputAccessoryView`, co-located in the same
 * tree as its TextInput — this is what makes it work inside RN `<Modal>`
 * hierarchies, where a single app-wide accessory declared outside the
 * modal would not attach. The accessory renders nothing inline (it is
 * teleported onto the keyboard) so it never disturbs layout.
 *
 * A caller that passes its own `inputAccessoryViewID` opts out — we honor
 * it and skip rendering our bar. A caller can also pass `hideAccessory` to
 * suppress the bar entirely (e.g. the chat composer, where the message list
 * already dismisses the keyboard via interactive swipe-down; or a field
 * wired up with `returnKeyType` + `onSubmitEditing`, where the keyboard's
 * own return key already dismisses and the extra bar is just clutter).
 */
import { Ionicons } from '@expo/vector-icons';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import React, { forwardRef, useId, useMemo } from 'react';
import {
  InputAccessoryView,
  Keyboard,
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
  type TextInputProps,
} from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

type AppTextInputProps = TextInputProps & {
  /** Suppress the iOS keyboard-dismiss accessory bar entirely. */
  hideAccessory?: boolean;
};

export const AppTextInput = forwardRef<TextInput, AppTextInputProps>(function AppTextInput(
  { hideAccessory, ...props },
  ref,
) {
  const c = useColors();

  // useId can contain colons (":r0:"), which are not valid nativeIDs.
  const reactId = useId().replace(/:/g, '');
  const accessoryID = `kbd-done-${reactId}`;

  // Memoized so the bar keeps a stable element identity across the parent's
  // re-renders. A controlled TextInput re-renders its whole screen on every
  // keystroke; without this the accessory re-commits each time, UIKit rebuilds
  // the keyboard to re-host it, and the rebuild resets the keyboard to its
  // primary plane — which is what kicked users off the "123" layout after
  // every digit they typed into the email field on the auth screen.
  const accessory = useMemo(() => {
    // Only iOS supports InputAccessoryView (and expo-glass-effect).
    if (Platform.OS !== 'ios') return null;

    // On iOS 26+ the Done control is a Liquid Glass pill that frosts over the
    // content behind it, matching the keyboard's own material. Older iOS falls
    // back to a plain accent-colored text button over a transparent band.
    const glass = isLiquidGlassAvailable();

    const label = (
      <>
        <Ionicons name="chevron-down" size={ms(16)} color={c.accent} />
        <ThemedText style={[styles.doneText, { color: c.accent }]}>Done</ThemedText>
      </>
    );

    return (
      <InputAccessoryView nativeID={accessoryID}>
        <View style={styles.bar}>
          <TouchableOpacity
            onPress={Keyboard.dismiss}
            hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Dismiss keyboard"
          >
            {glass ? (
              <GlassView
                glassEffectStyle="regular"
                isInteractive
                // A faint surface-colored wash so the pill still reads as a
                // distinct glass chip over flat backgrounds (e.g. a form that
                // clears the keyboard), while staying see-through over content.
                tintColor={`${c.card}66`}
                style={styles.glassPill}
              >
                {label}
              </GlassView>
            ) : (
              <View style={styles.doneBtn}>{label}</View>
            )}
          </TouchableOpacity>
        </View>
      </InputAccessoryView>
    );
  }, [accessoryID, c.accent, c.card]);

  // Elsewhere the system keyboard already offers a dismiss control, so pass
  // straight through. Same for a caller-supplied accessory or an explicit
  // opt-out — either way we don't render our bar.
  if (accessory == null || props.inputAccessoryViewID != null || hideAccessory) {
    return <TextInput ref={ref} {...props} />;
  }

  return (
    <>
      <TextInput ref={ref} {...props} inputAccessoryViewID={accessoryID} />
      {accessory}
    </>
  );
});

const styles = StyleSheet.create({
  // Transparent band with a fixed height so the InputAccessoryView keeps its
  // intrinsic size (a transparent bar with no height collapses and iOS lets it
  // expand over the keyboard). The glass pill floats at the trailing edge.
  bar: {
    height: s(52),
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: s(12),
  },
  glassPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
    paddingVertical: s(8),
    paddingHorizontal: s(16),
    borderRadius: s(999),
    overflow: 'hidden',
  },
  doneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
    paddingVertical: s(4),
    paddingHorizontal: s(4),
  },
  doneText: {
    fontSize: ms(16),
    fontWeight: '600',
  },
});
