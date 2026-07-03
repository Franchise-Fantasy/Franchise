import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  AppState,
  Keyboard,
  KeyboardAvoidingView,
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
import { ms, s } from '@/utils/scale';

const COLOR_PATCH = require('@/assets/images/emproidered_patch_color.png');

// Grace period before disconnecting Realtime when backgrounded (tab hidden on web).
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

// react-native-web has no multi-button Alert; use the browser's native dialogs.
function notify(title: string, message?: string) {
  if (typeof window !== 'undefined') {
    window.alert(message ? `${title}\n\n${message}` : title);
  }
}

const MODE_OPTIONS = ['Sign In', 'Create Account'] as const;
type ModeLabel = (typeof MODE_OPTIONS)[number];

/**
 * Web build of the auth screen. Mirrors the native Auth's email/password/OTP
 * flow, but signs in with Google/Apple via supabase.auth.signInWithOAuth (a
 * full-page redirect that handles PKCE itself) instead of the native
 * @react-native-google-signin / expo-apple-authentication modules, which don't
 * run in a browser. The redirect lands back on the app with the session in the
 * URL, which lib/supabase.ts consumes via detectSessionInUrl.
 *
 * DRIFT WARNING: the email/password/OTP logic here (sign-in, the sign-up
 * enumeration guard, OTP verify/resend, password reset) is a copy of
 * Auth.tsx's. Any change to that logic in either file must be mirrored in the
 * other in the same commit — until it's extracted to a shared useEmailAuth
 * hook.
 */
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
  const [showPassword, setShowPassword] = useState(false);
  const isSignUp = modeLabel === 'Create Account';

  async function routeAfterSignIn(userId: string) {
    const { data: team } = await supabase
      .from('teams')
      .select('league_id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();
    Keyboard.dismiss();
    router.replace(team?.league_id ? '/(tabs)' : '/(setup)');
  }

  async function signInWithEmail() {
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      // Unverified email: send a fresh OTP and drop into the verification step
      // rather than dead-ending.
      const isUnconfirmed =
        (error as any).code === 'email_not_confirmed'
        || /email\s+not\s+confirmed/i.test(error.message);
      if (isUnconfirmed) {
        await supabase.auth.resend({ type: 'signup', email }).catch(() => {});
        setPendingVerification(true);
        notify('Verify your email', `Enter the code we just sent to ${email} to finish signing in.`);
        setLoading(false);
        return;
      }
      notify(error.message);
      setLoading(false);
      return;
    }
    capture('sign_in', { method: 'email' });
    await routeAfterSignIn(data.session.user.id);
    setLoading(false);
  }

  async function handleResetPassword() {
    if (!email.trim()) {
      notify('Enter your email', 'Please enter your email address above, then tap Forgot Password.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      notify('Error', error.message);
    } else {
      setResetSent(true);
      notify('Check your email', `We sent a password reset link to ${email.trim()}`);
    }
  }

  async function signUpWithEmail() {
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      notify(error.message);
      setLoading(false);
      return;
    }
    // Supabase fakes success (empty `identities`) when the email already exists,
    // to prevent enumeration. Offer to switch to Sign In instead.
    if (data.user && (data.user.identities?.length ?? 0) === 0) {
      setLoading(false);
      const goSignIn =
        typeof window !== 'undefined'
        && window.confirm(
          `An account with ${email.trim()} already exists. Switch to Sign In? `
          + `(Use Forgot Password if you don't remember it.)`,
        );
      if (goSignIn) setModeLabel('Sign In');
      return;
    }
    capture('sign_up', { method: 'email' });
    setPendingVerification(true);
    setLoading(false);
  }

  async function verifyOtp() {
    if (!otpToken.trim()) {
      notify('Enter the code', 'Please enter the 8-digit code from your email.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: otpToken.trim(),
      type: 'signup',
    });
    if (error) {
      notify('Verification failed', error.message);
      setLoading(false);
      return;
    }
    Keyboard.dismiss();
    router.replace('/(setup)');
    setLoading(false);
  }

  async function resendOtp() {
    setLoading(true);
    const { error } = await supabase.auth.resend({ type: 'signup', email });
    setLoading(false);
    notify(error ? 'Error' : 'Code resent', error ? error.message : 'Check your email for a new verification code.');
  }

  async function signInWithProvider(provider: 'google' | 'apple') {
    setLoading(true);
    capture('sign_in_attempt', { method: provider });
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    // On success the browser navigates away to the provider, so nothing below
    // runs. We only land here on a failure to even start the redirect.
    if (error) {
      notify('Sign-in error', error.message);
      setLoading(false);
    }
  }

  const primaryAction = () => (isSignUp ? signUpWithEmail() : signInWithEmail());

  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingView style={styles.keyboardView}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
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
                <ThemedText type="display" style={[styles.heading, { color: c.text }]}>
                  Verify your email.
                </ThemedText>
                <ThemedText type="varsitySmall" style={[styles.subheading, { color: c.secondaryText }]}>
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
                  <BrandButton label="Resend code" onPress={resendOtp} variant="ghost" disabled={loading} />
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
                  <BrandSegmented options={MODE_OPTIONS} selected={modeLabel} onSelect={setModeLabel} noBaseline />
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
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    textContentType={isSignUp ? 'newPassword' : 'password'}
                    accessibilityLabel="Password"
                    rightAccessory={
                      <TouchableOpacity
                        onPress={() => setShowPassword((v) => !v)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                        accessibilityState={{ selected: showPassword }}
                      >
                        <Ionicons
                          name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                          size={ms(20)}
                          color={c.secondaryText}
                        />
                      </TouchableOpacity>
                    }
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

                {/* Reserved height so switching modes doesn't shift the layout. */}
                <View style={styles.forgotRow}>
                  {!isSignUp && (
                    <BrandButton
                      label={resetSent ? 'Resend reset email' : 'Forgot password?'}
                      onPress={handleResetPassword}
                      variant="ghost"
                      disabled={loading}
                      style={styles.forgotButton}
                    />
                  )}
                </View>

                {/* Divider */}
                <View style={styles.dividerRow} accessible={false}>
                  <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
                  <ThemedText type="varsitySmall" style={[styles.dividerText, { color: c.secondaryText }]}>
                    OR CONTINUE WITH
                  </ThemedText>
                  <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
                </View>

                {/* Google — white surface + colored mark per Google brand guidelines. */}
                <TouchableOpacity
                  style={styles.googleButton}
                  disabled={loading}
                  onPress={() => signInWithProvider('google')}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Sign in with Google"
                  accessibilityState={{ disabled: loading }}
                >
                  <Ionicons name="logo-google" size={ms(18)} color="#1F1F1F" style={styles.googleIcon} accessible={false} />
                  <ThemedText style={styles.googleLabel}>Sign in with Google</ThemedText>
                </TouchableOpacity>

                {/* Apple — black on light, white on dark per Apple HIG. */}
                <TouchableOpacity
                  style={[
                    styles.appleButton,
                    { backgroundColor: scheme === 'dark' ? '#FFFFFF' : '#000000' },
                  ]}
                  disabled={loading}
                  onPress={() => signInWithProvider('apple')}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Sign in with Apple"
                  accessibilityState={{ disabled: loading }}
                >
                  <Ionicons
                    name="logo-apple"
                    size={ms(18)}
                    color={scheme === 'dark' ? '#000000' : '#FFFFFF'}
                    style={styles.googleIcon}
                    accessible={false}
                  />
                  <ThemedText style={[styles.appleLabel, { color: scheme === 'dark' ? '#000000' : '#FFFFFF' }]}>
                    Sign in with Apple
                  </ThemedText>
                </TouchableOpacity>

                <ThemedText style={[styles.legalText, { color: c.secondaryText }]}>
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
          </View>
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
    alignItems: 'center',
    paddingHorizontal: s(20),
    paddingVertical: s(40),
  },
  // Constrain the form to a readable centered card on wide desktop viewports.
  card: {
    width: '100%',
    maxWidth: 440,
  },
  header: {
    alignItems: 'center',
    marginBottom: s(4),
  },
  patch: {
    width: s(300),
    height: s(300) / 1.5,
    alignSelf: 'center',
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
    justifyContent: 'center',
    minHeight: s(40),
    marginBottom: s(8),
  },
  forgotButton: {
    alignSelf: 'center',
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    paddingVertical: s(12),
    marginBottom: s(12),
  },
  appleLabel: {
    fontSize: ms(14),
    fontWeight: '500',
    letterSpacing: 0.25,
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
