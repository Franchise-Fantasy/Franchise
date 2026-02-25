import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";

const TERMS_OF_SERVICE = `Last updated: February 2026

1. Acceptance of Terms

By creating an account or using the Franchise app ("App"), you agree to these Terms of Service ("Terms"). If you do not agree, do not use the App.

2. Description of Service

Franchise is a fantasy basketball application that allows users to create and join leagues, draft players, manage rosters, trade with other users, and compete in fantasy matchups. The App is provided for entertainment purposes.

3. Account Registration

You must provide a valid email address and create a password to use the App. You are responsible for maintaining the security of your account credentials. You must be at least 13 years old to use the App.

4. User Conduct

You agree not to:
• Use the App for any unlawful purpose
• Attempt to gain unauthorized access to other users' accounts
• Interfere with or disrupt the App's functionality
• Use automated tools or bots to interact with the App
• Harass, abuse, or harm other users

5. Intellectual Property

The App, including its design, features, and content, is owned by Franchise. NBA team names, player names, and statistics are used for informational and entertainment purposes under fair use.

6. Termination

We may suspend or terminate your account at any time for violation of these Terms. You may delete your account at any time through the App settings.

7. Disclaimer of Warranties

The App is provided "as is" without warranties of any kind. We do not guarantee uninterrupted access, accuracy of statistics, or availability of features.

8. Limitation of Liability

To the maximum extent permitted by law, Franchise shall not be liable for any indirect, incidental, or consequential damages arising from your use of the App.

9. Changes to Terms

We may update these Terms at any time. Continued use of the App after changes constitutes acceptance of the updated Terms.

10. Contact

For questions about these Terms, please contact us through the App.`;

const PRIVACY_POLICY = `Last updated: February 2026

1. Information We Collect

Account Information: When you create an account, we collect your email address and password (stored securely via Supabase Auth).

Usage Data: We collect information about how you use the App, including league participation, roster changes, and trade activity. This data is used to provide the App's core functionality.

Device Information: We may collect device identifiers and push notification tokens to deliver notifications you've opted into.

2. How We Use Your Information

• To provide and maintain the App's functionality
• To send push notifications you've enabled (draft alerts, trade updates, etc.)
• To display league standings, matchups, and statistics
• To communicate important account or service updates

3. Data Sharing

We do not sell your personal information. We share data only with:
• Supabase (database and authentication provider)
• Expo (push notification delivery)
• Other users in your league (team name, roster, trade history — as part of gameplay)

4. Push Notifications

The App uses push notifications with 11 configurable categories. You can enable or disable each category in Notification Preferences, or disable all notifications from your Profile page.

5. Data Retention

Your data is retained as long as your account is active. When you delete your account, we delete your personal data, team data, and push notification tokens.

6. Data Security

We use Supabase Row Level Security (RLS) to ensure users can only access data they are authorized to view. Authentication tokens are stored securely on your device.

7. Children's Privacy

The App is not intended for children under 13. We do not knowingly collect data from children under 13.

8. Your Rights

You have the right to:
• Access your personal data (visible in your Profile)
• Delete your account and associated data (Profile > Delete Account)
• Control push notification preferences
• Export your data by contacting us

9. Changes to This Policy

We may update this Privacy Policy at any time. We will notify you of material changes through the App.

10. Contact

For privacy questions or data requests, please contact us through the App.`;

type Tab = "terms" | "privacy";

export default function LegalScreen() {
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [activeTab, setActiveTab] = useState<Tab>(
    params.tab === "privacy" ? "privacy" : "terms"
  );

  return (
    <ThemedView style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={c.text} />
        </TouchableOpacity>
        <ThemedText type="subtitle">Legal</ThemedText>
        <View style={styles.backButton} />
      </View>

      {/* Tab Switcher */}
      <View style={[styles.tabs, { borderBottomColor: c.border }]}>
        <TouchableOpacity
          style={[styles.tab, activeTab === "terms" && { borderBottomColor: c.accent, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab("terms")}
        >
          <ThemedText
            style={[styles.tabText, activeTab === "terms" ? { color: c.accent } : { color: c.secondaryText }]}
          >
            Terms of Service
          </ThemedText>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "privacy" && { borderBottomColor: c.accent, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab("privacy")}
        >
          <ThemedText
            style={[styles.tabText, activeTab === "privacy" ? { color: c.accent } : { color: c.secondaryText }]}
          >
            Privacy Policy
          </ThemedText>
        </TouchableOpacity>
      </View>

      {/* Content */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <ThemedText style={styles.body}>
          {activeTab === "terms" ? TERMS_OF_SERVICE : PRIVACY_POLICY}
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 60,
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: { width: 40 },
  tabs: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
  },
  tabText: { fontSize: 14, fontWeight: "600" },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 60 },
  body: { fontSize: 14, lineHeight: 22 },
});
