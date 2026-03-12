import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";
import { supabase } from "@/lib/supabase";
import { isExpoGo } from "@/utils/buildConfig";
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

// Lazy-load Google Sign-In to avoid crash in Expo Go (native module not available)
let GoogleSignin: any = null;
let statusCodes: any = {};
let GOOGLE_ENABLED = false;

try {
  const mod = require("@react-native-google-signin/google-signin");
  GoogleSignin = mod.GoogleSignin;
  statusCodes = mod.statusCodes;
  if (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID) {
    GoogleSignin.configure({
      webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
      iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    });
    GOOGLE_ENABLED = true;
  }
} catch {
  // Native module not available (e.g. running in Expo Go)
}

export default function Auth() {
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [otpToken, setOtpToken] = useState("");
  const [pendingVerification, setPendingVerification] = useState(false);

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

  async function handleResetPassword() {
    if (!email.trim()) {
      Alert.alert("Enter your email", "Please enter your email address above, then tap Forgot Password.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: 'franchisev2://reset-password',
    });
    setLoading(false);
    if (error) {
      Alert.alert("Error", error.message);
    } else {
      setResetSent(true);
      Alert.alert("Check your email", "We sent a password reset link to " + email.trim());
    }
  }

  async function signUpWithEmail() {
    setLoading(true);
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) {
      Alert.alert(error.message);
      setLoading(false);
      return;
    }
    // TODO: Re-enable OTP verification once custom SMTP is set up.
    // Only trigger in production builds (magic link emails won't work in Expo Go).
    // if (!isExpoGo) setPendingVerification(true);
    router.replace("/(setup)");
    setLoading(false);
  }

  async function verifyOtp() {
    if (!otpToken.trim()) {
      Alert.alert("Enter the code", "Please enter the 8-digit code from your email.");
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token: otpToken.trim(),
      type: "signup",
    });
    if (error) {
      Alert.alert("Verification failed", error.message);
      setLoading(false);
      return;
    }
    router.replace("/(setup)");
    setLoading(false);
  }

  async function resendOtp() {
    setLoading(true);
    const { error } = await supabase.auth.resend({ type: "signup", email });
    setLoading(false);
    if (error) {
      Alert.alert("Error", error.message);
    } else {
      Alert.alert("Code resent", "Check your email for a new verification code.");
    }
  }

  async function signInWithGoogle() {
    if (!GOOGLE_ENABLED) return;
    setLoading(true);
    try {
      await GoogleSignin.hasPlayServices();
      const response = await GoogleSignin.signIn();

      if (!response.data?.idToken) {
        Alert.alert("Google Sign-In failed", "No ID token returned.");
        setLoading(false);
        return;
      }

      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: "google",
        token: response.data.idToken,
      });

      if (error) {
        Alert.alert("Sign-in error", error.message);
        setLoading(false);
        return;
      }

      const { data: team } = await supabase
        .from("teams")
        .select("league_id")
        .eq("user_id", data.session.user.id)
        .limit(1)
        .single();

      router.replace(team?.league_id ? "/(tabs)" : "/(setup)");
    } catch (err: any) {
      if (
        err.code === statusCodes.SIGN_IN_CANCELLED ||
        err.code === statusCodes.IN_PROGRESS
      ) {
        // User cancelled or already in progress — do nothing
      } else {
        Alert.alert("Google Sign-In failed", err.message ?? "Unknown error");
      }
    } finally {
      setLoading(false);
    }
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

          {pendingVerification ? (
            <>
              {/* OTP Verification */}
              <ThemedText style={[styles.otpSubtitle, { color: c.secondaryText }]}>
                We sent an 8-digit code to {email}
              </ThemedText>

              <View
                style={[
                  styles.section,
                  { backgroundColor: c.card, borderColor: c.border },
                ]}
              >
                <View style={[styles.inputRow, { borderBottomWidth: 0 }]}>
                  <Ionicons
                    name="key-outline"
                    size={20}
                    color={c.secondaryText}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={[styles.input, { color: c.text, letterSpacing: 8, fontSize: 22, fontWeight: "600" }]}
                    onChangeText={setOtpToken}
                    value={otpToken}
                    placeholder="00000000"
                    keyboardType="number-pad"
                    maxLength={8}
                    autoFocus
                    placeholderTextColor={c.secondaryText}
                    accessibilityLabel="Verification code"
                    accessibilityHint="Enter the 6-digit code from your email"
                  />
                </View>
              </View>

              <TouchableOpacity
                style={[
                  styles.button,
                  { backgroundColor: loading ? c.buttonDisabled : c.accent },
                ]}
                disabled={loading}
                onPress={verifyOtp}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Verify code"
              >
                <ThemedText style={[styles.buttonText, { color: c.accentText }]}>
                  Verify
                </ThemedText>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={resendOtp}
                disabled={loading}
                activeOpacity={0.7}
                style={styles.forgotPassword}
                accessibilityRole="button"
                accessibilityLabel="Resend verification code"
              >
                <ThemedText style={[styles.forgotPasswordText, { color: c.accent }]}>
                  Resend code
                </ThemedText>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  setPendingVerification(false);
                  setOtpToken("");
                }}
                activeOpacity={0.7}
                style={styles.forgotPassword}
                accessibilityRole="button"
                accessibilityLabel="Go back to sign in"
              >
                <ThemedText style={[styles.forgotPasswordText, { color: c.secondaryText }]}>
                  Back to sign in
                </ThemedText>
              </TouchableOpacity>
            </>
          ) : (
            <>
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

              {/* Password reset uses magic links which require deep linking (TestFlight / prod only) */}
              {!isExpoGo && (
                <TouchableOpacity
                  onPress={handleResetPassword}
                  disabled={loading}
                  activeOpacity={0.7}
                  style={styles.forgotPassword}
                >
                  <ThemedText style={[styles.forgotPasswordText, { color: c.accent }]}>
                    {resetSent ? "Resend reset email" : "Forgot Password?"}
                  </ThemedText>
                </TouchableOpacity>
              )}

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

              {/* Divider */}
              <View style={styles.dividerRow} accessible={false}>
                <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
                <ThemedText style={[styles.dividerText, { color: c.secondaryText }]}>
                  or continue with
                </ThemedText>
                <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
              </View>

              {/* Google Sign-In (greyed out until credentials are configured) */}
              <TouchableOpacity
                style={[
                  styles.button,
                  styles.googleButton,
                  {
                    backgroundColor: c.card,
                    borderColor: c.border,
                    opacity: GOOGLE_ENABLED ? 1 : 0.4,
                  },
                ]}
                disabled={!GOOGLE_ENABLED || loading}
                onPress={signInWithGoogle}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Sign in with Google"
                accessibilityHint={
                  GOOGLE_ENABLED ? undefined : "Coming soon"
                }
                accessibilityState={{ disabled: !GOOGLE_ENABLED || loading }}
              >
                <Ionicons
                  name="logo-google"
                  size={20}
                  color={c.text}
                  style={styles.googleIcon}
                  accessible={false}
                />
                <ThemedText style={[styles.buttonText, { color: c.text }]}>
                  Sign in with Google
                </ThemedText>
              </TouchableOpacity>

              <ThemedText style={[styles.legalText, { color: c.secondaryText }]}>
                By creating an account, you agree to our{" "}
                <ThemedText
                  style={[styles.legalLink, { color: c.accent }]}
                  onPress={() => router.push("/legal?tab=terms" as any)}
                >
                  Terms of Service
                </ThemedText>
                {" "}and{" "}
                <ThemedText
                  style={[styles.legalLink, { color: c.accent }]}
                  onPress={() => router.push("/legal?tab=privacy" as any)}
                >
                  Privacy Policy
                </ThemedText>
                .
              </ThemedText>
            </>
          )}
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
  forgotPassword: {
    alignItems: "center",
    marginBottom: 16,
  },
  forgotPasswordText: {
    fontSize: 14,
    fontWeight: "500",
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 8,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  dividerText: {
    marginHorizontal: 12,
    fontSize: 13,
  },
  googleButton: {
    flexDirection: "row",
    justifyContent: "center",
    borderWidth: 1,
  },
  googleIcon: {
    marginRight: 10,
  },
  legalText: {
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
    marginTop: 4,
  },
  legalLink: {
    fontSize: 12,
    fontWeight: "500",
  },
  otpSubtitle: {
    fontSize: 15,
    textAlign: "center",
    marginBottom: 20,
  },
});
