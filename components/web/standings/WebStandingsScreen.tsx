import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, TouchableOpacity, View } from "react-native";

import { TeamLogo } from "@/components/team/TeamLogo";
import { ThemedText } from "@/components/ui/ThemedText";
import { WebStandingsCard } from "@/components/web/home/WebStandingsCard";
import { cardShadow } from "@/constants/Colors";
import { useColors } from "@/hooks/useColors";
import { type TeamStanding } from "@/utils/league/standingsQueries";
import { type AllPlayResult } from "@/utils/scoring/allPlayRecord";
import { type SoSResult } from "@/utils/scoring/strengthOfSchedule";

type InfoKey = "luck" | "allplay" | "sos";

interface Props {
  leagueId: string;
  teamId: string | null;
  playoffTeams?: number | null;
  scoringType?: string;
  tiebreakerOrder?: string[] | null;
  allStandings: (TeamStanding & { rank: number })[] | undefined;
  allPlayRanked: AllPlayResult[];
  luckSorted: AllPlayResult[];
  sosSorted: SoSResult[];
  teamNameMap: Map<string, TeamStanding>;
  myAllPlay: AllPlayResult | null | undefined;
  mySoS: SoSResult | null | undefined;
  leagueAvgSoS: number;
  maxAbsLuck: number;
  hasFutureSoS: boolean;
  isCategories: boolean;
  onInfo: (key: InfoKey) => void;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function winPct(w: number, l: number, t: number): string {
  const total = w + l + t;
  if (total === 0) return ".000";
  const p = (w + t * 0.5) / total;
  return p >= 1 ? "1.000" : p.toFixed(3).replace(/^0/, "");
}

/**
 * Desktop web standings page — a single dense dashboard that surfaces every
 * lens at once (main table, all-play, luck, strength of schedule) instead of
 * the mobile screen's segmented tabs, plus a "Your Team" summary strip. All
 * data is computed by the parent screen and passed in, so the numbers stay in
 * lockstep with the mobile render; this is purely the wide-screen presentation.
 * Web-only.
 */
export function WebStandingsScreen(props: Props) {
  const c = useColors();
  const {
    leagueId,
    teamId,
    playoffTeams,
    scoringType,
    tiebreakerOrder,
    allStandings,
    allPlayRanked,
    luckSorted,
    sosSorted,
    teamNameMap,
    myAllPlay,
    mySoS,
    leagueAvgSoS,
    maxAbsLuck,
    hasFutureSoS,
    isCategories,
    onInfo,
  } = props;

  const myStanding = allStandings?.find((t) => t.id === teamId) ?? null;
  const totalTeams = allStandings?.length ?? 0;

  return (
    <View style={styles.page}>
      <YourTeamStrip
        c={c}
        myStanding={myStanding}
        totalTeams={totalTeams}
        myAllPlay={myAllPlay ?? null}
        mySoS={mySoS ?? null}
        leagueAvgSoS={leagueAvgSoS}
      />

      {/* Aligned 2×2 grid — same column widths in both rows so every panel
          header and card edge lines up (records views on top, rate views
          below), instead of two ragged independent-height stacks. */}
      <View style={styles.gridRow}>
        <View style={styles.cellWide}>
          <WebStandingsCard
            leagueId={leagueId}
            playoffTeams={playoffTeams}
            scoringType={scoringType}
            tiebreakerOrder={tiebreakerOrder}
            showSeeAllLink={false}
          />
        </View>
        <View style={styles.cellNarrow}>
          <AllPlayPanel
            c={c}
            allPlayRanked={allPlayRanked}
            teamNameMap={teamNameMap}
            teamId={teamId}
            onInfo={onInfo}
          />
        </View>
      </View>

      <View style={styles.gridRow}>
        <View style={styles.cellWide}>
          <SosPanel
            c={c}
            sosSorted={sosSorted}
            teamNameMap={teamNameMap}
            teamId={teamId}
            leagueAvgSoS={leagueAvgSoS}
            hasFutureSoS={hasFutureSoS}
            onInfo={onInfo}
          />
        </View>
        <View style={styles.cellNarrow}>
          <LuckPanel
            c={c}
            luckSorted={luckSorted}
            teamNameMap={teamNameMap}
            teamId={teamId}
            maxAbsLuck={maxAbsLuck}
            onInfo={onInfo}
          />
        </View>
      </View>
    </View>
  );
}

// ─── Shared bits ─────────────────────────────────────────────────────────────

type C = ReturnType<typeof useColors>;

function PanelHeader({ c, title, onInfo }: { c: C; title: string; onInfo?: () => void }) {
  return (
    <View style={styles.panelHead}>
      <View style={styles.panelHeadLeft}>
        <View style={[styles.rule, { backgroundColor: c.gold }]} />
        <ThemedText type="sectionLabel" style={{ color: c.text }}>
          {title}
        </ThemedText>
      </View>
      {onInfo && (
        <TouchableOpacity onPress={onInfo} accessibilityRole="button" accessibilityLabel={`About ${title}`} hitSlop={8}>
          <Ionicons name="information-circle-outline" size={18} color={c.secondaryText} />
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Your Team strip ─────────────────────────────────────────────────────────

function YourTeamStrip({
  c,
  myStanding,
  totalTeams,
  myAllPlay,
  mySoS,
  leagueAvgSoS,
}: {
  c: C;
  myStanding: (TeamStanding & { rank: number }) | null;
  totalTeams: number;
  myAllPlay: AllPlayResult | null;
  mySoS: SoSResult | null;
  leagueAvgSoS: number;
}) {
  if (!myStanding && !myAllPlay && !mySoS) return null;

  // Identity (rank + record) anchors the band; the three stats are the
  // differentiators worth surfacing above the full tables below.
  const stats: { label: string; value: string; sub?: string; color?: string }[] = [];
  if (myAllPlay) {
    const up = myAllPlay.luckIndex >= 0;
    stats.push({
      label: "LUCK",
      value: `${up ? "+" : ""}${myAllPlay.luckIndex.toFixed(1)}`,
      sub: up ? "Lucky" : "Unlucky",
      color: up ? c.success : c.danger,
    });
    stats.push({
      label: "ALL-PLAY",
      value: `${myAllPlay.allPlayWins}-${myAllPlay.allPlayLosses}`,
      sub: `${(myAllPlay.allPlayWinPct * 100).toFixed(0)}% win`,
    });
  }
  if (mySoS && mySoS.pastOpponents > 0) {
    stats.push({
      label: "SCHEDULE",
      value: `.${(mySoS.pastSoS * 1000).toFixed(0).padStart(3, "0")}`,
      sub: mySoS.pastSoS > leagueAvgSoS + 0.02 ? "Tough" : mySoS.pastSoS < leagueAvgSoS - 0.02 ? "Easy" : "Average",
    });
  }

  const record = myStanding
    ? myStanding.ties
      ? `${myStanding.wins}-${myStanding.losses}-${myStanding.ties}`
      : `${myStanding.wins}-${myStanding.losses}`
    : null;

  return (
    <View style={styles.bandWrap}>
      <View style={styles.panelHeadLeft}>
        <View style={[styles.rule, { backgroundColor: c.gold }]} />
        <ThemedText type="sectionLabel" style={{ color: c.text }}>
          Your Team
        </ThemedText>
      </View>
      <View style={[styles.band, { backgroundColor: c.card, borderColor: c.border }]}>
        {myStanding && (
          <View style={styles.bandIdentity}>
            <TeamLogo logoKey={myStanding.logo_key} teamName={myStanding.name} tricode={myStanding.tricode ?? undefined} size="large" />
            <View>
              <ThemedText numberOfLines={1} style={[styles.bandName, { color: c.text }]}>
                {myStanding.name}
              </ThemedText>
              <ThemedText style={[styles.bandSub, { color: c.secondaryText }]}>
                {ordinal(myStanding.rank)} of {totalTeams} · {record}
              </ThemedText>
            </View>
          </View>
        )}
        {myStanding && stats.length > 0 && <View style={[styles.bandDivider, { backgroundColor: c.border }]} />}
        <View style={styles.bandStats}>
          {stats.map((s, i) => (
            <React.Fragment key={s.label}>
              {i > 0 && <View style={[styles.bandStatDivider, { backgroundColor: c.border }]} />}
              <View style={styles.bandStat}>
                <ThemedText style={[styles.bandStatLabel, { color: c.secondaryText }]}>{s.label}</ThemedText>
                <ThemedText style={[styles.bandStatValue, { color: s.color ?? c.text }]}>{s.value}</ThemedText>
                {s.sub && <ThemedText style={[styles.bandStatSub, { color: c.secondaryText }]}>{s.sub}</ThemedText>}
              </View>
            </React.Fragment>
          ))}
        </View>
      </View>
    </View>
  );
}

// ─── All-Play panel ──────────────────────────────────────────────────────────

function AllPlayPanel({
  c,
  allPlayRanked,
  teamNameMap,
  teamId,
  onInfo,
}: {
  c: C;
  allPlayRanked: AllPlayResult[];
  teamNameMap: Map<string, TeamStanding>;
  teamId: string | null;
  onInfo: (k: InfoKey) => void;
}) {
  const router = useRouter();
  return (
    <View style={styles.panel}>
      <PanelHeader c={c} title="All-Play" onInfo={() => onInfo("allplay")} />
      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        {allPlayRanked.length === 0 ? (
          <ThemedText style={[styles.empty, { color: c.secondaryText }]}>Not enough games played yet.</ThemedText>
        ) : (
          <>
            <View style={[styles.rowHead, { borderBottomColor: c.border }]}>
              <ThemedText style={[styles.hCell, styles.apTeam, { color: c.secondaryText }]}>TEAM</ThemedText>
              <ThemedText style={[styles.hCell, styles.apNum, { color: c.secondaryText }]}>REC</ThemedText>
              <ThemedText style={[styles.hCell, styles.apNum, { color: c.secondaryText }]}>WIN%</ThemedText>
              <ThemedText style={[styles.hCell, styles.apNum, { color: c.secondaryText }]}>LUCK</ThemedText>
            </View>
            {allPlayRanked.map((r, idx) => {
              const team = teamNameMap.get(r.teamId);
              if (!team) return null;
              const isMe = r.teamId === teamId;
              const luckC = r.luckIndex >= 0.5 ? c.success : r.luckIndex <= -0.5 ? c.danger : c.secondaryText;
              return (
                <Pressable
                  key={r.teamId}
                  onPress={() => router.push((isMe ? "/(tabs)/roster" : `/team-roster/${r.teamId}`) as never)}
                  style={({ hovered }: { hovered?: boolean }) => [
                    styles.row,
                    { borderBottomColor: c.border },
                    idx === allPlayRanked.length - 1 && styles.rowLast,
                    isMe && { backgroundColor: c.activeCard },
                    hovered && !isMe && { backgroundColor: c.cardAlt },
                  ]}
                >
                  <View style={[styles.apTeam, styles.teamCell]}>
                    <TeamLogo logoKey={team.logo_key} teamName={team.name} tricode={team.tricode ?? undefined} size="small" />
                    <ThemedText numberOfLines={1} style={[styles.teamName, { color: c.text }]}>
                      {team.name}
                    </ThemedText>
                  </View>
                  <ThemedText type="mono" style={[styles.apNum, styles.num, { color: c.text }]}>
                    {r.allPlayWins}-{r.allPlayLosses}
                  </ThemedText>
                  <ThemedText type="mono" style={[styles.apNum, styles.num, { color: c.secondaryText }]}>
                    {(r.allPlayWinPct * 100).toFixed(0)}
                  </ThemedText>
                  <ThemedText type="mono" style={[styles.apNum, styles.num, { color: luckC }]}>
                    {r.luckIndex >= 0 ? "+" : ""}
                    {r.luckIndex.toFixed(1)}
                  </ThemedText>
                </Pressable>
              );
            })}
          </>
        )}
      </View>
    </View>
  );
}

// ─── Luck panel (diverging bars) ─────────────────────────────────────────────

function LuckPanel({
  c,
  luckSorted,
  teamNameMap,
  teamId,
  maxAbsLuck,
  onInfo,
}: {
  c: C;
  luckSorted: AllPlayResult[];
  teamNameMap: Map<string, TeamStanding>;
  teamId: string | null;
  maxAbsLuck: number;
  onInfo: (k: InfoKey) => void;
}) {
  return (
    <View style={styles.panel}>
      <PanelHeader c={c} title="Luck Index" onInfo={() => onInfo("luck")} />
      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        {luckSorted.length === 0 ? (
          <ThemedText style={[styles.empty, { color: c.secondaryText }]}>Not enough games played yet.</ThemedText>
        ) : (
          luckSorted.map((r, idx) => {
            const team = teamNameMap.get(r.teamId);
            if (!team) return null;
            const isMe = r.teamId === teamId;
            const positive = r.luckIndex >= 0;
            const frac = Math.min(1, Math.abs(r.luckIndex) / maxAbsLuck);
            const barColor = positive ? c.success : c.danger;
            return (
              <View
                key={r.teamId}
                style={[styles.luckRow, idx === luckSorted.length - 1 && styles.rowLast, { borderBottomColor: c.border }]}
              >
                <ThemedText numberOfLines={1} style={[styles.luckName, { color: c.text, fontWeight: isMe ? "700" : "500" }]}>
                  {team.tricode ?? team.name}
                </ThemedText>
                <View style={styles.luckTrack}>
                  <View style={[styles.luckCenter, { backgroundColor: c.border }]} />
                  <View
                    style={[
                      styles.luckBar,
                      {
                        backgroundColor: barColor,
                        width: `${frac * 48}%`,
                        ...(positive ? { left: "50%" } : { right: "50%" }),
                      },
                    ]}
                  />
                </View>
                <ThemedText type="mono" style={[styles.luckVal, { color: barColor }]}>
                  {positive ? "+" : ""}
                  {r.luckIndex.toFixed(1)}
                </ThemedText>
              </View>
            );
          })
        )}
      </View>
    </View>
  );
}

// ─── Strength of Schedule panel ──────────────────────────────────────────────

function SosPanel({
  c,
  sosSorted,
  teamNameMap,
  teamId,
  leagueAvgSoS,
  hasFutureSoS,
  onInfo,
}: {
  c: C;
  sosSorted: SoSResult[];
  teamNameMap: Map<string, TeamStanding>;
  teamId: string | null;
  leagueAvgSoS: number;
  hasFutureSoS: boolean;
  onInfo: (k: InfoKey) => void;
}) {
  return (
    <View style={styles.panel}>
      <PanelHeader c={c} title="Strength of Schedule" onInfo={() => onInfo("sos")} />
      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        {sosSorted.length === 0 ? (
          <ThemedText style={[styles.empty, { color: c.secondaryText }]}>Not enough games played yet.</ThemedText>
        ) : (
          <>
            <View style={[styles.rowHead, { borderBottomColor: c.border }]}>
              <ThemedText style={[styles.hCell, styles.sosTeam, { color: c.secondaryText }]}>TEAM</ThemedText>
              <ThemedText style={[styles.hCell, styles.sosNum, { color: c.secondaryText }]}>PAST</ThemedText>
              {hasFutureSoS && <ThemedText style={[styles.hCell, styles.sosNum, { color: c.secondaryText }]}>FUTURE</ThemedText>}
              <ThemedText style={[styles.hCell, styles.sosNum, { color: c.secondaryText }]}>OVERALL</ThemedText>
            </View>
            {sosSorted.map((r, idx) => {
              const team = teamNameMap.get(r.teamId);
              if (!team) return null;
              const isMe = r.teamId === teamId;
              const pastC =
                r.pastSoS > leagueAvgSoS + 0.02 ? c.danger : r.pastSoS < leagueAvgSoS - 0.02 ? c.success : c.secondaryText;
              return (
                <View
                  key={r.teamId}
                  style={[
                    styles.row,
                    { borderBottomColor: c.border },
                    idx === sosSorted.length - 1 && styles.rowLast,
                    isMe && { backgroundColor: c.activeCard },
                  ]}
                >
                  <View style={[styles.sosTeam, styles.teamCell]}>
                    <TeamLogo logoKey={team.logo_key} teamName={team.name} tricode={team.tricode ?? undefined} size="small" />
                    <ThemedText numberOfLines={1} style={[styles.teamName, { color: c.text }]}>
                      {team.name}
                    </ThemedText>
                  </View>
                  <ThemedText type="mono" style={[styles.sosNum, styles.num, { color: pastC }]}>
                    {r.pastOpponents > 0 ? (r.pastSoS * 100).toFixed(1) : "–"}
                  </ThemedText>
                  {hasFutureSoS && (
                    <ThemedText type="mono" style={[styles.sosNum, styles.num, { color: c.secondaryText }]}>
                      {r.futureSoS !== null ? (r.futureSoS * 100).toFixed(1) : "–"}
                    </ThemedText>
                  )}
                  <ThemedText type="mono" style={[styles.sosNum, styles.num, { color: c.secondaryText }]}>
                    {(r.overallSoS * 100).toFixed(1)}
                  </ThemedText>
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
  page: {
    paddingTop: 8,
  },
  gridRow: {
    flexDirection: "row",
    gap: 24,
    alignItems: "flex-start",
  },
  cellWide: {
    flex: 1.5,
    minWidth: 0,
  },
  cellNarrow: {
    flex: 1,
    minWidth: 0,
  },
  rule: {
    height: 2,
    width: 18,
  },
  // Your Team band — one cohesive unit: identity anchor + inline stats
  // separated by hairline dividers, rather than five floating tiles.
  bandWrap: {
    marginBottom: 22,
  },
  band: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 22,
    marginTop: 10,
    gap: 18,
    ...cardShadow,
  },
  bandIdentity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  bandName: {
    fontSize: 18,
    fontWeight: "800",
  },
  bandSub: {
    fontSize: 13,
    marginTop: 3,
    fontVariant: ["tabular-nums"],
  },
  bandDivider: {
    width: 1,
    alignSelf: "stretch",
    marginVertical: 2,
  },
  bandStats: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  bandStat: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 8,
  },
  bandStatDivider: {
    width: 1,
    height: 44,
  },
  bandStatLabel: {
    fontSize: 10,
    letterSpacing: 1,
  },
  bandStatValue: {
    fontSize: 23,
    fontWeight: "800",
    marginTop: 4,
    fontVariant: ["tabular-nums"],
  },
  bandStatSub: {
    fontSize: 11,
    marginTop: 2,
  },
  // Panels
  panel: {
    marginBottom: 18,
  },
  panelHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  panelHeadLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    paddingVertical: 4,
    ...cardShadow,
  },
  empty: {
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 24,
  },
  rowHead: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  hCell: {
    fontSize: 10,
    letterSpacing: 0.6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  teamCell: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  teamName: {
    flexShrink: 1,
    fontSize: 13.5,
    fontWeight: "600",
  },
  num: {
    fontSize: 12.5,
    fontVariant: ["tabular-nums"],
  },
  // All-Play columns
  apTeam: {
    flex: 1,
    minWidth: 0,
  },
  apNum: {
    width: 52,
    textAlign: "right",
  },
  // Luck bars
  luckRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  luckName: {
    width: 72,
    fontSize: 12.5,
  },
  luckTrack: {
    flex: 1,
    height: 14,
    position: "relative",
  },
  luckCenter: {
    position: "absolute",
    left: "50%",
    top: 0,
    bottom: 0,
    width: 1,
  },
  luckBar: {
    position: "absolute",
    top: 2,
    height: 10,
    borderRadius: 3,
    opacity: 0.8,
  },
  luckVal: {
    width: 44,
    textAlign: "right",
    fontSize: 12.5,
    fontVariant: ["tabular-nums"],
  },
  // SoS columns
  sosTeam: {
    flex: 1,
    minWidth: 0,
  },
  sosNum: {
    width: 60,
    textAlign: "right",
  },
});
