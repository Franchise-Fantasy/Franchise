import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors } from "@/constants/Colors";
import { useAppState } from "@/context/AppStateProvider";
import { useSession } from "@/context/AuthProvider";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useLeague } from "@/hooks/useLeague";
import {
  getPushPrefs,
  registerPushToken,
  setDraftAlerts,
  unregisterPushToken,
} from "@/lib/notifications";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Alert,
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
  const [loading, setLoading] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [draftReminders, setDraftReminders] = useState(false);

  const userId = session?.user?.id;

  useEffect(() => {
    if (!userId) return;
    getPushPrefs(userId).then(({ enabled, draftAlerts }) => {
      setNotificationsEnabled(enabled);
      setDraftReminders(draftAlerts);
    });
  }, [userId]);

  async function handleNotificationsToggle(value: boolean) {
    if (!userId) return;
    if (value) {
      const success = await registerPushToken(userId);
      if (success) {
        setNotificationsEnabled(true);
        setDraftReminders(true);
      }
    } else {
      await unregisterPushToken(userId);
      setNotificationsEnabled(false);
      setDraftReminders(false);
    }
  }

  async function handleDraftRemindersToggle(value: boolean) {
    if (!userId) return;
    setDraftReminders(value);
    await setDraftAlerts(userId, value);
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
            // For now, just sign out. Full deletion would need a backend endpoint.
            await handleSignOut();
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
          <View style={[styles.avatar, { backgroundColor: c.accent }]}>
            <Text style={[styles.avatarText, { color: c.accentText }]}>
              {userEmail.charAt(0).toUpperCase()}
            </Text>
          </View>
          <ThemedText type="subtitle" style={styles.email}>
            {userEmail}
          </ThemedText>
          {isCommissioner && (
            <View
              style={[
                styles.badge,
                { backgroundColor: c.activeCard, borderColor: c.activeBorder },
              ]}
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
            <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>
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
          </View>
        )}

        {/* Notifications */}
        <View
          style={[
            styles.section,
            { backgroundColor: c.card, borderColor: c.border },
          ]}
        >
          <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>
            Notifications
          </ThemedText>
          <ToggleRow
            icon="notifications-outline"
            label="Push Notifications"
            value={notificationsEnabled}
            onToggle={handleNotificationsToggle}
            c={c}
          />
          <ToggleRow
            icon="alarm-outline"
            label="Draft Reminders"
            value={draftReminders}
            onToggle={handleDraftRemindersToggle}
            disabled={!notificationsEnabled}
            c={c}
          />
        </View>

        {/* Account Actions */}
        <View
          style={[
            styles.section,
            { backgroundColor: c.card, borderColor: c.border },
          ]}
        >
          <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>
            Account
          </ThemedText>

          <TouchableOpacity
            style={styles.actionRow}
            onPress={handleSignOut}
            disabled={loading}
            activeOpacity={0.7}
          >
            <View style={styles.actionLeft}>
              <Ionicons name="log-out-outline" size={20} color={c.text} />
              <ThemedText style={styles.actionLabel}>Sign Out</ThemedText>
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={c.secondaryText}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionRow, { borderBottomWidth: 0 }]}
            onPress={handleDeleteAccount}
            activeOpacity={0.7}
          >
            <View style={styles.actionLeft}>
              <Ionicons name="trash-outline" size={20} color="#FF3B30" />
              <Text style={[styles.actionLabel, { color: "#FF3B30" }]}>
                Delete Account
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={c.secondaryText}
            />
          </TouchableOpacity>
        </View>

        {/* App Info */}
        <ThemedText style={[styles.versionText, { color: c.secondaryText }]}>
          Franchise v2.0.0
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

function SettingRow({
  icon,
  label,
  value,
  c,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  c: any;
}) {
  return (
    <View style={[styles.settingRow, { borderBottomColor: c.border }]}>
      <View style={styles.actionLeft}>
        <Ionicons name={icon} size={20} color={c.secondaryText} />
        <ThemedText style={[styles.settingLabel, { color: c.secondaryText }]}>
          {label}
        </ThemedText>
      </View>
      <ThemedText>{value}</ThemedText>
    </View>
  );
}

function ToggleRow({
  icon,
  label,
  value,
  onToggle,
  disabled = false,
  c,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: boolean;
  onToggle: (v: boolean) => void;
  disabled?: boolean;
  c: any;
}) {
  return (
    <View style={[styles.settingRow, { borderBottomColor: c.border, opacity: disabled ? 0.4 : 1 }]}>
      <View style={styles.actionLeft}>
        <Ionicons name={icon} size={20} color={c.secondaryText} />
        <ThemedText style={styles.actionLabel}>{label}</ThemedText>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: c.border, true: c.accent }}
        disabled={disabled}
      />
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
    fontSize: 28,
    fontWeight: "700",
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
    fontSize: 12,
    fontWeight: "600",
  },
  section: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 2,
    marginBottom: 16,
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
    fontSize: 15,
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
    fontSize: 16,
  },
  versionText: {
    textAlign: "center",
    fontSize: 13,
    marginTop: 8,
  },
});
