import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { LeagueNotificationModal } from "@/components/LeagueNotificationModal";
import { ToggleRow } from "@/components/ToggleRow";
import { PageHeader } from "@/components/ui/PageHeader";
import { ThemedText } from "@/components/ui/ThemedText";
import { Colors } from "@/constants/Colors";
import { useAppState } from "@/context/AppStateProvider";
import { useSession } from "@/context/AuthProvider";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useLeague } from "@/hooks/useLeague";
import {
  DEFAULT_PREFERENCES,
  getPushPrefs,
  PushPreferences,
  setMuteAll,
  updatePreferences,
} from "@/lib/notifications";
import { ms, s } from "@/utils/scale";

export default function NotificationSettingsScreen() {
  const session = useSession();
  const router = useRouter();
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const userId = session?.user?.id;
  const { leagueId } = useAppState();
  const { data: league } = useLeague();

  const [prefs, setPrefs] = useState<PushPreferences>(DEFAULT_PREFERENCES);
  const [muteAll, setMuteAllState] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showLeagueNotifs, setShowLeagueNotifs] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getPushPrefs(userId)
      .then(({ preferences, muteAll: muted }) => {
        if (cancelled) return;
        setPrefs(preferences);
        setMuteAllState(muted);
        setLoaded(true);
      })
      .catch((err) => {
        console.warn("getPushPrefs failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  function handleMuteAll(value: boolean) {
    if (!userId) return;
    setMuteAllState(value);
    setMuteAll(userId, value);
  }

  function toggle(key: keyof PushPreferences) {
    return (value: boolean) => {
      if (!userId) return;
      const patch: Partial<PushPreferences> = { [key]: value };
      // Turn off sub-toggles when parent is disabled
      if (key === "matchups" && !value) patch.matchup_daily = false;
      if (key === "trades" && !value) {
        patch.trade_block = false;
        patch.trade_rumors = false;
      }
      setPrefs((prev) => ({ ...prev, ...patch }));
      updatePreferences(userId, patch);
    };
  }

  if (!loaded)
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: c.background }]}
        edges={["top"]}
      />
    );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: c.background }]}
      edges={["top"]}
    >
      <PageHeader title="Notifications" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Mute All */}
        <View
          style={[
            styles.section,
            { backgroundColor: c.card, borderColor: c.border },
          ]}
        >
          <ToggleRow
            icon="volume-mute-outline"
            label="Mute All Notifications"
            description="Silences every push notification across all leagues"
            value={muteAll}
            onToggle={handleMuteAll}
            c={c}
            last
          />
        </View>

        {muteAll && (
          <ThemedText style={[styles.muteHint, { color: c.secondaryText }]}>
            All notifications are muted. Toggle off to re-enable the settings
            below.
          </ThemedText>
        )}

        {/* Explainer + League-Specific Button */}
        <View
          style={[
            styles.section,
            { backgroundColor: c.card, borderColor: c.border },
          ]}
        >
          <ThemedText
            type="defaultSemiBold"
            style={styles.sectionTitle}
            accessibilityRole="header"
          >
            How It Works
          </ThemedText>
          <ThemedText style={[styles.explainer, { color: c.secondaryText }]}>
            These settings are your global defaults — they apply to every league
            you're in.
          </ThemedText>
        </View>

        {leagueId && league?.name && (
          <TouchableOpacity
            style={[
              styles.leagueRow,
              { backgroundColor: c.card, borderColor: c.border },
            ]}
            onPress={() => setShowLeagueNotifs(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Customize notifications for ${league.name}`}
          >
            <View
              style={[styles.leagueIcon, { backgroundColor: c.accent + "18" }]}
            >
              <Ionicons
                name="notifications-outline"
                size={18}
                color={c.accent}
                accessible={false}
              />
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText style={{ fontSize: ms(14), fontWeight: "600" }}>
                {league.name}
              </ThemedText>
              <ThemedText style={{ fontSize: ms(12), color: c.secondaryText }}>
                Customize notifications for this league
              </ThemedText>
            </View>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={c.secondaryText}
              accessible={false}
            />
          </TouchableOpacity>
        )}

        {/* Core Alerts */}
        <View
          style={[
            styles.section,
            {
              backgroundColor: c.card,
              borderColor: c.border,
              opacity: muteAll ? 0.4 : 1,
            },
          ]}
          pointerEvents={muteAll ? "none" : "auto"}
        >
          <ThemedText
            type="defaultSemiBold"
            style={styles.sectionTitle}
            accessibilityRole="header"
          >
            Core Alerts
          </ThemedText>
          <ToggleRow
            icon="basketball-outline"
            label="Draft"
            description="Your pick, draft started & completed, autopick"
            value={prefs.draft}
            onToggle={toggle("draft")}
            c={c}
          />
          <ToggleRow
            icon="swap-horizontal-outline"
            label="Trades"
            description="Proposed, accepted, completed, vetoed"
            value={prefs.trades}
            onToggle={toggle("trades")}
            c={c}
          />
          <ToggleRow
            icon="hand-left-outline"
            label="Trade Block Interest"
            description="When someone expresses interest in your player"
            value={prefs.trade_block}
            onToggle={toggle("trade_block")}
            disabled={!prefs.trades}
            c={c}
            indented
          />
          <ToggleRow
            icon="ear-outline"
            label="Trade Rumors"
            description="Leaked and auto-generated trade rumors in chat"
            value={prefs.trade_rumors}
            onToggle={toggle("trade_rumors")}
            disabled={!prefs.trades}
            c={c}
            indented
          />
          <ToggleRow
            icon="stats-chart-outline"
            label="Matchup Results"
            description="Final scores and weekly results"
            value={prefs.matchups}
            onToggle={toggle("matchups")}
            c={c}
          />
          <ToggleRow
            icon="trending-up-outline"
            label="Daily Score Updates"
            description="Daily matchup progress during the week"
            value={prefs.matchup_daily}
            onToggle={toggle("matchup_daily")}
            disabled={!prefs.matchups}
            c={c}
            indented
          />
          <ToggleRow
            icon="hourglass-outline"
            label="Waiver Results"
            description="Claim won or lost, FAAB bid results"
            value={prefs.waivers}
            onToggle={toggle("waivers")}
            c={c}
          />
          <ToggleRow
            icon="medkit-outline"
            label="Injury Updates"
            description="Your rostered player status changes"
            value={prefs.injuries}
            onToggle={toggle("injuries")}
            c={c}
          />
          <ToggleRow
            icon="newspaper-outline"
            label="Player News"
            description="News articles about players on your roster"
            value={prefs.player_news}
            onToggle={toggle("player_news")}
            c={c}
            last
          />
        </View>

        {/* Playoffs & Lottery */}
        <View
          style={[
            styles.section,
            {
              backgroundColor: c.card,
              borderColor: c.border,
              opacity: muteAll ? 0.4 : 1,
            },
          ]}
          pointerEvents={muteAll ? "none" : "auto"}
        >
          <ThemedText
            type="defaultSemiBold"
            style={styles.sectionTitle}
            accessibilityRole="header"
          >
            Playoffs & Lottery
          </ThemedText>
          <ToggleRow
            icon="trophy-outline"
            label="Playoff Alerts"
            description="Seed pick turn, championship"
            value={prefs.playoffs}
            onToggle={toggle("playoffs")}
            c={c}
          />
          <ToggleRow
            icon="dice-outline"
            label="Lottery Results"
            description="Draft position and lottery draws"
            value={prefs.lottery}
            onToggle={toggle("lottery")}
            c={c}
            last
          />
        </View>

        {/* Other */}
        <View
          style={[
            styles.section,
            {
              backgroundColor: c.card,
              borderColor: c.border,
              opacity: muteAll ? 0.4 : 1,
            },
          ]}
          pointerEvents={muteAll ? "none" : "auto"}
        >
          <ThemedText
            type="defaultSemiBold"
            style={styles.sectionTitle}
            accessibilityRole="header"
          >
            Other
          </ThemedText>
          <ToggleRow
            icon="chatbubbles-outline"
            label="Chat Messages"
            description="New messages in league chat and DMs"
            value={prefs.chat}
            onToggle={toggle("chat")}
            c={c}
          />
          <ToggleRow
            icon="shield-outline"
            label="Commissioner Actions"
            description="Force add/drop/move on your team"
            value={prefs.commissioner}
            onToggle={toggle("commissioner")}
            c={c}
          />
          <ToggleRow
            icon="people-outline"
            label="League Activity"
            description="New team joins, season starts"
            value={prefs.league_activity}
            onToggle={toggle("league_activity")}
            c={c}
          />
          <ToggleRow
            icon="clipboard-outline"
            label="Roster Reminders"
            description="Pending drops executed, locked players"
            value={prefs.roster_reminders}
            onToggle={toggle("roster_reminders")}
            c={c}
          />
          <ToggleRow
            icon="person-add-outline"
            label="League Roster Moves"
            description="When other teams add or drop players"
            value={prefs.roster_moves}
            onToggle={toggle("roster_moves")}
            c={c}
            last
          />
        </View>
      </ScrollView>

      {/* Per-League Notification Modal */}
      {leagueId && userId && (
        <LeagueNotificationModal
          visible={showLeagueNotifs}
          onClose={() => setShowLeagueNotifs(false)}
          userId={userId}
          leagueId={leagueId}
          leagueName={league?.name ?? "League"}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 40,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  title: {
    fontSize: ms(20),
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
  muteHint: {
    fontSize: ms(13),
    textAlign: "center",
    marginBottom: 12,
  },
  explainer: {
    fontSize: ms(13),
    lineHeight: 19,
    marginBottom: 12,
  },
  leagueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 16,
  },
  leagueIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
});
