import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

AppState.addEventListener("change", (state) => {
  if (state === "active") {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});

export default function Auth() {
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function signInWithEmail() {
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      Alert.alert(error.message);
      setLoading(false);
      return;
    }

    // Navigate directly rather than relying on index.tsx's reactive effect,
    // which can race against the AppStateProvider fetch.
    const { data: team } = await supabase
      .from("teams")
      .select("league_id")
      .eq("user_id", data.session.user.id)
      .limit(1)
      .single();

    router.replace(team?.league_id ? "/(tabs)" : "/(setup)");
    setLoading(false);
  }

  async function signUpWithEmail() {
    setLoading(true);
    const {
      data: { session },
      error,
    } = await supabase.auth.signUp({ email, password });
    if (error) Alert.alert(error.message);
    router.replace("/(setup)");
    setLoading(false);
  }

  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={[styles.avatar, { backgroundColor: c.accent }]}>
              <Ionicons
                name="basketball-outline"
                size={32}
                color={c.accentText}
              />
            </View>
            <ThemedText type="title" style={styles.title}>
              Franchise
            </ThemedText>
          </View>

          {/* Form */}
          <View
            style={[
              styles.section,
              { backgroundColor: c.card, borderColor: c.border },
            ]}
          >
            <View style={[styles.inputRow, { borderBottomColor: c.border }]}>
              <Ionicons
                name="mail-outline"
                size={20}
                color={c.secondaryText}
                style={styles.inputIcon}
              />
              <TextInput
                style={[styles.input, { color: c.text }]}
                onChangeText={setEmail}
                value={email}
                placeholder="Email"
                autoCapitalize="none"
                keyboardType="email-address"
                placeholderTextColor={c.secondaryText}
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
                onChangeText={setPassword}
                value={password}
                secureTextEntry
                placeholder="Password"
                autoCapitalize="none"
                placeholderTextColor={c.secondaryText}
              />
            </View>
          </View>

          {/* Actions */}
          <TouchableOpacity
            style={[
              styles.button,
              { backgroundColor: loading ? c.buttonDisabled : c.accent },
            ]}
            disabled={loading}
            onPress={signInWithEmail}
            activeOpacity={0.8}
          >
            <ThemedText style={[styles.buttonText, { color: c.accentText }]}>
              Sign In
            </ThemedText>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.button,
              styles.secondaryButton,
              {
                backgroundColor: loading ? c.buttonDisabled : c.card,
                borderColor: c.border,
              },
            ]}
            disabled={loading}
            onPress={signUpWithEmail}
            activeOpacity={0.8}
          >
            <ThemedText style={[styles.buttonText, { color: c.text }]}>
              Create Account
            </ThemedText>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 100,
    paddingBottom: 40,
  },
  header: {
    alignItems: "center",
    marginBottom: 32,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  title: {
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
  },
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
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    marginBottom: 12,
  },
  secondaryButton: {
    borderWidth: 1,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
