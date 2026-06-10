import { useState } from "react";
import {
  type StyleProp,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";

import { ThemedText, type ThemedTextProps } from "@/components/ui/ThemedText";
import { abbreviateFirstName } from "@/utils/formatting";

interface PlayerNameProps {
  /** Full player name, e.g. "Shai Gilgeous-Alexander". */
  name: string;
  /** ThemedText variant (font / weight). */
  type?: ThemedTextProps["type"];
  /** Text styling — fontSize, color, textAlign, etc. */
  style?: StyleProp<TextStyle>;
  /**
   * Wrapper styling — set width / flex here so the hidden measurer lays out at
   * the same width as the visible name. Defaults to `flexShrink: 1`.
   */
  containerStyle?: StyleProp<ViewStyle>;
}

/**
 * App-wide player-name renderer. Shows the FULL name when it fits and falls back
 * to "F. LastName" (abbreviateFirstName — first initial + the full last name)
 * only when the full name would clip to a second line. A hidden,
 * screen-reader-ignored copy laid out at the slot's full width reports the
 * natural line count via onTextLayout, so we keep full names everywhere they fit
 * and only abbreviate where space actually runs out.
 *
 * Use this anywhere a player's name appears in a list / row / card / cell /
 * picker. Dedicated single-player detail titles (PlayerDetailHeader, the prospect
 * detail page, single-player analytics overlays) render the full name directly —
 * they have the room and the name is the subject of the view. Keep
 * accessibilityLabel strings on the FULL name (screen readers should announce
 * "Shai Gilgeous-Alexander", not "S. Gilgeous-Alexander").
 */
export function PlayerName({ name, type, style, containerStyle }: PlayerNameProps) {
  const [overflows, setOverflows] = useState(false);
  const display = overflows ? abbreviateFirstName(name) : name;
  return (
    <View style={[{ flexShrink: 1 }, containerStyle]}>
      {!overflows && (
        <ThemedText
          type={type}
          style={[style, { position: "absolute", left: 0, right: 0, opacity: 0 }]}
          onTextLayout={(e) => {
            if (e.nativeEvent.lines.length > 1) setOverflows(true);
          }}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          {name}
        </ThemedText>
      )}
      <ThemedText type={type} style={style} numberOfLines={1}>
        {display}
      </ThemedText>
    </View>
  );
}
