import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { BrandButton } from '@/components/ui/BrandButton';
import { BrandTextInput } from '@/components/ui/BrandTextInput';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import { Fonts } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { supabase } from '@/lib/supabase';
import { ms, s } from '@/utils/scale';

const COLOR_PATCH = require('@/assets/images/emproidered_patch_color.png');

export default function ResetPasswordScreen() {
  const c = useColors();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  // Session is established by _layout.tsx before navigating here.
  // Just verify we have an active session.
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setSessionReady(true);
      } else {
        Alert.alert('Invalid link', 'No reset session found.', [
          { text: 'OK', onPress: () => router.replace('/auth') },
        ]);
      }
    });
  }, []);

  async function handleUpdatePassword() {
    if (password.length < 6) {
      Alert.alert('Password too short', 'Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      Alert.alert("Passwords don't match", 'Please make sure both passwords are the same.');
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.auth.updateUser({ password });

    if (error) {
      setLoading(false);
      Alert.alert('Error', error.message);
      return;
    }

    // User already has a valid session — skip /auth and go straight to the app.
    // Avoids a racy replace chain that left the tab navigator frozen.
    const userId = data.user?.id;
    let destination: '/(tabs)' | '/(setup)' = '/(setup)';
    if (userId) {
      const { data: team } = await supabase
        .from('teams')
        .select('league_id')
        .eq('user_id', userId)
        .limit(1)
        .single();
      destination = team?.league_id ? '/(tabs)' : '/(setup)';
    }
    setLoading(false);

    Alert.alert('Password updated', 'Your password has been reset successfully.', [
      { text: 'OK', onPress: () => router.replace(destination) },
    ]);
  }

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
          {/* Header — embroidered patch hero (matches auth.tsx) */}
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

          <ThemedText type="display" style={[styles.heading, { color: c.text }]}>
            Reset password.
          </ThemedText>
          <ThemedText
            type="varsitySmall"
            style={[styles.subheading, { color: c.secondaryText }]}
          >
            {sessionReady ? 'Choose a new password' : 'Verifying reset link'}
          </ThemedText>

          {!sessionReady ? (
            <View style={styles.spinnerWrap}>
              <LogoSpinner />
            </View>
          ) : (
            <>
              <View style={styles.formField}>
                <BrandTextInput
                  label="New password"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="At least 6 characters"
                  secureTextEntry
                  autoCapitalize="none"
                  textContentType="newPassword"
                  accessibilityLabel="New password"
                />
              </View>
              <View style={styles.formField}>
                <BrandTextInput
                  label="Confirm password"
                  value={confirm}
                  onChangeText={setConfirm}
                  placeholder="Re-enter password"
                  secureTextEntry
                  autoCapitalize="none"
                  textContentType="newPassword"
                  accessibilityLabel="Confirm new password"
                />
              </View>

              <BrandButton
                label="Update Password"
                onPress={handleUpdatePassword}
                loading={loading}
                disabled={loading}
                fullWidth
                style={styles.primaryButton}
              />

              <View style={styles.linkRow}>
                <BrandButton
                  label="Back to sign in"
                  onPress={() => router.replace('/auth')}
                  variant="ghost"
                  disabled={loading}
                />
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  keyboardView: { flex: 1 },
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
  spinnerWrap: {
    alignItems: 'center',
    marginTop: s(16),
  },
  formField: {
    marginBottom: s(12),
  },
  primaryButton: {
    marginTop: s(4),
    marginBottom: s(8),
  },
  linkRow: {
    alignItems: 'center',
    marginTop: s(4),
  },
});
