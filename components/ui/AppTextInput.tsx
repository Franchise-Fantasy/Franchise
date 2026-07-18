/**
 * TextInput + a keyboard-dismiss accessory bar (iOS).
 *
 * iOS gives a raised keyboard no built-in "put it away" control, which
 * is especially painful for multiline fields (the return key inserts a
 * newline instead of dismissing) and for numeric pads (no return key at
 * all). This drop-in wrapper attaches a thin "Done" bar above the
 * keyboard via `InputAccessoryView` so every field can dismiss the
 * keyboard the way Apple's own apps do.
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
 * it and skip rendering our bar.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { forwardRef, useId } from 'react';
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

export const AppTextInput = forwardRef<TextInput, TextInputProps>(function AppTextInput(
  props,
  ref,
) {
  const c = useColors();

  // useId can contain colons (":r0:"), which are not valid nativeIDs.
  const reactId = useId().replace(/:/g, '');

  // Only iOS supports InputAccessoryView. Elsewhere the system keyboard
  // already offers a dismiss control, so pass straight through.
  if (Platform.OS !== 'ios') {
    return <TextInput ref={ref} {...props} />;
  }

  // Respect a caller-supplied accessory — don't clobber it with ours.
  if (props.inputAccessoryViewID != null) {
    return <TextInput ref={ref} {...props} />;
  }

  const accessoryID = `kbd-done-${reactId}`;

  return (
    <>
      <TextInput ref={ref} {...props} inputAccessoryViewID={accessoryID} />
      <InputAccessoryView nativeID={accessoryID}>
        <View
          style={[
            styles.bar,
            { backgroundColor: c.card, borderTopColor: c.border },
          ]}
        >
          <TouchableOpacity
            onPress={Keyboard.dismiss}
            hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Dismiss keyboard"
            style={styles.doneBtn}
          >
            <Ionicons name="chevron-down" size={ms(16)} color={c.accent} />
            <ThemedText style={[styles.doneText, { color: c.accent }]}>
              Done
            </ThemedText>
          </TouchableOpacity>
        </View>
      </InputAccessoryView>
    </>
  );
});

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: s(12),
    paddingVertical: s(6),
    borderTopWidth: StyleSheet.hairlineWidth,
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
