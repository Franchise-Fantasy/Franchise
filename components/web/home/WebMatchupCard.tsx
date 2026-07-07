import { useRouter } from "expo-router";
import { StyleSheet, TouchableOpacity, View } from "react-native";

import { useWeekMatchup, useWeeks } from "@/components/matchup/matchupData";
import { TeamLogo } from "@/components/team/TeamLogo";
import { LogoSpinner } from "@/components/ui/LogoSpinner";
import { ThemedText } from "@/components/ui/ThemedText";
import { useAppState } from "@/context/AppStateProvider";
import { useActiveLeagueSport } from "@/hooks/useActiveLeagueSport";
import { useColors } from "@/hooks/useColors";
import { useLeagueScoring } from "@/hooks/useLeagueScoring";
import { useSportToday } from "@/utils/dates";

/**
 * Desktop web "This Week" matchup scoreboard — the home dashboard centerpiece.
 * Reuses the same matchup data the mobile matchup screen reads (useWeekMatchup),
 * so scores stay in lockstep; this is purely a compact web presentation. Renders
 * nothing when there's no matchup data (offseason / pre-schedule); the parent
 * only mounts it during the regular season. Web-only — never reaches native.
 */
function fmtScore(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

function record(w: number, l: number, t: number): string {
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}

export function WebMatchupCard() {
  const c = useColors();
  const router = useRouter();
  const { teamId, leagueId } = useAppState();
  const sport = useActiveLeagueSport();
  const today = useSportToday(sport);

  const { data: weeks } = useWeeks(leagueId);
  const { data: scoring = [] } = useLeagueScoring(leagueId ?? "");
  const { data, isLoading } = useWeekMatchup(weeks, today, teamId, leagueId, scoring, sport);

  // No matchup for this slate (bye-less pre-season / offseason) — stay silent
  // rather than render an empty shell; the parent gates on regular season.
  if (!isLoading && (!data || !data.myTeam)) return null;

  const me = data?.myTeam ?? null;
  const opp = data?.opponentTeam ?? null;
  const isFinal = data?.isFinalized ?? false;
  const weekNo = data?.week.week_number ?? null;

  const myScore = me?.weekTotal ?? 0;
  const oppScore = opp?.weekTotal ?? 0;
  const myLead = !!opp && myScore > oppScore;
  const oppLead = !!opp && oppScore > myScore;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <View style={[styles.rule, { backgroundColor: c.gold }]} />
          <ThemedText type="sectionLabel" style={{ color: c.text }}>
            This Week
          </ThemedText>
        </View>
        <TouchableOpacity
          onPress={() => router.push("/matchup" as never)}
          accessibilityRole="link"
          accessibilityLabel="View full matchup"
        >
          <ThemedText type="varsitySmall" style={{ color: c.accent }}>
            View →
          </ThemedText>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => router.push("/matchup" as never)}
        accessibilityRole="button"
        accessibilityLabel={
          me && opp
            ? `${me.teamName} ${fmtScore(myScore)} versus ${opp.teamName} ${fmtScore(oppScore)}, ${isFinal ? "final" : "in progress"}`
            : "This week's matchup"
        }
        style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
      >
        {isLoading || !me ? (
          <View style={styles.loading}>
            <LogoSpinner />
          </View>
        ) : (
          <>
            <View style={styles.statusRow}>
              <ThemedText type="varsitySmall" style={[styles.weekLabel, { color: c.secondaryText }]}>
                {weekNo != null ? `WEEK ${weekNo}` : "THIS WEEK"}
              </ThemedText>
              <View
                style={[
                  styles.statusPill,
                  { backgroundColor: isFinal ? c.cardAlt : c.accent + "22", borderColor: isFinal ? c.border : c.accent },
                ]}
              >
                <ThemedText
                  type="varsitySmall"
                  style={[styles.statusText, { color: isFinal ? c.secondaryText : c.accent }]}
                >
                  {isFinal ? "FINAL" : "LIVE"}
                </ThemedText>
              </View>
            </View>

            <View style={styles.matchRow}>
              <View style={styles.teamCol}>
                <TeamLogo logoKey={me.logoKey} teamName={me.teamName} tricode={me.tricode ?? undefined} size="large" />
                <ThemedText type="defaultSemiBold" numberOfLines={2} style={[styles.teamName, { color: c.text }]}>
                  {me.teamName}
                </ThemedText>
                <ThemedText style={[styles.teamRecord, { color: c.secondaryText }]}>
                  {record(me.wins, me.losses, me.ties)}
                </ThemedText>
              </View>

              <View style={styles.scoreBlock}>
                {opp ? (
                  <View style={styles.scoreLine}>
                    <ThemedText style={[styles.score, { color: myLead ? c.gold : c.text }]}>
                      {fmtScore(myScore)}
                    </ThemedText>
                    <ThemedText style={[styles.dash, { color: c.secondaryText }]}>–</ThemedText>
                    <ThemedText style={[styles.score, { color: oppLead ? c.gold : c.text }]}>
                      {fmtScore(oppScore)}
                    </ThemedText>
                  </View>
                ) : (
                  <ThemedText style={[styles.byeText, { color: c.secondaryText }]}>BYE</ThemedText>
                )}
              </View>

              {opp ? (
                <View style={styles.teamCol}>
                  <TeamLogo logoKey={opp.logoKey} teamName={opp.teamName} tricode={opp.tricode ?? undefined} size="large" />
                  <ThemedText type="defaultSemiBold" numberOfLines={2} style={[styles.teamName, { color: c.text }]}>
                    {opp.teamName}
                  </ThemedText>
                  <ThemedText style={[styles.teamRecord, { color: c.secondaryText }]}>
                    {record(opp.wins, opp.losses, opp.ties)}
                  </ThemedText>
                </View>
              ) : (
                <View style={styles.teamCol} />
              )}
            </View>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 18,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  rule: {
    height: 2,
    width: 18,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingVertical: 22,
    minHeight: 190,
    justifyContent: "center",
  },
  loading: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  weekLabel: {
    fontSize: 11,
    letterSpacing: 1,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 10,
    letterSpacing: 1,
  },
  matchRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  teamCol: {
    flex: 1,
    alignItems: "center",
    gap: 8,
  },
  teamName: {
    fontSize: 15,
    textAlign: "center",
  },
  teamRecord: {
    fontSize: 12,
  },
  scoreBlock: {
    paddingHorizontal: 16,
    alignItems: "center",
  },
  scoreLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  score: {
    fontSize: 34,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  dash: {
    fontSize: 22,
  },
  byeText: {
    fontSize: 20,
    letterSpacing: 2,
  },
});
