import { LogoSpinner } from "@/components/ui/LogoSpinner";
import { ThemedText } from "@/components/ui/ThemedText";
import { ms, s } from "@/utils/scale";
import { ThemedView } from "@/components/ui/ThemedView";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

export default function ResetPasswordScreen() {
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  // Session is established by _layout.tsx before navigating here.
  // Just verify we have an active session.
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setSessionReady(true);
      } else {
        Alert.alert("Invalid link", "No reset session found.", [
          { text: "OK", onPress: () => router.replace("/auth") },
        ]);
      }
    });
  }, []);

  async function handleUpdatePassword() {
    if (password.length < 6) {
      Alert.alert("Password too short", "Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      Alert.alert("Passwords don't match", "Please make sure both passwords are the same.");
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.auth.updateUser({ password });

    if (error) {
      setLoading(false);
      Alert.alert("Error", error.message);
      return;
    }

    // User already has a valid session — skip /auth and go straight to the app.
    // Avoids a racy replace chain that left the tab navigator frozen.
    const userId = data.user?.id;
    let destination: "/(tabs)" | "/(setup)" = "/(setup)";
    if (userId) {
      const { data: team } = await supabase
        .from("teams")
        .select("league_id")
        .eq("user_id", userId)
        .limit(1)
        .single();
      destination = team?.league_id ? "/(tabs)" : "/(setup)";
    }
    setLoading(false);

    Alert.alert("Password updated", "Your password has been reset successfully.", [
      { text: "OK", onPress: () => router.replace(destination) },
    ]);
  }

  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        <View style={styles.content}>
          <View style={styles.header}>
            <View style={[styles.iconCircle, { backgroundColor: c.accent }]}>
              <Ionicons name="key-outline" size={28} color={c.accentText} />
            </View>
            <ThemedText type="title" style={styles.title}>
              Reset Password
            </ThemedText>
            <ThemedText style={[styles.subtitle, { color: c.secondaryText }]}>
              {sessionReady ? "Enter your new password below." : "Verifying reset link…"}
            </ThemedText>
          </View>

          {!sessionReady ? (
            <View style={{ marginTop: 24 }}><LogoSpinner /></View>
          ) : (
            <>
              <View
                style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}
              >
                <View style={[styles.inputRow, { borderBottomColor: c.border }]}>
                  <Ionicons
                    name="lock-closed-outline"
                    size={20}
                    color={c.secondaryText}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={[styles.input, { color: c.text }]}
                    onChangeText={setPassword}
                    value={password}
                    secureTextEntry
                    placeholder="New password"
                    autoCapitalize="none"
                    placeholderTextColor={c.secondaryText}
                    accessibilityLabel="New password"
                  />
                </View>
                <View style={styles.inputRow}>
                  <Ionicons
                    name="lock-closed-outline"
                    size={20}
                    color={c.secondaryText}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={[styles.input, { color: c.text }]}
                    onChangeText={setConfirm}
                    value={confirm}
                    secureTextEntry
                    placeholder="Confirm new password"
                    autoCapitalize="none"
                    placeholderTextColor={c.secondaryText}
                    accessibilityLabel="Confirm new password"
                  />
                </View>
              </View>

              <TouchableOpacity
                style={[
                  styles.button,
                  { backgroundColor: loading ? c.buttonDisabled : c.accent },
                ]}
                disabled={loading}
                onPress={handleUpdatePassword}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Update password"
              >
                <ThemedText style={[styles.buttonText, { color: c.accentText }]}>
                  Update Password
                </ThemedText>
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  keyboardView: { flex: 1 },
  content: {
    paddingHorizontal: 20,
    paddingTop: 100,
    paddingBottom: 40,
  },
  header: { alignItems: "center", marginBottom: 32 },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  title: { marginBottom: 8 },
  subtitle: { fontSize: ms(15), textAlign: "center" },
  section: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
    overflow: "hidden",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
  },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, fontSize: ms(16) },
  button: {
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    marginBottom: 12,
  },
  buttonText: { fontSize: ms(16), fontWeight: "600" },
});
