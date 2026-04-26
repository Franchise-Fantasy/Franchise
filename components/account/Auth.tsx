import { Ionicons } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

import { BrandButton } from '@/components/ui/BrandButton';
import { BrandSegmented } from '@/components/ui/BrandSegmented';
import { BrandTextInput } from '@/components/ui/BrandTextInput';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import { Fonts } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { capture } from '@/lib/posthog';
import { supabase } from '@/lib/supabase';
import { isExpoGo } from '@/utils/buildConfig';
import { ms, s } from '@/utils/scale';

const COLOR_PATCH = require('@/assets/images/emproidered_patch_color.png');

// Grace period before disconnecting Realtime when backgrounded.
let realtimeDisconnectTimer: ReturnType<typeof setTimeout> | null = null;
const REALTIME_GRACE_MS = 15_000;

AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();

    if (realtimeDisconnectTimer) {
      clearTimeout(realtimeDisconnectTimer);
      realtimeDisconnectTimer = null;
    }
    if (!supabase.realtime.isConnected()) {
      supabase.realtime.connect();
    }
  } else {
    supabase.auth.stopAutoRefresh();

    if (!realtimeDisconnectTimer) {
      realtimeDisconnectTimer = setTimeout(() => {
        realtimeDisconnectTimer = null;
        supabase.realtime.disconnect();
      }, REALTIME_GRACE_MS);
    }
  }
});

// Lazy-load Google Sign-In to avoid crash in Expo Go (native module not available)
let GoogleSignin: any = null;
let statusCodes: any = {};
let GOOGLE_ENABLED = false;

try {
  const mod = require('@react-native-google-signin/google-signin');
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

const MODE_OPTIONS = ['Sign In', 'Create Account'] as const;
type ModeLabel = (typeof MODE_OPTIONS)[number];

export default function Auth() {
  const c = useColors();
  const scheme = useColorScheme() ?? 'light';
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [otpToken, setOtpToken] = useState('');
  const [pendingVerification, setPendingVerification] = useState(false);
  const [modeLabel, setModeLabel] = useState<ModeLabel>('Sign In');
  const isSignUp = modeLabel === 'Create Account';

  async function signInWithEmail() {
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      // When email confirmation is required and the user signs in before
      // verifying, Supabase returns "Email not confirmed". Send a fresh
      // OTP and drop into the existing verification screen instead of
      // showing a dead-end alert.
      const isUnconfirmed =
        (error as any).code === 'email_not_confirmed'
        || /email\s+not\s+confirmed/i.test(error.message);
      if (isUnconfirmed) {
        await supabase.auth.resend({ type: 'signup', email }).catch(() => {});
        setPendingVerification(true);
        Alert.alert(
          'Verify your email',
          `Enter the code we just sent to ${email} to finish signing in.`,
        );
        setLoading(false);
        return;
      }
      Alert.alert(error.message);
      setLoading(false);
      return;
    }

    const { data: team } = await supabase
      .from('teams')
      .select('league_id')
      .eq('user_id', data.session.user.id)
      .limit(1)
      .maybeSingle();

    capture('sign_in', { method: 'email' });
    router.replace(team?.league_id ? '/(tabs)' : '/(setup)');
    setLoading(false);
  }

  async function handleResetPassword() {
    if (!email.trim()) {
      Alert.alert(
        'Enter your email',
        'Please enter your email address above, then tap Forgot Password.',
      );
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: 'franchisev2://reset-password',
    });
    setLoading(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setResetSent(true);
      Alert.alert('Check your email', `We sent a password reset link to ${email.trim()}`);
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
    capture('sign_up', { method: 'email' });
    setPendingVerification(true);
    setLoading(false);
  }

  async function verifyOtp() {
    if (!otpToken.trim()) {
      Alert.alert('Enter the code', 'Please enter the 8-digit code from your email.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: otpToken.trim(),
      type: 'signup',
    });
    if (error) {
      Alert.alert('Verification failed', error.message);
      setLoading(false);
      return;
    }
    router.replace('/(setup)');
    setLoading(false);
  }

  async function resendOtp() {
    setLoading(true);
    const { error } = await supabase.auth.resend({ type: 'signup', email });
    setLoading(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      Alert.alert('Code resent', 'Check your email for a new verification code.');
    }
  }

  async function signInWithGoogle() {
    if (!GOOGLE_ENABLED) return;
    setLoading(true);
    try {
      if (Platform.OS === 'android') await GoogleSignin.hasPlayServices();

      const rawNonce = Crypto.getRandomValues(new Uint8Array(16)).reduce(
        (str: string, b: number) => str + b.toString(16).padStart(2, '0'),
        '',
      );
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce,
      );

      const response = await GoogleSignin.signIn({ nonce: hashedNonce });

      if (!response.data?.idToken) {
        Alert.alert('Google Sign-In failed', 'No ID token returned.');
        setLoading(false);
        return;
      }

      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: response.data.idToken,
        nonce: rawNonce,
      });

      if (error) {
        Alert.alert('Sign-in error', error.message);
        setLoading(false);
        return;
      }

      const { data: team } = await supabase
        .from('teams')
        .select('league_id')
        .eq('user_id', data.session.user.id)
        .limit(1)
        .single();

      capture('sign_in', { method: 'google' });
      router.replace(team?.league_id ? '/(tabs)' : '/(setup)');
    } catch (err: any) {
      if (
        err.code === statusCodes.SIGN_IN_CANCELLED ||
        err.code === statusCodes.IN_PROGRESS
      ) {
        // User cancelled or already in progress — do nothing
      } else {
        Alert.alert('Google Sign-In failed', err.message ?? 'Unknown error');
      }
    } finally {
      setLoading(false);
    }
  }

  async function signInWithApple() {
    setLoading(true);
    try {
      const rawNonce = Crypto.getRandomValues(new Uint8Array(16)).reduce(
        (str: string, b: number) => str + b.toString(16).padStart(2, '0'),
        '',
      );
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce,
      );

      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });

      if (!credential.identityToken) {
        Alert.alert('Apple Sign-In failed', 'No identity token returned.');
        setLoading(false);
        return;
      }

      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
        nonce: rawNonce,
      });

      if (error) {
        Alert.alert('Sign-in error', error.message);
        setLoading(false);
        return;
      }

      const { data: team } = await supabase
        .from('teams')
        .select('league_id')
        .eq('user_id', data.session.user.id)
        .limit(1)
        .single();

      capture('sign_in', { method: 'apple' });
      router.replace(team?.league_id ? '/(tabs)' : '/(setup)');
    } catch (err: any) {
      if (err.code === 'ERR_REQUEST_CANCELED') {
        // User cancelled — do nothing
      } else {
        Alert.alert('Apple Sign-In failed', err.message ?? 'Unknown error');
      }
    } finally {
      setLoading(false);
    }
  }

  const primaryAction = () => {
    if (isSignUp) {
      signUpWithEmail();
    } else {
      signInWithEmail();
    }
  };

  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header — embroidered patch hero */}
          <View style={styles.header}>
            <Image
              source={COLOR_PATCH}
              style={styles.patch}
              contentFit="contain"
              cachePolicy="memory-disk"
              accessibilityLabel="Franchise"
              accessibilityRole="image"
            />
          </View>

          {pendingVerification ? (
            <>
              <ThemedText
                type="display"
                style={[styles.heading, { color: c.text }]}
              >
                Verify your email.
              </ThemedText>
              <ThemedText
                type="varsitySmall"
                style={[styles.subheading, { color: c.secondaryText }]}
              >
                {`8-DIGIT CODE SENT TO ${email.toUpperCase()}`}
              </ThemedText>

              <View style={styles.formField}>
                <BrandTextInput
                  value={otpToken}
                  onChangeText={setOtpToken}
                  placeholder="00000000"
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  autoComplete="one-time-code"
                  maxLength={8}
                  autoFocus
                  accessibilityLabel="Verification code"
                  accessibilityHint="Enter the 8-digit code from your email"
                  inputStyle={styles.otpInput}
                />
              </View>

              <BrandButton
                label="Verify"
                onPress={verifyOtp}
                loading={loading}
                disabled={loading}
                fullWidth
                style={styles.primaryButton}
              />

              <View style={styles.linkRow}>
                <BrandButton
                  label="Resend code"
                  onPress={resendOtp}
                  variant="ghost"
                  disabled={loading}
                />
                <BrandButton
                  label="Back to sign in"
                  onPress={() => {
                    setPendingVerification(false);
                    setOtpToken('');
                  }}
                  variant="ghost"
                />
              </View>
            </>
          ) : (
            <>
              {/* Mode tabs */}
              <View style={styles.modeWrap}>
                <BrandSegmented
                  options={MODE_OPTIONS}
                  selected={modeLabel}
                  onSelect={setModeLabel}
                  noBaseline
                />
              </View>

              {/* Form */}
              <View style={styles.formField}>
                <BrandTextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Email"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  accessibilityLabel="Email"
                />
              </View>
              <View style={styles.formField}>
                <BrandTextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Password"
                  secureTextEntry
                  autoCapitalize="none"
                  textContentType={isSignUp ? 'newPassword' : 'password'}
                  accessibilityLabel="Password"
                />
              </View>

              <BrandButton
                label={isSignUp ? 'Create Account' : 'Sign In'}
                onPress={primaryAction}
                loading={loading}
                disabled={loading}
                fullWidth
                style={styles.primaryButton}
              />

              {!isSignUp && !isExpoGo && (
                <View style={styles.forgotRow}>
                  <BrandButton
                    label={resetSent ? 'Resend reset email' : 'Forgot password?'}
                    onPress={handleResetPassword}
                    variant="ghost"
                    disabled={loading}
                  />
                </View>
              )}

              {/* Divider */}
              <View style={styles.dividerRow} accessible={false}>
                <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
                <ThemedText
                  type="varsitySmall"
                  style={[styles.dividerText, { color: c.secondaryText }]}
                >
                  OR CONTINUE WITH
                </ThemedText>
                <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
              </View>

              {/* Google Sign-In — must follow Google's brand guidelines:
                  white surface, colored "G" mark, specific text. Cannot be
                  themed with the Franchise brand without violating their
                  policy. Greyed when not configured. */}
              <TouchableOpacity
                style={[
                  styles.googleButton,
                  { opacity: GOOGLE_ENABLED ? 1 : 0.4 },
                ]}
                disabled={!GOOGLE_ENABLED || loading}
                onPress={signInWithGoogle}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Sign in with Google"
                accessibilityHint={GOOGLE_ENABLED ? undefined : 'Coming soon'}
                accessibilityState={{ disabled: !GOOGLE_ENABLED || loading }}
              >
                <Ionicons
                  name="logo-google"
                  size={ms(18)}
                  color="#1F1F1F"
                  style={styles.googleIcon}
                  accessible={false}
                />
                <ThemedText style={styles.googleLabel}>
                  Sign in with Google
                </ThemedText>
              </TouchableOpacity>

              {/* Apple Sign-In — iOS only (App Store guideline requirement).
                  Uses Apple's native button per their HIG: BLACK on light
                  surfaces, WHITE on dark surfaces. Cannot be themed with
                  the Franchise brand without violating Apple's policy. */}
              {Platform.OS === 'ios' && (
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={
                    isSignUp
                      ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP
                      : AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
                  }
                  buttonStyle={
                    scheme === 'dark'
                      ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                      : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                  }
                  cornerRadius={10}
                  style={styles.appleButton}
                  onPress={signInWithApple}
                />
              )}

              <ThemedText
                style={[styles.legalText, { color: c.secondaryText }]}
              >
                By creating an account, you agree to our{' '}
                <ThemedText
                  style={[styles.legalLink, { color: c.gold }]}
                  onPress={() => router.push('/legal?tab=terms' as any)}
                  accessibilityRole="link"
                >
                  Terms of Service
                </ThemedText>
                {' '}and{' '}
                <ThemedText
                  style={[styles.legalLink, { color: c.gold }]}
                  onPress={() => router.push('/legal?tab=privacy' as any)}
                  accessibilityRole="link"
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
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: s(20),
    paddingVertical: s(40),
  },
  header: {
    alignItems: 'center',
    marginBottom: s(4),
  },
  patch: {
    width: s(300),
    height: s(300) / 1.5,
  },
  heading: {
    fontFamily: Fonts.display,
    fontSize: ms(26),
    lineHeight: ms(30),
    letterSpacing: -0.3,
    textAlign: 'center',
    marginBottom: s(6),
  },
  subheading: {
    fontSize: ms(11),
    letterSpacing: 1.4,
    textAlign: 'center',
    marginBottom: s(20),
  },
  modeWrap: {
    marginBottom: s(8),
  },
  formField: {
    marginBottom: s(12),
  },
  otpInput: {
    fontSize: ms(22),
    fontWeight: '600',
    letterSpacing: 8,
    textAlign: 'center',
  },
  primaryButton: {
    marginTop: s(4),
    marginBottom: s(8),
  },
  forgotRow: {
    alignItems: 'center',
    marginBottom: s(8),
  },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: s(4),
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    marginVertical: s(14),
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  dividerText: {
    fontSize: ms(10),
    letterSpacing: 1.4,
  },
  // Google Sign-In — fixed colors per Google brand guidelines (white
  // surface, dark text, colored G icon). Cannot be themed with brand
  // tokens.
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#DADCE0',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: s(12),
    marginBottom: s(8),
  },
  googleIcon: {
    marginRight: s(10),
  },
  googleLabel: {
    fontSize: ms(14),
    fontWeight: '500',
    color: '#1F1F1F',
    letterSpacing: 0.25,
  },
  appleButton: {
    width: '100%',
    height: s(48),
    marginTop: s(4),
    marginBottom: s(12),
  },
  legalText: {
    fontSize: ms(11),
    textAlign: 'center',
    lineHeight: ms(17),
    marginTop: s(12),
  },
  legalLink: {
    fontSize: ms(11),
    fontWeight: '500',
  },
});
