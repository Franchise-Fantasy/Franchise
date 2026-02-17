import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

export default function SetupHome() {
  const router = useRouter();
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];

  return (
    <ThemedView style={styles.container}>
      <View style={styles.hero}>
        <Ionicons name="trophy-outline" size={64} color={c.accent} />
        <ThemedText type="title" style={styles.title}>
          Welcome to Franchise
        </ThemedText>
        <ThemedText style={[styles.subtitle, { color: c.secondaryText }]}>
          Create your own league or join an existing one to get started.
        </ThemedText>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: c.accent }]}
          onPress={() => router.push("/create-league")}
          activeOpacity={0.8}
        >
          <Ionicons name="add-circle-outline" size={22} color={c.accentText} />
          <Text style={[styles.primaryBtnText, { color: c.accentText }]}>
            Create a League
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.secondaryBtn, { borderColor: c.border }]}
          onPress={() => router.push("/join-league")}
          activeOpacity={0.8}
        >
          <Ionicons name="people-outline" size={22} color={c.text} />
          <ThemedText style={styles.secondaryBtnText}>
            Join a League
          </ThemedText>
        </TouchableOpacity>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  hero: {
    alignItems: "center",
    marginBottom: 48,
  },
  title: {
    marginTop: 16,
    textAlign: "center",
  },
  subtitle: {
    marginTop: 8,
    textAlign: "center",
    fontSize: 16,
    lineHeight: 22,
  },
  actions: {
    gap: 14,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 12,
  },
  primaryBtnText: {
    fontSize: 17,
    fontWeight: "700",
  },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  secondaryBtnText: {
    fontSize: 17,
    fontWeight: "600",
  },
});
