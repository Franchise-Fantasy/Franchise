import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import * as Updates from 'expo-updates';
import { useEffect, useState } from 'react';
import {
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { UpgradeModal } from '@/components/account/UpgradeModal';
import { TeamLogoPickerModal } from '@/components/team/TeamLogoPickerModal';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { ListRow } from '@/components/ui/ListRow';
import { Section } from '@/components/ui/Section';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Fonts } from '@/constants/Colors';
import { PAYWALL_ENABLED, TIER_LABELS, type SubscriptionTier } from '@/constants/Subscriptions';
import { useAppState } from '@/context/AppStateProvider';
import { useSession } from '@/context/AuthProvider';
import { useConfirm, useTextPrompt } from '@/context/ConfirmProvider';
import { globalToastRef } from '@/context/ToastProvider';
import { useColors } from '@/hooks/useColors';
import { useLeague } from '@/hooks/useLeague';
import { useProjectionToggle } from '@/hooks/useProjectionToggle';
import { useSubscription } from '@/hooks/useSubscription';
import {
  getPushPrefs,
  registerPushToken,
  unregisterPushToken,
} from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { isExpoGo } from '@/utils/buildConfig';
import { isArchiveFlagOn, isNflArchiveFlagOn, isNhlArchiveFlagOn } from '@/utils/featureFlags';
import { logger } from '@/utils/logger';
import { containsBlockedContent } from '@/utils/moderation';
import { ms, s } from '@/utils/scale';

const PATCH_SOURCE = require('../../assets/images/patch_logo.png');

function tierBadgeVariant(tier: SubscriptionTier): BadgeVariant {
  if (tier === 'premium') return 'gold';
  if (tier === 'pro') return 'turf';
  return 'neutral';
}

export default function ProfileScreen() {
  const session = useSession();
  const router = useRouter();
  const c = useColors();
  const confirm = useConfirm();
  const promptInput = useTextPrompt();
  const { teamId } = useAppState();
  const { data: league } = useLeague();
  const { enabled: projectionsEnabled, setEnabled: setProjectionsEnabled } =
    useProjectionToggle();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [showLogoPicker, setShowLogoPicker] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  const userId = session?.user?.id;
  const myTeam = (league?.league_teams ?? []).find((t: any) => t.id === teamId);
  const myLogoKey = myTeam?.logo_key ?? null;
  const myTeamName = myTeam?.name ?? '';
  const myTricode = myTeam?.tricode ?? '';
  const { tier, individualPeriod, leagueTier, leaguePeriod } = useSubscription();
  const userEmail = session?.user?.email ?? 'Unknown';
  const isCommissioner = session?.user?.id === league?.created_by;

  // Manual OTA update check (tap the version footer). Updates also apply
  // silently on the next cold start via expo-updates' default ON_LOAD — this
  // is a visible way to pull one on demand and confirm delivery is working.
  async function checkForOtaUpdate() {
    if (isExpoGo) {
      globalToastRef.current?.('info', 'Updates are disabled in Expo Go.');
      return;
    }
    try {
      globalToastRef.current?.('info', 'Checking for updates…');
      const update = await Updates.checkForUpdateAsync();
      if (!update.isAvailable) {
        globalToastRef.current?.('success', 'You’re on the latest version.');
        return;
      }
      await Updates.fetchUpdateAsync();
      // The update is downloaded now and will apply on the next cold start
      // regardless. We also offer an immediate restart: tapped here — mid-
      // session, past the launch window — reloadAsync sidesteps the first-
      // startup crash in expo/expo#21347. If the restart still misbehaves,
      // reopening the app applies the already-downloaded update.
      confirm({
        title: 'Update ready',
        message: 'A new version downloaded. Restart now to apply it, or just reopen the app later.',
        cancelLabel: 'Later',
        action: { label: 'Restart', onPress: () => Updates.reloadAsync() },
      });
    } catch {
      globalToastRef.current?.('error', 'Could not check for updates.');
    }
  }

  function handleEditTeamName() {
    if (!teamId) return;
    promptInput({
      title: 'Edit Team Name',
      message: 'Enter your new team name',
      defaultValue: myTeamName,
      maxLength: 30,
      action: {
        label: 'Save',
        onSubmit: async (value) => {
          const name = value.trim();
          if (!name) return;
          if (name.length > 30) {
            Alert.alert('Too long', 'Team name must be 30 characters or fewer.');
            return;
          }
          if (containsBlockedContent(name)) {
            Alert.alert(
              'Invalid name',
              'That team name contains language that isn’t allowed.',
            );
            return;
          }
          const { error } = await supabase
            .from('teams')
            .update({ name })
            .eq('id', teamId);
          if (error) {
            Alert.alert('Error', error.message);
            return;
          }
          queryClient.invalidateQueries({ queryKey: ['league'] });
        },
      },
    });
  }

  function handleEditTricode() {
    if (!teamId) return;
    promptInput({
      title: 'Edit Tricode',
      message: '2-4 characters (letters/numbers)',
      defaultValue: myTricode,
      maxLength: 4,
      autoCapitalize: 'characters',
      action: {
        label: 'Save',
        onSubmit: async (value) => {
          const code = value.trim().toUpperCase();
          if (
            !code ||
            code.length < 2 ||
            code.length > 4 ||
            !/^[A-Z0-9]+$/.test(code)
          ) {
            Alert.alert('Invalid tricode', 'Must be 2-4 letters/numbers.');
            return;
          }
          const { error } = await supabase
            .from('teams')
            .update({ tricode: code })
            .eq('id', teamId);
          if (error) {
            Alert.alert('Error', error.message);
            return;
          }
          queryClient.invalidateQueries({ queryKey: ['league'] });
        },
      },
    });
  }

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getPushPrefs(userId)
      .then(({ enabled }) => {
        if (!cancelled) setNotificationsEnabled(enabled);
      })
      .catch((err) => {
        logger.warn('getPushPrefs failed', err);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function handleNotificationsToggle(value: boolean) {
    if (!userId) return;
    if (value) {
      const success = await registerPushToken(userId);
      if (success) setNotificationsEnabled(true);
    } else {
      await unregisterPushToken(userId);
      setNotificationsEnabled(false);
    }
  }

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
            Alert.alert(
              'Error',
              err.message ?? 'Failed to delete account. Please try again.',
            );
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
        {/* ─── Identity hero ─────────────────────────────────────────────── */}
        {/* Same chrome family as RosterHero: green heroSurface + gold corner
            rule + patch watermark + cardShadow + rounded card. */}
        <View
          style={[styles.hero, { backgroundColor: c.heroSurface }, c.heroShadow]}
          accessibilityLabel={`Profile for ${myTeamName || userEmail}${isCommissioner ? ', commissioner' : ''}`}
        >
          <ExpoImage
            source={PATCH_SOURCE}
            style={styles.heroPatch}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={0}
            accessible={false}
          />
          <View style={[styles.heroRule, { backgroundColor: c.gold }]} />

          <View style={styles.heroBody}>
            <TouchableOpacity
              onPress={() => {
                if (teamId) setShowLogoPicker(true);
              }}
              disabled={!teamId}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={
                myLogoKey
                  ? `${myTeamName} logo, tap to change`
                  : 'Set team logo'
              }
            >
              <View>
                {myLogoKey?.startsWith('http') ? (
                  <Image
                    source={{ uri: myLogoKey }}
                    style={[styles.avatar, { borderColor: c.gold }]}
                  />
                ) : (
                  <View
                    style={[
                      styles.avatar,
                      styles.avatarFallback,
                      { backgroundColor: Brand.ecru, borderColor: c.gold },
                    ]}
                  >
                    <ThemedText
                      type="display"
                      style={[styles.avatarText, { color: Brand.ink }]}
                      allowFontScaling={false}
                    >
                      {(myTeamName || userEmail).charAt(0).toUpperCase()}
                    </ThemedText>
                  </View>
                )}
                {teamId && (
                  <View
                    style={[
                      styles.avatarEditBadge,
                      { backgroundColor: c.gold, borderColor: c.primary },
                    ]}
                  >
                    <Ionicons name="pencil" size={ms(11)} color={Brand.ink} />
                  </View>
                )}
              </View>
            </TouchableOpacity>

            <View style={styles.heroIdentity}>
              <ThemedText
                type="varsitySmall"
                style={[styles.heroEyebrow, { color: c.gold }]}
              >
                {isCommissioner ? 'COMMISSIONER' : 'MANAGER'}
              </ThemedText>
              <ThemedText
                type="display"
                style={[styles.heroName, { color: Brand.ecru }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
                accessibilityRole="header"
              >
                {myTeamName || 'Your Team'}
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
        </View>

        <View style={styles.sectionsWrap}>

        {/* ─── League ──────────────────────────────────────────────────────── */}
        {league &&
          (() => {
            const rows: { node: React.ReactNode }[] = [
              {
                node: (
                  <SettingRowContent
                    icon="trophy-outline"
                    label="League Name"
                    value={league.name}
                  />
                ),
              },
              {
                node: (
                  <SettingRowContent
                    icon="people-outline"
                    label="Teams"
                    value={`${league.current_teams ?? 0} / ${league.teams ?? '?'}`}
                  />
                ),
              },
              {
                node: (
                  <SettingRowContent
                    icon="shield-outline"
                    label="Visibility"
                    value={league.private ? 'Private' : 'Public'}
                  />
                ),
              },
            ];

            if (myTeam) {
              rows.push({
                node: (
                  <SettingRowContent
                    icon="shirt-outline"
                    label="Team Name"
                    value={myTeamName || '—'}
                    editable
                  />
                ),
              });
              rows.push({
                node: (
                  <SettingRowContent
                    icon="text-outline"
                    label="Tricode"
                    value={myTricode || '—'}
                    editable
                  />
                ),
              });
            }

            return (
              <Section title="League">
                {rows.map((row, idx) => {
                  const isTeamName = idx === 3 && myTeam;
                  const isTricode = idx === 4 && myTeam;
                  const onPress = isTeamName
                    ? handleEditTeamName
                    : isTricode
                      ? handleEditTricode
                      : undefined;
                  return (
                    <ListRow
                      key={idx}
                      index={idx}
                      total={rows.length}
                      onPress={onPress}
                      accessibilityLabel={
                        onPress ? `Edit ${idx === 3 ? 'team name' : 'tricode'}` : undefined
                      }
                    >
                      {row.node}
                    </ListRow>
                  );
                })}
              </Section>
            );
          })()}

        {/* ─── Subscription ────────────────────────────────────────────────── */}
        {/* Hidden pre-launch — see PAYWALL_ENABLED. */}
        {PAYWALL_ENABLED && (
        <Section title="Subscription">
          <ListRow index={0} total={leagueTier ? 3 : 2}>
            <View style={styles.rowContent}>
              <View style={styles.rowLeft}>
                <Ionicons
                  name="diamond-outline"
                  size={ms(18)}
                  color={c.secondaryText}
                  accessible={false}
                />
                <ThemedText style={[styles.rowLabel, { color: c.secondaryText }]}>
                  Current Plan
                </ThemedText>
              </View>
              <View style={styles.rowRight}>
                <Badge
                  label={`${TIER_LABELS[tier].toUpperCase()}${tier !== 'free' && individualPeriod ? ` · ${individualPeriod.toUpperCase()}` : ''}`}
                  variant={tierBadgeVariant(tier)}
                  size="small"
                />
              </View>
            </View>
          </ListRow>

          {leagueTier && (
            <ListRow index={1} total={3}>
              <View style={styles.rowContent}>
                <View style={styles.rowLeft}>
                  <Ionicons
                    name="people-outline"
                    size={ms(18)}
                    color={c.secondaryText}
                    accessible={false}
                  />
                  <ThemedText style={[styles.rowLabel, { color: c.secondaryText }]}>
                    League Plan
                  </ThemedText>
                </View>
                <View style={styles.rowRight}>
                  <Badge
                    label={`${TIER_LABELS[leagueTier].toUpperCase()}${leaguePeriod ? ` · ${leaguePeriod.toUpperCase()}` : ''}`}
                    variant={tierBadgeVariant(leagueTier)}
                    size="small"
                  />
                </View>
              </View>
            </ListRow>
          )}

          <ListRow
            index={leagueTier ? 2 : 1}
            total={leagueTier ? 3 : 2}
            onPress={() => setShowUpgradeModal(true)}
            accessibilityLabel={tier === 'free' ? 'Upgrade Plan' : 'Manage Plan'}
          >
            <View style={styles.rowContent}>
              <View style={styles.rowLeft}>
                <Ionicons
                  name={
                    tier === 'free' ? 'arrow-up-circle-outline' : 'settings-outline'
                  }
                  size={ms(18)}
                  color={tier === 'free' ? c.gold : c.text}
                  accessible={false}
                />
                <ThemedText
                  style={[
                    styles.rowLabel,
                    { color: tier === 'free' ? c.gold : c.text },
                  ]}
                >
                  {tier === 'free' ? 'Upgrade Plan' : 'Manage Plan'}
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
        )}

        {/* ─── Notifications ───────────────────────────────────────────────── */}
        <Section title="Notifications">
          <ListRow index={0} total={notificationsEnabled ? 2 : 1}>
            <View style={styles.rowContent}>
              <View style={styles.rowLeft}>
                <Ionicons
                  name="notifications-outline"
                  size={ms(18)}
                  color={c.text}
                  accessible={false}
                />
                <ThemedText style={[styles.rowLabel, { color: c.text }]}>
                  Push Notifications
                </ThemedText>
              </View>
              <Switch
                value={notificationsEnabled}
                onValueChange={handleNotificationsToggle}
                trackColor={{ false: c.border, true: c.accent }}
                thumbColor={Platform.OS === 'android' ? '#FFFFFF' : undefined}
                ios_backgroundColor={c.border}
                accessibilityLabel="Push Notifications"
                accessibilityRole="switch"
                accessibilityState={{ checked: notificationsEnabled }}
              />
            </View>
          </ListRow>

          {notificationsEnabled && (
            <ListRow
              index={1}
              total={2}
              onPress={() => router.push('/notification-settings' as any)}
              accessibilityLabel="Notification Preferences"
              accessibilityHint="Opens notification category settings"
            >
              <View style={styles.rowContent}>
                <View style={styles.rowLeft}>
                  <Ionicons
                    name="options-outline"
                    size={ms(18)}
                    color={c.text}
                    accessible={false}
                  />
                  <ThemedText style={[styles.rowLabel, { color: c.text }]}>
                    Notification Preferences
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
          )}
        </Section>

        {/* ─── Preferences ─────────────────────────────────────────────────── */}
        <Section title="Preferences">
          <ListRow index={0} total={1}>
            <View style={styles.rowContent}>
              <View style={styles.rowLeft}>
                <Ionicons
                  name="stats-chart-outline"
                  size={ms(18)}
                  color={c.text}
                  accessible={false}
                />
                <ThemedText style={[styles.rowLabel, { color: c.text }]}>
                  Show Projections
                </ThemedText>
              </View>
              <Switch
                value={projectionsEnabled}
                onValueChange={setProjectionsEnabled}
                trackColor={{ false: c.border, true: c.accent }}
                thumbColor={Platform.OS === 'android' ? '#FFFFFF' : undefined}
                ios_backgroundColor={c.border}
                accessibilityLabel="Show Projections"
                accessibilityHint="Shows projected stats on player detail, free agents and analytics"
                accessibilityRole="switch"
                accessibilityState={{ checked: projectionsEnabled }}
              />
            </View>
          </ListRow>
        </Section>

        {/* ─── Beta (gated) ────────────────────────────────────────────────── */}
        {(() => {
          const showNba = isArchiveFlagOn(session?.user);
          const showNhl = isNhlArchiveFlagOn(session?.user);
          const showNfl = isNflArchiveFlagOn(session?.user);
          if (!showNba && !showNhl && !showNfl) return null;
          const total = (showNba ? 1 : 0) + (showNhl ? 1 : 0) + (showNfl ? 1 : 0);
          let idx = 0;
          return (
            <Section title="Beta">
              {showNba && (
                <ListRow
                  index={idx++}
                  total={total}
                  onPress={() => router.push('/playoff-archive' as any)}
                  accessibilityLabel="NBA Playoff Archive (beta)"
                  accessibilityHint="Opens the interactive playoff history archive"
                >
                  <View style={styles.rowContent}>
                    <View style={styles.rowLeft}>
                      <Ionicons
                        name="trophy-outline"
                        size={ms(18)}
                        color={c.gold}
                        accessible={false}
                      />
                      <ThemedText style={[styles.rowLabel, { color: c.text }]}>
                        NBA Playoff Archive
                      </ThemedText>
                      <Badge label="BETA" variant="gold" size="small" />
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={ms(16)}
                      color={c.secondaryText}
                      accessible={false}
                    />
                  </View>
                </ListRow>
              )}
              {showNhl && (
                <ListRow
                  index={idx++}
                  total={total}
                  onPress={() => router.push('/playoff-archive-nhl' as any)}
                  accessibilityLabel="NHL Playoff Archive (dev)"
                  accessibilityHint="Opens the NHL playoff history archive"
                >
                  <View style={styles.rowContent}>
                    <View style={styles.rowLeft}>
                      <Ionicons
                        name="trophy-outline"
                        size={ms(18)}
                        color={c.gold}
                        accessible={false}
                      />
                      <ThemedText style={[styles.rowLabel, { color: c.text }]}>
                        NHL Playoff Archive
                      </ThemedText>
                      <Badge label="DEV" variant="gold" size="small" />
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={ms(16)}
                      color={c.secondaryText}
                      accessible={false}
                    />
                  </View>
                </ListRow>
              )}
              {showNfl && (
                <ListRow
                  index={idx++}
                  total={total}
                  onPress={() => router.push('/playoff-archive-nfl' as any)}
                  accessibilityLabel="NFL Playoff Archive (dev)"
                  accessibilityHint="Opens the NFL playoff history archive"
                >
                  <View style={styles.rowContent}>
                    <View style={styles.rowLeft}>
                      <Ionicons
                        name="american-football-outline"
                        size={ms(18)}
                        color={c.gold}
                        accessible={false}
                      />
                      <ThemedText style={[styles.rowLabel, { color: c.text }]}>
                        NFL Playoff Archive
                      </ThemedText>
                      <Badge label="DEV" variant="gold" size="small" />
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={ms(16)}
                      color={c.secondaryText}
                      accessible={false}
                    />
                  </View>
                </ListRow>
              )}
            </Section>
          );
        })()}

        {/* ─── Privacy & Safety ────────────────────────────────────────────── */}
        <Section title="Privacy & Safety">
          <ListRow
            index={0}
            total={1}
            onPress={() => router.push('/blocked-users' as any)}
            accessibilityLabel="Blocked Users"
            accessibilityHint="View and manage users you've blocked"
          >
            <View style={styles.rowContent}>
              <View style={styles.rowLeft}>
                <Ionicons
                  name="ban-outline"
                  size={ms(18)}
                  color={c.text}
                  accessible={false}
                />
                <ThemedText style={[styles.rowLabel, { color: c.text }]}>
                  Blocked Users
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

        {/* ─── Legal ───────────────────────────────────────────────────────── */}
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

        {/* ─── Account ─────────────────────────────────────────────────────── */}
        <Section title="Account">
          <ListRow
            index={0}
            total={3}
            onPress={async () => {
              const email = session?.user?.email;
              if (!email) return;
              const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: 'franchisev2://reset-password',
              });
              if (error) {
                Alert.alert('Error', error.message);
              } else {
                Alert.alert(
                  'Check Your Email',
                  'A password reset link has been sent to your email address.',
                );
              }
            }}
            accessibilityLabel="Change Password"
            accessibilityHint="Sends a password reset link to your email"
          >
            <View style={styles.rowContent}>
              <View style={styles.rowLeft}>
                <Ionicons
                  name="key-outline"
                  size={ms(18)}
                  color={c.text}
                  accessible={false}
                />
                <ThemedText style={[styles.rowLabel, { color: c.text }]}>
                  Change Password
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
            total={3}
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
            index={2}
            total={3}
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

        {/* ─── Version footer (tap to check for OTA updates) ──────────────── */}
        <View style={styles.versionWrap}>
          <View style={[styles.versionRule, { backgroundColor: c.border }]} />
          <TouchableOpacity
            onPress={checkForOtaUpdate}
            activeOpacity={0.6}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Check for app updates"
            accessibilityHint="Downloads a new version if one is available and offers to restart"
          >
            <ThemedText
              type="varsitySmall"
              style={[styles.versionText, { color: c.secondaryText }]}
            >
              FRANCHISE · V2.0.0
            </ThemedText>
          </TouchableOpacity>
          <View style={[styles.versionRule, { backgroundColor: c.border }]} />
        </View>

        </View>
      </ScrollView>

      {teamId && (
        <TeamLogoPickerModal
          visible={showLogoPicker}
          teamId={teamId}
          teamName={myTeamName}
          currentLogoKey={myLogoKey}
          onClose={() => setShowLogoPicker(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['league'] });
            queryClient.invalidateQueries({ queryKey: ['teamLogos'] });
          }}
        />
      )}

      {PAYWALL_ENABLED && (
        <UpgradeModal
          visible={showUpgradeModal}
          onClose={() => setShowUpgradeModal(false)}
        />
      )}
    </SafeAreaView>
  );
}

function SettingRowContent({
  icon,
  label,
  value,
  editable,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  editable?: boolean;
}) {
  const c = useColors();
  return (
    <View style={styles.rowContent}>
      <View style={styles.rowLeft}>
        <Ionicons
          name={icon}
          size={ms(18)}
          color={c.secondaryText}
          accessible={false}
        />
        <ThemedText style={[styles.rowLabel, { color: c.secondaryText }]}>
          {label}
        </ThemedText>
      </View>
      <View style={styles.rowRight}>
        <ThemedText style={{ color: c.text }} numberOfLines={1}>
          {value}
        </ThemedText>
        {editable && (
          <Ionicons
            name="pencil"
            size={ms(13)}
            color={c.secondaryText}
            accessible={false}
          />
        )}
      </View>
    </View>
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
  // Aligned with the RosterHero chrome family: green heroSurface + corner
  // gold rule (top-left, 3pt × s(40)) + patch watermark + cardShadow +
  // rounded 16. minHeight matches RosterHero so heights stay standardized
  // across non-Home tabs.
  hero: {
    position: 'relative',
    marginHorizontal: s(12),
    marginTop: s(8),
    marginBottom: s(16),
    borderRadius: 16,
    paddingHorizontal: s(16),
    paddingVertical: s(20),
    overflow: 'hidden',
    minHeight: ms(140),
    justifyContent: 'center',
  },
  heroRule: {
    position: 'absolute',
    top: 0,
    left: s(16),
    height: 3,
    width: s(40),
  },
  heroPatch: {
    position: 'absolute',
    right: s(-22),
    bottom: s(-28),
    width: s(130),
    height: s(130),
    opacity: 0.14,
  },
  heroBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(16),
  },
  avatar: {
    width: s(72),
    height: s(72),
    borderRadius: s(36),
    borderWidth: 2,
    overflow: 'hidden',
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: Fonts.display,
    fontSize: ms(28),
    // Alfa Slab One has tall ascenders; lineHeight must exceed fontSize or the
    // top of the glyph clips inside the avatar circle.
    lineHeight: ms(38),
    letterSpacing: 0,
    textAlign: 'center',
  },
  avatarEditBadge: {
    position: 'absolute',
    bottom: -s(2),
    right: -s(2),
    width: s(24),
    height: s(24),
    borderRadius: s(12),
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
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
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
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
