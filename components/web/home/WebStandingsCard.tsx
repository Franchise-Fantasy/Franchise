import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, TouchableOpacity, View } from "react-native";

import { TeamLogo } from "@/components/team/TeamLogo";
import { LogoSpinner } from "@/components/ui/LogoSpinner";
import { ThemedText } from "@/components/ui/ThemedText";
import { cardShadow } from "@/constants/Colors";
import { queryKeys } from "@/constants/queryKeys";
import { useAppState } from "@/context/AppStateProvider";
import { useColors } from "@/hooks/useColors";
import { supabase } from "@/lib/supabase";
import { computePlayoffStatuses } from "@/utils/league/playoffStatuses";
import {
  fetchStandingsMatchups,
  fetchStandingsTeams,
  resolveStandings,
  type TeamStanding,
} from "@/utils/league/standingsQueries";

const DEFAULT_TIEBREAKER = ["head_to_head", "points_for"];

interface Props {
  leagueId: string;
  playoffTeams?: number | null;
  scoringType?: string;
  tiebreakerOrder?: string[] | null;
  /** Hide the "See all →" link when already on the full standings page. */
  showSeeAllLink?: boolean;
}

function winPct(w: number, l: number, t: number): string {
  const total = w + l + t;
  if (total === 0) return ".000";
  const pct = (w + t * 0.5) / total;
  return pct >= 1 ? "1.000" : pct.toFixed(3).replace(/^0/, "");
}

/**
 * Desktop web standings — a dense data table (rank, record, win%, points-for /
 * against / differential, streak) with hover rows and a playoff-cutoff rule.
 * Reuses the exact resolution utils the mobile StandingsSection reads
 * (fetchStandingsTeams / resolveStandings / computePlayoffStatuses) so the order
 * can't drift; only the presentation is web-native. Division splits collapse to
 * a league-wide table here — the full standings page owns the divisional view.
 * Web-only.
 */
export function WebStandingsCard({ leagueId, playoffTeams, scoringType, tiebreakerOrder, showSeeAllLink = true }: Props) {
  const c = useColors();
  const router = useRouter();
  const { teamId } = useAppState();
  const tiebreakers = tiebreakerOrder ?? DEFAULT_TIEBREAKER;
  const isCategories = scoringType === "h2h_categories";

  const { data: rawTeams, isLoading } = useQuery({
    queryKey: queryKeys.standings(leagueId),
    queryFn: () => fetchStandingsTeams(leagueId),
    enabled: !!leagueId,
  });
  const { data: matchups } = useQuery({
    queryKey: queryKeys.standingsH2h(leagueId),
    queryFn: () => fetchStandingsMatchups(leagueId),
    enabled: !!leagueId,
  });
  const { data: remainingGames } = useQuery({
    queryKey: queryKeys.remainingGames(leagueId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("league_matchups")
        .select("home_team_id, away_team_id")
        .eq("league_id", leagueId)
        .eq("is_finalized", false)
        .is("playoff_round", null);
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const m of data) {
        if (!m.away_team_id) continue;
        counts.set(m.home_team_id, (counts.get(m.home_team_id) ?? 0) + 1);
        counts.set(m.away_team_id, (counts.get(m.away_team_id) ?? 0) + 1);
      }
      return counts;
    },
    enabled: !!leagueId && !!playoffTeams,
  });

  const standings = rawTeams ? resolveStandings(rawTeams, matchups ?? [], tiebreakers) : undefined;
  const statuses =
    standings && remainingGames && playoffTeams
      ? computePlayoffStatuses(standings, remainingGames, playoffTeams, matchups ?? [], tiebreakers)
      : null;
  const anyTies = (rawTeams ?? []).some((t) => (t.ties ?? 0) > 0);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <View style={[styles.rule, { backgroundColor: c.gold }]} />
          <ThemedText type="sectionLabel" style={{ color: c.text }}>
            Standings
          </ThemedText>
        </View>
        {showSeeAllLink && !!standings?.length && (
          <TouchableOpacity
            onPress={() => router.push("/standings" as never)}
            accessibilityRole="link"
            accessibilityLabel="View full standings"
          >
            <ThemedText type="varsitySmall" style={{ color: c.accent }}>
              See all →
            </ThemedText>
          </TouchableOpacity>
        )}
      </View>

      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        {isLoading || !standings ? (
          <View style={styles.loading}>
            <LogoSpinner />
          </View>
        ) : standings.length === 0 ? (
          <ThemedText style={[styles.empty, { color: c.secondaryText }]}>
            No standings available yet.
          </ThemedText>
        ) : (
          <>
            <View style={[styles.colHead, { borderBottomColor: c.border }]}>
              <ThemedText style={[styles.hCell, styles.cRank, { color: c.secondaryText }]}>#</ThemedText>
              <ThemedText style={[styles.hCell, styles.cTeam, { color: c.secondaryText }]}>TEAM</ThemedText>
              <ThemedText style={[styles.hCell, styles.cNum, { color: c.secondaryText }]}>
                {anyTies ? "W-L-T" : "W-L"}
              </ThemedText>
              <ThemedText style={[styles.hCell, styles.cNum, { color: c.secondaryText }]}>PCT</ThemedText>
              <ThemedText style={[styles.hCell, styles.cGb, { color: c.secondaryText }]}>GB</ThemedText>
              <ThemedText style={[styles.hCell, styles.cNum, { color: c.secondaryText }]}>
                {isCategories ? "CW" : "PF"}
              </ThemedText>
              <ThemedText style={[styles.hCell, styles.cNum, { color: c.secondaryText }]}>
                {isCategories ? "CL" : "PA"}
              </ThemedText>
              <ThemedText style={[styles.hCell, styles.cNum, { color: c.secondaryText }]}>DIFF</ThemedText>
              <ThemedText style={[styles.hCell, styles.cStrk, { color: c.secondaryText }]}>STRK</ThemedText>
            </View>

            {standings.map((team, idx) => {
              const t = team as TeamStanding & { rank: number };
              const isMe = t.id === teamId;
              const status = statuses?.get(t.id);
              const pf = Math.round(Number(t.points_for));
              const pa = Math.round(Number(t.points_against));
              const diff = pf - pa;
              const streak = t.streak && t.streak !== "W0" && t.streak !== "L0" ? t.streak : null;
              const streakUp = streak?.[0] === "W";
              const rec = anyTies ? `${t.wins}-${t.losses}-${t.ties}` : `${t.wins}-${t.losses}`;
              const leader = standings[0] as TeamStanding;
              const gb = (leader.wins - t.wins + (t.losses - leader.losses)) / 2;
              const gbLabel = gb <= 0 ? "–" : Number.isInteger(gb) ? String(gb) : gb.toFixed(1);
              const showCutoff = !!playoffTeams && t.rank === playoffTeams + 1;

              return (
                <View key={t.id}>
                  {showCutoff && (
                    <View style={styles.cutoff}>
                      <View style={[styles.cutoffLine, { backgroundColor: c.gold }]} />
                      <ThemedText style={[styles.cutoffLabel, { color: c.gold }]}>PLAYOFF LINE</ThemedText>
                      <View style={[styles.cutoffLine, { backgroundColor: c.gold }]} />
                    </View>
                  )}
                  <Pressable
                    onPress={() =>
                      isMe ? router.push("/(tabs)/roster" as never) : router.push(`/team-roster/${t.id}` as never)
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`${t.name}, rank ${t.rank}, ${rec}${streak ? `, streak ${streak}` : ""}`}
                    style={({ hovered }: { hovered?: boolean }) => [
                      styles.row,
                      { borderBottomColor: c.border },
                      idx === standings.length - 1 && styles.rowLast,
                      isMe && { backgroundColor: c.activeCard },
                      hovered && !isMe && { backgroundColor: c.cardAlt },
                    ]}
                  >
                    {isMe && <View style={[styles.meBar, { backgroundColor: c.gold }]} />}
                    <ThemedText type="mono" style={[styles.cRank, styles.rankText, { color: isMe ? c.gold : c.secondaryText }]}>
                      {t.rank}
                    </ThemedText>
                    <View style={[styles.cTeam, styles.teamCell]}>
                      <TeamLogo logoKey={t.logo_key} teamName={t.name} tricode={t.tricode ?? undefined} size="small" />
                      <ThemedText numberOfLines={1} style={[styles.teamName, { color: c.text }]}>
                        {t.name}
                      </ThemedText>
                      {status === "clinched" && (
                        <View style={[styles.tag, { backgroundColor: c.successMuted }]}>
                          <ThemedText style={[styles.tagText, { color: c.success }]}>x</ThemedText>
                        </View>
                      )}
                      {status === "eliminated" && (
                        <View style={[styles.tag, { backgroundColor: c.dangerMuted }]}>
                          <ThemedText style={[styles.tagText, { color: c.danger }]}>e</ThemedText>
                        </View>
                      )}
                    </View>
                    <ThemedText type="mono" style={[styles.cNum, styles.num, { color: c.text }]}>{rec}</ThemedText>
                    <ThemedText type="mono" style={[styles.cNum, styles.num, { color: c.secondaryText }]}>
                      {winPct(t.wins, t.losses, t.ties)}
                    </ThemedText>
                    <ThemedText type="mono" style={[styles.cGb, styles.num, { color: c.secondaryText }]}>
                      {gbLabel}
                    </ThemedText>
                    <ThemedText type="mono" style={[styles.cNum, styles.num, { color: c.secondaryText }]}>{pf}</ThemedText>
                    <ThemedText type="mono" style={[styles.cNum, styles.num, { color: c.secondaryText }]}>{pa}</ThemedText>
                    <ThemedText
                      type="mono"
                      style={[styles.cNum, styles.num, { color: diff > 0 ? c.success : diff < 0 ? c.danger : c.secondaryText }]}
                    >
                      {diff > 0 ? `+${diff}` : diff}
                    </ThemedText>
                    <View style={styles.cStrk}>
                      {streak ? (
                        <ThemedText type="mono" style={[styles.strk, { color: streakUp ? c.success : c.danger }]}>
                          {streak}
                        </ThemedText>
                      ) : (
                        <ThemedText type="mono" style={[styles.strk, { color: c.secondaryText }]}>–</ThemedText>
                      )}
                    </View>
                  </Pressable>
                </View>
              );
            })}
          </>
        )}
      </View>
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
    overflow: "hidden",
    paddingVertical: 4,
    ...cardShadow,
  },
  loading: {
    alignItems: "center",
    paddingVertical: 28,
  },
  empty: {
    fontSize: 14,
    textAlign: "center",
    paddingVertical: 28,
  },
  colHead: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  hCell: {
    fontSize: 10,
    letterSpacing: 0.8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  meBar: {
    position: "absolute",
    left: 0,
    top: 6,
    bottom: 6,
    width: 3,
    borderRadius: 2,
  },
  cRank: {
    width: 32,
  },
  rankText: {
    fontSize: 13,
  },
  cTeam: {
    flex: 1,
    minWidth: 0,
  },
  teamCell: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  teamName: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: "600",
  },
  tag: {
    width: 16,
    height: 16,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  tagText: {
    fontSize: 10,
    fontWeight: "700",
    lineHeight: 16,
  },
  cNum: {
    width: 60,
    textAlign: "right",
  },
  cGb: {
    width: 44,
    textAlign: "right",
  },
  num: {
    fontSize: 13,
    fontVariant: ["tabular-nums"],
  },
  cStrk: {
    width: 54,
    alignItems: "flex-end",
    textAlign: "right",
  },
  strk: {
    fontSize: 13,
    fontVariant: ["tabular-nums"],
  },
  cutoff: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 6,
  },
  cutoffLine: {
    flex: 1,
    height: 1,
    opacity: 0.5,
  },
  cutoffLabel: {
    fontSize: 9,
    letterSpacing: 1.2,
    fontWeight: "700",
  },
});
