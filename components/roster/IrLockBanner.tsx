import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";

import { ThemedText } from "@/components/ui/ThemedText";

import { rosterStyles as styles } from "./rosterStyles";

interface IrLockBannerProps {
  players: { name: string }[];
  colors: { danger: string; text: string };
}

export function IrLockBanner({ players, colors }: IrLockBannerProps) {
  const isPlural = players.length > 1;

  return (
    <View
      style={[
        styles.irLockBanner,
        { backgroundColor: colors.danger + "20", borderColor: colors.danger },
      ]}
      accessibilityRole="alert"
      accessibilityLabel="Roster locked — illegal IR"
    >
      <Ionicons name="warning" size={18} color={colors.danger} />
      <ThemedText style={[styles.irLockBannerText, { color: colors.text }]}>
        Roster moves locked —{" "}
        <ThemedText
          style={[
            styles.irLockBannerText,
            { color: colors.text, fontWeight: "700" },
          ]}
        >
          {players.map((p) => p.name).join(", ")}
        </ThemedText>{" "}
        {isPlural ? "are" : "is"} on IR but no longer injured. Activate them to
        unlock your roster.
      </ThemedText>
    </View>
  );
}
