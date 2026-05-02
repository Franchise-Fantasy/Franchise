import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ListRow } from '@/components/ui/ListRow';
import { Section } from '@/components/ui/Section';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Fonts } from '@/constants/Colors';
import { useSession } from '@/context/AuthProvider';
import { useConfirm } from '@/context/ConfirmProvider';
import { useColors } from '@/hooks/useColors';
import { supabase } from '@/lib/supabase';
import { ms, s } from '@/utils/scale';

export default function SetupProfileScreen() {
  const session = useSession();
  const router = useRouter();
  const c = useColors();
  const confirm = useConfirm();
  const [loading, setLoading] = useState(false);

  const userEmail = session?.user?.email ?? 'Unknown';

  async function handleSignOut() {
    setLoading(true);
    const { error } = await supabase.auth.signOut();

    const keys = await AsyncStorage.getAllKeys();
    const supabaseKeys = keys.filter((k) => k.startsWith('sb-'));
    if (supabaseKeys.length > 0) {
      await AsyncStorage.multiRemove(supabaseKeys);
    }

    setLoading(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      router.replace('/auth');
    }
  }

  async function handleDeleteAccount() {
    confirm({
      title: 'Delete Account',
      message:
        'This will permanently delete your account and all associated data. This cannot be undone.',
      requireTypedConfirmation: 'delete',
      action: {
        label: 'Delete',
        destructive: true,
        onPress: async () => {
          setLoading(true);
          try {
            const {
              data: { session: currentSession },
            } = await supabase.auth.getSession();
            const { error } = await supabase.functions.invoke('delete-account', {
              headers: {
                Authorization: `Bearer ${currentSession?.access_token}`,
              },
            });
            if (error) throw error;

            const keys = await AsyncStorage.getAllKeys();
            const supabaseKeys = keys.filter((k) => k.startsWith('sb-'));
            if (supabaseKeys.length > 0) {
              await AsyncStorage.multiRemove(supabaseKeys);
            }
            await supabase.auth.signOut();
            router.replace('/auth');
          } catch (err: any) {
            Alert.alert('Error', err.message ?? 'Failed to delete account');
          } finally {
            setLoading(false);
          }
        },
      },
    });
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ─── Identity hero — full-bleed turfGreen banner ─────────────── */}
        <View
          style={[styles.hero, { backgroundColor: c.primary }]}
          accessibilityLabel={`Account: ${userEmail}`}
        >
          <View style={[styles.heroRule, { backgroundColor: c.gold }]} />

          <View style={styles.heroBody}>
            <View
              style={[
                styles.avatar,
                {
                  backgroundColor: Brand.ecru,
                  borderColor: c.gold,
                },
              ]}
            >
              <ThemedText
                type="display"
                style={[styles.avatarText, { color: Brand.ink }]}
              >
                {userEmail.charAt(0).toUpperCase()}
              </ThemedText>
            </View>

            <View style={styles.heroIdentity}>
              <ThemedText
                type="varsitySmall"
                style={[styles.heroEyebrow, { color: c.gold }]}
              >
                WELCOME
              </ThemedText>
              <ThemedText
                type="display"
                style={[styles.heroName, { color: Brand.ecru }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
                accessibilityRole="header"
              >
                Your Account
              </ThemedText>
              <ThemedText
                type="varsitySmall"
                style={[styles.heroEmail, { color: Brand.ecruMuted }]}
                numberOfLines={1}
              >
                {userEmail}
              </ThemedText>
            </View>
          </View>

          <View style={[styles.heroRule, { backgroundColor: c.gold }]} />
        </View>

        <View style={styles.sectionsWrap}>
          {/* ─── Legal ──────────────────────────────────────────────── */}
          <Section title="Legal">
            <ListRow
              index={0}
              total={2}
              onPress={() => router.push('/legal?tab=terms' as any)}
              accessibilityLabel="Terms of Service"
            >
              <View style={styles.rowContent}>
                <View style={styles.rowLeft}>
                  <Ionicons
                    name="document-text-outline"
                    size={ms(18)}
                    color={c.text}
                    accessible={false}
                  />
                  <ThemedText style={[styles.rowLabel, { color: c.text }]}>
                    Terms of Service
                  </ThemedText>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={ms(16)}
                  color={c.secondaryText}
                  accessible={false}
                />
              </View>
            </ListRow>
            <ListRow
              index={1}
              total={2}
              onPress={() => router.push('/legal?tab=privacy' as any)}
              accessibilityLabel="Privacy Policy"
            >
              <View style={styles.rowContent}>
                <View style={styles.rowLeft}>
                  <Ionicons
                    name="shield-checkmark-outline"
                    size={ms(18)}
                    color={c.text}
                    accessible={false}
                  />
                  <ThemedText style={[styles.rowLabel, { color: c.text }]}>
                    Privacy Policy
                  </ThemedText>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={ms(16)}
                  color={c.secondaryText}
                  accessible={false}
                />
              </View>
            </ListRow>
          </Section>

          {/* ─── Account ────────────────────────────────────────────── */}
          <Section title="Account">
            <ListRow
              index={0}
              total={2}
              onPress={handleSignOut}
              accessibilityLabel="Sign Out"
              accessibilityHint={loading ? 'Signing out…' : undefined}
            >
              <View style={styles.rowContent}>
                <View style={styles.rowLeft}>
                  <Ionicons
                    name="log-out-outline"
                    size={ms(18)}
                    color={c.text}
                    accessible={false}
                  />
                  <ThemedText style={[styles.rowLabel, { color: c.text }]}>
                    Sign Out
                  </ThemedText>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={ms(16)}
                  color={c.secondaryText}
                  accessible={false}
                />
              </View>
            </ListRow>
            <ListRow
              index={1}
              total={2}
              onPress={handleDeleteAccount}
              accessibilityLabel="Delete Account"
              accessibilityHint="Permanently deletes your account and all data"
            >
              <View style={styles.rowContent}>
                <View style={styles.rowLeft}>
                  <Ionicons
                    name="trash-outline"
                    size={ms(18)}
                    color={c.danger}
                    accessible={false}
                  />
                  <ThemedText style={[styles.rowLabel, { color: c.danger }]}>
                    Delete Account
                  </ThemedText>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={ms(16)}
                  color={c.secondaryText}
                  accessible={false}
                />
              </View>
            </ListRow>
          </Section>

          {/* ─── Version footer ─────────────────────────────────────── */}
          <View style={styles.versionWrap}>
            <View style={[styles.versionRule, { backgroundColor: c.border }]} />
            <ThemedText
              type="varsitySmall"
              style={[styles.versionText, { color: c.secondaryText }]}
            >
              FRANCHISE · V2.0.0
            </ThemedText>
            <View style={[styles.versionRule, { backgroundColor: c.border }]} />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: s(40),
  },

  // ─── Identity hero ───
  hero: {
    paddingVertical: s(8),
    marginTop: s(8),
    marginBottom: s(20),
  },
  heroRule: {
    height: 2,
    marginHorizontal: s(20),
  },
  heroBody: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: s(20),
    paddingVertical: s(18),
    gap: s(16),
  },
  avatar: {
    width: s(72),
    height: s(72),
    borderRadius: s(36),
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarText: {
    fontFamily: Fonts.display,
    fontSize: ms(30),
    lineHeight: ms(36),
    letterSpacing: -0.3,
  },
  heroIdentity: {
    flex: 1,
    minWidth: 0,
    gap: s(4),
  },
  heroEyebrow: {
    fontSize: ms(10),
    letterSpacing: 1.6,
  },
  heroName: {
    fontFamily: Fonts.display,
    fontSize: ms(22),
    lineHeight: ms(26),
    letterSpacing: -0.3,
  },
  heroEmail: {
    fontSize: ms(10),
    letterSpacing: 1.3,
  },

  // ─── Sections wrap ───
  sectionsWrap: {
    paddingHorizontal: s(16),
  },

  // ─── List rows ───
  rowContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: s(12),
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    flexShrink: 1,
  },
  rowLabel: {
    fontSize: ms(15),
    flexShrink: 1,
  },

  // ─── Version footer ───
  versionWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(12),
    paddingHorizontal: s(40),
    marginTop: s(8),
  },
  versionRule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  versionText: {
    fontSize: ms(10),
    letterSpacing: 1.4,
  },
});
