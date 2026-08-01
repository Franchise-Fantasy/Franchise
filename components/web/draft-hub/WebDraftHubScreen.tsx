import { useRouter } from "expo-router";
import React, { useState } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";

import { ByTeamTab } from "@/components/draft-hub/ByTeamTab";
import { ByYearTab } from "@/components/draft-hub/ByYearTab";
import { ProspectsTab } from "@/components/draft-hub/ProspectsTab";
import { UpcomingDraftCard } from "@/components/draft-hub/UpcomingDraftCard";
import { LotteryResolutionSummary } from "@/components/lottery/LotteryResolutionSummary";
import { LogoSpinner } from "@/components/ui/LogoSpinner";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ThemedText } from "@/components/ui/ThemedText";
import { PanelHeader } from "@/components/web/PanelHeader";
import { useColors } from "@/hooks/useColors";
import { type DraftHubData } from "@/hooks/useDraftHub";

const TABS = ["Picks", "Prospects"] as const;

interface Props {
  leagueId: string;
  /** Active league season, for the lottery resolution summary. Null until the league query resolves. */
  season: string | null;
  data: DraftHubData | undefined;
  isLoading: boolean;
  /** Deep-link entry point (`/draft-hub?tab=prospects`). */
  initialTab: "picks" | "prospects";
}

/**
 * Desktop web Draft Hub. The mobile screen stacks By Year / By Team /
 * Prospects behind a three-way segmented control; on a wide screen the two
 * pick views fit side by side, so this collapses the tabs to Picks vs.
 * Prospects and shows the round-by-round board and the per-team asset list
 * together, each pane scrolling independently under a fixed draft banner.
 *
 * The tab components are reused verbatim — this file owns layout only, so the
 * two renders can't drift. Web-only; never reaches a native bundle.
 */
export function WebDraftHubScreen({ leagueId, season, data, isLoading, initialTab }: Props) {
  const c = useColors();
  const router = useRouter();
  const [tab, setTab] = useState(initialTab === "prospects" ? 1 : 0);

  const showProspects = tab === 1;

  return (
    <View style={styles.page}>
      <View style={styles.topBar}>
        <SegmentedControl
          options={TABS}
          selectedIndex={tab}
          onSelect={setTab}
          accessibilityLabel="Draft hub view"
        />
        {showProspects && (
          <TouchableOpacity
            onPress={() => router.push("/prospect-board" as never)}
            accessibilityRole="link"
            accessibilityLabel="My Board"
            accessibilityHint="Opens your personal prospect board"
          >
            <ThemedText style={[styles.boardLink, { color: c.accent }]}>My Board</ThemedText>
          </TouchableOpacity>
        )}
      </View>

      {showProspects ? (
        // Prospect cards are a single-column ranked list — hold them to a
        // reading width instead of stretching them across the full page.
        <View style={styles.prospectColumn}>
          <ProspectsTab />
        </View>
      ) : (
        <>
          {/* Draft banner — schedule on the left, lottery fallout on the right.
              Both render null most of the season, collapsing the row to zero. */}
          <View style={styles.banner}>
            <View style={styles.bannerCell}>
              <UpcomingDraftCard leagueId={leagueId} />
            </View>
            {season && (
              <View style={styles.bannerCell}>
                <LotteryResolutionSummary leagueId={leagueId} season={season} collapsible />
              </View>
            )}
          </View>

          {isLoading || !data ? (
            <View style={styles.loading}>
              <LogoSpinner />
            </View>
          ) : (
            <View style={styles.grid}>
              <View style={styles.paneWide}>
                <PanelHeader title="Pick Board" />
                <View style={[styles.paneBody, { borderColor: c.border, backgroundColor: c.card }]}>
                  <ByYearTab
                    picks={data.picks}
                    swaps={data.swaps}
                    teams={data.teams}
                    validSeasons={data.validSeasons}
                    leagueSettings={data.leagueSettings}
                  />
                </View>
              </View>

              <View style={styles.paneNarrow}>
                <PanelHeader title="Team Assets" />
                <View style={[styles.paneBody, { borderColor: c.border, backgroundColor: c.card }]}>
                  <ByTeamTab
                    picks={data.picks}
                    swaps={data.swaps}
                    teams={data.teams}
                    validSeasons={data.validSeasons}
                    pickProtectionsEnabled={data.leagueSettings.pickProtectionsEnabled}
                    pickSwapsEnabled={data.leagueSettings.pickSwapsEnabled}
                  />
                </View>
              </View>
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    minHeight: 0,
    paddingTop: 8,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  boardLink: {
    fontSize: 14,
    fontWeight: "600",
  },
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 20,
  },
  bannerCell: {
    flex: 1,
    minWidth: 0,
  },
  // The two pick panes each scroll on their own so the draft banner stays put
  // — the desktop equivalent of the mobile screen's single page scroll.
  grid: {
    flex: 1,
    minHeight: 0,
    flexDirection: "row",
    gap: 20,
    paddingTop: 6,
    paddingBottom: 16,
  },
  paneWide: {
    flex: 1.45,
    minWidth: 0,
    minHeight: 0,
  },
  paneNarrow: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  paneBody: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
    borderWidth: 1,
    borderRadius: 16,
  },
  prospectColumn: {
    flex: 1,
    minHeight: 0,
    width: "100%",
    maxWidth: 720,
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
