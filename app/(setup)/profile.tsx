import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { Colors } from "@/constants/Colors";
import { useSession } from "@/context/AuthProvider";
import { useColorScheme } from "@/hooks/useColorScheme";
import { supabase } from "@/lib/supabase";
import { ms } from "@/utils/scale";

export default function SetupProfileScreen() {
  const session = useSession();
  const router = useRouter();
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const [loading, setLoading] = useState(false);

  const userEmail = session?.user?.email ?? "Unknown";

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

              const keys = await AsyncStorage.getAllKeys();
              const supabaseKeys = keys.filter((k) => k.startsWith("sb-"));
              if (supabaseKeys.length > 0) {
                await AsyncStorage.multiRemove(supabaseKeys);
              }
              await supabase.auth.signOut();
              router.replace("/auth");
            } catch (err: any) {
              Alert.alert("Error", err.message ?? "Failed to delete account");
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={[styles.avatar, { backgroundColor: c.accent }]}>
            <Text style={[styles.avatarText, { color: c.accentText }]}>
              {userEmail.charAt(0).toUpperCase()}
            </Text>
          </View>
          <ThemedText type="subtitle" style={styles.email}>
            {userEmail}
          </ThemedText>
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

        {/* Account */}
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
            <Ionicons name="chevron-forward" size={18} color={c.secondaryText} accessible={false} />
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
            <Ionicons name="chevron-forward" size={18} color={c.secondaryText} accessible={false} />
          </TouchableOpacity>
        </View>

        <ThemedText style={[styles.versionText, { color: c.secondaryText }]}>
          Franchise v2.0.0
        </ThemedText>
      </ScrollView>
    </ThemedView>
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
  email: {
    textAlign: "center",
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
