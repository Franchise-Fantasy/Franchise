import { ThemedText } from "@/components/ui/ThemedText";
import { ms, s } from "@/utils/scale";
import { ThemedView } from "@/components/ui/ThemedView";
import { TeamLogo } from "@/components/team/TeamLogo";
import { TeamLogoPickerModal } from "@/components/team/TeamLogoPickerModal";
import { UpgradeModal } from "@/components/UpgradeModal";
import { Colors, cardShadow } from "@/constants/Colors";
import { useAppState } from "@/context/AppStateProvider";
import { useSession } from "@/context/AuthProvider";
import { useColorScheme } from "@/hooks/useColorScheme";
import { containsBlockedContent } from "@/utils/moderation";
import { useLeague } from "@/hooks/useLeague";
import {
  getPushPrefs,
  registerPushToken,
  unregisterPushToken,
} from "@/lib/notifications";
import { useSubscription } from "@/hooks/useSubscription";
import { TIER_LABELS, TIER_COLORS } from "@/constants/Subscriptions";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

export default function ProfileScreen() {
  const session = useSession();
  const router = useRouter();
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const { teamId, leagueId } = useAppState();
  const { data: league } = useLeague();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [showLogoPicker, setShowLogoPicker] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  const userId = session?.user?.id;
  const myTeam = (league?.league_teams ?? []).find((t: any) => t.id === teamId);
  const myLogoKey = myTeam?.logo_key ?? null;
  const myTeamName = myTeam?.name ?? "";
  const myTricode = myTeam?.tricode ?? "";
  const { tier, individualTier, individualPeriod, leagueTier, leaguePeriod } = useSubscription();

  function handleEditTeamName() {
    if (!teamId) return;
    if (Platform.OS === 'ios') {
      Alert.prompt(
        'Edit Team Name',
        'Enter your new team name',
        async (value) => {
          const name = (value ?? '').trim();
          if (!name) return;
          if (name.length > 30) { Alert.alert('Too long', 'Team name must be 30 characters or fewer.'); return; }
          if (containsBlockedContent(name)) { Alert.alert('Invalid name', 'That team name contains language that isn\u2019t allowed.'); return; }
          const { error } = await supabase.from('teams').update({ name }).eq('id', teamId);
          if (error) { Alert.alert('Error', error.message); return; }
          queryClient.invalidateQueries({ queryKey: ['league'] });
        },
        'plain-text',
        myTeamName,
      );
    } else {
      // Android doesn't support Alert.prompt — use inline editing via league-info or a simple alert
      Alert.alert('Edit Team Name', 'Use the League Info page to edit your team name on Android.');
    }
  }

  function handleEditTricode() {
    if (!teamId) return;
    if (Platform.OS === 'ios') {
      Alert.prompt(
        'Edit Tricode',
        '2-4 characters (letters/numbers)',
        async (value) => {
          const code = (value ?? '').trim().toUpperCase();
          if (!code || code.length < 2 || code.length > 4 || !/^[A-Z0-9]+$/.test(code)) {
            Alert.alert('Invalid tricode', 'Must be 2-4 letters/numbers.');
            return;
          }
          const { error } = await supabase.from('teams').update({ tricode: code }).eq('id', teamId);
          if (error) { Alert.alert('Error', error.message); return; }
          queryClient.invalidateQueries({ queryKey: ['league'] });
        },
        'plain-text',
        myTricode,
      );
    } else {
      Alert.alert('Edit Tricode', 'Use the League Info page to edit your tricode on Android.');
    }
  }

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getPushPrefs(userId)
      .then(({ enabled }) => {
        if (!cancelled) setNotificationsEnabled(enabled);
      })
      .catch((err) => {
        console.warn("getPushPrefs failed", err);
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

  const userEmail = session?.user?.email ?? "Unknown";
  const isCommissioner = session?.user?.id === league?.created_by;

  async function handleSignOut() {
    setLoading(true);
    const { error } = await supabase.auth.signOut();

    const keys = await AsyncStorage.getAllKeys();
    const supabaseKeys = keys.filter((k) => k.startsWith("sb-"));
    if (supabaseKeys.length > 0) {
      await AsyncStorage.multiRemove(supabaseKeys);
    }

    setLoading(false);
    if (error) {
      Alert.alert("Error", error.message);
    } else {
      router.replace("/auth");
    }
  }

  async function handleDeleteAccount() {
    Alert.alert(
      "Delete Account",
      "Are you sure? This will permanently delete your account and all associated data. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setLoading(true);
            try {
              const { data: { session: currentSession } } = await supabase.auth.getSession();
              const { error } = await supabase.functions.invoke('delete-account', {
                headers: { Authorization: `Bearer ${currentSession?.access_token}` },
              });
              if (error) throw error;

              // Clean up local storage and redirect
              const keys = await AsyncStorage.getAllKeys();
              const supabaseKeys = keys.filter((k) => k.startsWith("sb-"));
              if (supabaseKeys.length > 0) {
                await AsyncStorage.multiRemove(supabaseKeys);
              }
              await supabase.auth.signOut();
              router.replace("/auth");
            } catch (err: any) {
              Alert.alert("Error", err.message ?? "Failed to delete account. Please try again.");
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => { if (teamId) setShowLogoPicker(true); }}
            disabled={!teamId}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={myLogoKey ? `${myTeamName} logo, tap to change` : "Set team logo"}
          >
            <View>
              {myLogoKey?.startsWith("http") ? (
                <Image source={{ uri: myLogoKey }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, { backgroundColor: c.accent }]}>
                  <Text style={[styles.avatarText, { color: c.accentText }]}>
                    {(myTeamName || userEmail).charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
              {teamId && (
                <View style={[styles.avatarEditBadge, { backgroundColor: c.card, borderColor: c.border }]}>
                  <Ionicons name="pencil" size={11} color={c.text} />
                </View>
              )}
            </View>
          </TouchableOpacity>
          <ThemedText type="subtitle" style={styles.email} accessibilityRole="header">
            {userEmail}
          </ThemedText>
          {isCommissioner && (
            <View
              style={[
                styles.badge,
                { backgroundColor: c.activeCard, borderColor: c.activeBorder },
              ]}
              accessibilityLabel="Commissioner"
            >
              <ThemedText style={[styles.badgeText, { color: c.activeText }]}>
                Commissioner
              </ThemedText>
            </View>
          )}
        </View>

        {/* League Info */}
        {league && (
          <View
            style={[
              styles.section,
              { backgroundColor: c.card, borderColor: c.border },
            ]}
          >
            <ThemedText type="defaultSemiBold" style={styles.sectionTitle} accessibilityRole="header">
              League
            </ThemedText>
            <SettingRow
              icon="trophy-outline"
              label="League Name"
              value={league.name}
              c={c}
            />
            <SettingRow
              icon="people-outline"
              label="Teams"
              value={`${league.current_teams ?? 0} / ${league.teams ?? '?'}`}
              c={c}
            />
            <SettingRow
              icon="shield-outline"
              label="Visibility"
              value={league.private ? "Private" : "Public"}
              c={c}
            />
            <SettingRow
              icon="diamond-outline"
              label="League Plan"
              value={leagueTier ? `${TIER_LABELS[leagueTier]}${leaguePeriod ? ` (${leaguePeriod})` : ''}` : 'Free'}
              c={c}
            />
            {myTeam && (
              <>
                <TouchableOpacity
                  style={[styles.settingRow, { borderBottomColor: c.border }]}
                  onPress={handleEditTeamName}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Team Name: ${myTeamName}, tap to edit`}
                >
                  <View style={styles.actionLeft}>
                    <Ionicons name="shirt-outline" size={20} color={c.secondaryText} accessible={false} />
                    <ThemedText style={[styles.settingLabel, { color: c.secondaryText }]}>
                      Team Name
                    </ThemedText>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <ThemedText>{myTeamName}</ThemedText>
                    <Ionicons name="pencil" size={14} color={c.secondaryText} accessible={false} />
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.settingRow, { borderBottomWidth: 0, borderBottomColor: c.border }]}
                  onPress={handleEditTricode}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Tricode: ${myTricode || 'not set'}, tap to edit`}
                >
                  <View style={styles.actionLeft}>
                    <Ionicons name="text-outline" size={20} color={c.secondaryText} accessible={false} />
                    <ThemedText style={[styles.settingLabel, { color: c.secondaryText }]}>
                      Tricode
                    </ThemedText>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <ThemedText>{myTricode || '—'}</ThemedText>
                    <Ionicons name="pencil" size={14} color={c.secondaryText} accessible={false} />
                  </View>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {/* Subscription */}
        <View
          style={[
            styles.section,
            { backgroundColor: c.card, borderColor: c.border },
          ]}
        >
          <ThemedText type="defaultSemiBold" style={styles.sectionTitle} accessibilityRole="header">
            Subscription
          </ThemedText>
          <SettingRow
            icon="diamond-outline"
            label="Current Plan"
            value={`${TIER_LABELS[tier]}${tier !== 'free' && individualPeriod ? ` (${individualPeriod})` : ''}`}
            c={c}
          />
          {leagueTier && (
            <SettingRow
              icon="people-outline"
              label="League Plan"
              value={`${TIER_LABELS[leagueTier]}${leaguePeriod ? ` (${leaguePeriod})` : ''}`}
              c={c}
            />
          )}
          <TouchableOpacity
            style={[styles.actionRow, { borderBottomWidth: 0 }]}
            onPress={() => setShowUpgradeModal(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={tier === 'free' ? 'Upgrade Plan' : 'Manage Plan'}
          >
            <View style={styles.actionLeft}>
              <Ionicons
                name={tier === 'free' ? "arrow-up-circle-outline" : "settings-outline"}
                size={20}
                color={tier === 'free' ? TIER_COLORS.pro : c.secondaryText}
                accessible={false}
              />
              <ThemedText style={styles.actionLabel}>
                {tier === 'free' ? 'Upgrade Plan' : 'Manage Plan'}
              </ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={16} color={c.secondaryText} accessible={false} />
          </TouchableOpacity>
        </View>

        {/* Notifications */}
        <View
          style={[
            styles.section,
            { backgroundColor: c.card, borderColor: c.border },
          ]}
        >
          <ThemedText type="defaultSemiBold" style={styles.sectionTitle} accessibilityRole="header">
            Notifications
          </ThemedText>
          <View style={[styles.settingRow, { borderBottomColor: c.border }]}>
            <View style={styles.actionLeft}>
              <Ionicons name="notifications-outline" size={20} color={c.secondaryText} accessible={false} />
              <ThemedText style={styles.actionLabel}>Push Notifications</ThemedText>
            </View>
            <Switch
              value={notificationsEnabled}
              onValueChange={handleNotificationsToggle}
              trackColor={{ false: c.border, true: c.accent }}
              accessibilityLabel="Push Notifications"
              accessibilityRole="switch"
              accessibilityState={{ checked: notificationsEnabled }}
            />
          </View>
          {notificationsEnabled && (
            <TouchableOpacity
              style={[styles.actionRow, { borderBottomWidth: 0 }]}
              onPress={() => router.push('/notification-settings')}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Notification Preferences"
              accessibilityHint="Opens notification category settings"
            >
              <View style={styles.actionLeft}>
                <Ionicons name="options-outline" size={20} color={c.secondaryText} accessible={false} />
                <ThemedText style={styles.actionLabel}>Notification Preferences</ThemedText>
              </View>
              <Ionicons name="chevron-forward" size={18} color={c.secondaryText} accessible={false} />
            </TouchableOpacity>
          )}
        </View>

        {/* Legal */}
        <View
          style={[
            styles.section,
            { backgroundColor: c.card, borderColor: c.border },
          ]}
        >
          <ThemedText type="defaultSemiBold" style={styles.sectionTitle} accessibilityRole="header">
            Legal
          </ThemedText>
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => router.push('/legal?tab=terms' as any)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Terms of Service"
          >
            <View style={styles.actionLeft}>
              <Ionicons name="document-text-outline" size={20} color={c.secondaryText} accessible={false} />
              <ThemedText style={styles.actionLabel}>Terms of Service</ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={18} color={c.secondaryText} accessible={false} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionRow, { borderBottomWidth: 0 }]}
            onPress={() => router.push('/legal?tab=privacy' as any)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Privacy Policy"
          >
            <View style={styles.actionLeft}>
              <Ionicons name="shield-checkmark-outline" size={20} color={c.secondaryText} accessible={false} />
              <ThemedText style={styles.actionLabel}>Privacy Policy</ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={18} color={c.secondaryText} accessible={false} />
          </TouchableOpacity>
        </View>

        {/* Account Actions */}
        <View
          style={[
            styles.section,
            { backgroundColor: c.card, borderColor: c.border },
          ]}
        >
          <ThemedText type="defaultSemiBold" style={styles.sectionTitle} accessibilityRole="header">
            Account
          </ThemedText>

          <TouchableOpacity
            style={styles.actionRow}
            onPress={async () => {
              const email = session?.user?.email;
              if (!email) return;
              const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: 'franchisev2://reset-password',
              });
              if (error) {
                Alert.alert('Error', error.message);
              } else {
                Alert.alert('Check Your Email', 'A password reset link has been sent to your email address.');
              }
            }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Change Password"
            accessibilityHint="Sends a password reset link to your email"
          >
            <View style={styles.actionLeft}>
              <Ionicons name="key-outline" size={20} color={c.text} accessible={false} />
              <ThemedText style={styles.actionLabel}>Change Password</ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={18} color={c.secondaryText} accessible={false} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionRow}
            onPress={handleSignOut}
            disabled={loading}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Sign Out"
            accessibilityState={{ disabled: loading }}
          >
            <View style={styles.actionLeft}>
              <Ionicons name="log-out-outline" size={20} color={c.text} accessible={false} />
              <ThemedText style={styles.actionLabel}>Sign Out</ThemedText>
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={c.secondaryText}
              accessible={false}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionRow, { borderBottomWidth: 0 }]}
            onPress={handleDeleteAccount}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Delete Account"
            accessibilityHint="Permanently deletes your account and all data"
          >
            <View style={styles.actionLeft}>
              <Ionicons name="trash-outline" size={20} color={c.danger} accessible={false} />
              <Text style={[styles.actionLabel, { color: c.danger }]}>
                Delete Account
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={c.secondaryText}
              accessible={false}
            />
          </TouchableOpacity>
        </View>

        {/* App Info */}
        <ThemedText style={[styles.versionText, { color: c.secondaryText }]}>
          Franchise v2.0.0
        </ThemedText>
      </ScrollView>

      {/* Team Logo Picker */}
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

      <UpgradeModal
        visible={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
      />
    </ThemedView>
  );
}

function SettingRow({
  icon,
  label,
  value,
  c,
  isLast,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  c: any;
  isLast?: boolean;
}) {
  return (
    <View
      style={[styles.settingRow, { borderBottomColor: c.border }, isLast && { borderBottomWidth: 0 }]}
      accessibilityLabel={`${label}: ${value}`}
    >
      <View style={styles.actionLeft}>
        <Ionicons name={icon} size={20} color={c.secondaryText} accessible={false} />
        <ThemedText style={[styles.settingLabel, { color: c.secondaryText }]}>
          {label}
        </ThemedText>
      </View>
      <ThemedText>{value}</ThemedText>
    </View>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 70,
    paddingBottom: 40,
  },
  header: {
    alignItems: "center",
    marginBottom: 28,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  avatarText: {
    fontSize: ms(28),
    fontWeight: "700",
  },
  avatarEditBadge: {
    position: "absolute",
    bottom: 4,
    right: -4,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  email: {
    textAlign: "center",
  },
  badge: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: ms(12),
    fontWeight: "600",
  },
  section: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 2,
    marginBottom: 16,
    ...cardShadow,
  },
  sectionTitle: {
    marginBottom: 8,
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  settingLabel: {
    fontSize: ms(15),
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(128,128,128,0.15)",
  },
  actionLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  actionLabel: {
    fontSize: ms(16),
  },
  versionText: {
    textAlign: "center",
    fontSize: ms(13),
    marginTop: 8,
  },
});
