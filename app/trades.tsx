import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ProposeTradeModal } from "@/components/trade/ProposeTradeModal";
import { TradeBlockSheet } from "@/components/trade/TradeBlockSheet";
import { TradeCard } from "@/components/trade/TradeCard";
import { TradeDetailModal } from "@/components/trade/TradeDetailModal";
import { Badge } from "@/components/ui/Badge";
import { BrandButton } from "@/components/ui/BrandButton";
import { LogoSpinner } from "@/components/ui/LogoSpinner";
import { PageHeader } from "@/components/ui/PageHeader";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ThemedText } from "@/components/ui/ThemedText";
import { Colors } from "@/constants/Colors";
import { queryKeys } from "@/constants/queryKeys";
import { useAppState } from "@/context/AppStateProvider";
import { useColorScheme } from "@/hooks/useColorScheme";
import {
  TradeBlockPlayer,
  TradeProposalRow,
  useTradeBlock,
  useTradeProposals,
  useTradeProposalsHeadshots,
} from "@/hooks/useTrades";
import { supabase } from "@/lib/supabase";
import { ms } from "@/utils/scale";

const TABS = ["Active", "History"];
const ACTIVE_STATUSES = ["pending", "accepted", "in_review"];
const HISTORY_STATUSES = ["completed", "rejected", "cancelled", "vetoed"];

export default function Trades() {
  const params = useLocalSearchParams<{
    proposeTeamId?: string;
    proposePlayerId?: string;
    proposePlayerName?: string;
    proposePlayerPos?: string;
    proposePlayerTeam?: string;
    proposePlayerFpts?: string;
  }>();
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const { leagueId, teamId } = useAppState();

  const [tab, setTab] = useState(0);
  const [showPropose, setShowPropose] = useState(false);
  const [preselectedTradeTeamId, setPreselectedTradeTeamId] = useState<
    string | undefined
  >();
  const [preselectedPlayer, setPreselectedPlayer] = useState<
    TradeBlockPlayer | undefined
  >();
  const [selectedProposal, setSelectedProposal] =
    useState<TradeProposalRow | null>(null);
  const [counterofferProposal, setCounterofferProposal] =
    useState<TradeProposalRow | null>(null);
  const [editProposal, setEditProposal] = useState<TradeProposalRow | null>(null);
  const [showTradeBlock, setShowTradeBlock] = useState(false);

  // Auto-open propose modal when navigated with route params
  useEffect(() => {
    if (params.proposePlayerId && params.proposePlayerName) {
      const fpts = params.proposePlayerFpts ? parseFloat(params.proposePlayerFpts) : undefined;
      setPreselectedPlayer({
        player_id: params.proposePlayerId,
        name: params.proposePlayerName,
        position: params.proposePlayerPos ?? "",
        pro_team: params.proposePlayerTeam ?? "",
        team_id: params.proposeTeamId ?? "",
        team_name: "",
        trade_block_note: null,
        trade_block_interest: [],
        interest_team_names: {},
        avg_fpts: fpts,
      } as TradeBlockPlayer & { avg_fpts?: number });
      if (params.proposeTeamId) {
        setPreselectedTradeTeamId(params.proposeTeamId);
      }
      setShowPropose(true);
    }
  }, [params.proposePlayerId]);

  const { data: proposals, isLoading, refetch: refetchProposals } = useTradeProposals(leagueId);
  const { data: tradeBlock, refetch: refetchTradeBlock } = useTradeBlock(leagueId);
  // Single batched fetch of every player headshot referenced across all
  // visible proposals — pushed down to each TradeCard so cards don't
  // each issue their own query.
  const { data: playerHeadshotMap } = useTradeProposalsHeadshots(proposals);
  const [refreshing, setRefreshing] = useState(false);
  const lastRefresh = useRef(0);

  const onRefresh = useCallback(async () => {
    if (Date.now() - lastRefresh.current < 10_000) return;
    lastRefresh.current = Date.now();
    setRefreshing(true);
    await Promise.all([refetchProposals(), refetchTradeBlock()]);
    setRefreshing(false);
  }, [refetchProposals, refetchTradeBlock]);

  // Check trade deadline
  const { data: leagueDeadline } = useQuery({
    queryKey: queryKeys.leagueDeadline(leagueId!),
    queryFn: async () => {
      const { data } = await supabase
        .from("leagues")
        .select("trade_deadline")
        .eq("id", leagueId!)
        .single();
      return data?.trade_deadline as string | null;
    },
    enabled: !!leagueId,
  });
  const isPastDeadline =
    !!leagueDeadline && new Date(leagueDeadline + "T23:59:59") < new Date();

  const filtered = useMemo(() => {
    if (!proposals) return [];
    const statuses = tab === 0 ? ACTIVE_STATUSES : HISTORY_STATUSES;
    return proposals.filter((p) => {
      if (!statuses.includes(p.status)) return false;
      // Hide pending proposals the user isn't involved in
      if (p.status === 'pending' && !p.teams.some((t) => t.team_id === teamId)) return false;
      return true;
    });
  }, [proposals, tab, teamId]);

  const handleTradeBlockPlayerPress = (player: TradeBlockPlayer) => {
    if (player.team_id === teamId) return;
    setPreselectedTradeTeamId(player.team_id);
    setPreselectedPlayer(player);
    setShowPropose(true);
  };

  const handleProposeClose = () => {
    setShowPropose(false);
    setPreselectedTradeTeamId(undefined);
    setPreselectedPlayer(undefined);
    setCounterofferProposal(null);
    setEditProposal(null);
  };

  const handleCounteroffer = (proposal: TradeProposalRow) => {
    setCounterofferProposal(proposal);
    setSelectedProposal(null);
    setShowPropose(true);
  };

  const handleEdit = (proposal: TradeProposalRow) => {
    setEditProposal(proposal);
    setSelectedProposal(null);
    setShowPropose(true);
  };

  const hasTradeBlock = (tradeBlock ?? []).length > 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.cardAlt }]}>
      <PageHeader title="Trade Room" />

      {/* Trade Floor banner — strong type on the page surface, no
          turfGreen card (HomeHero stays sacred to the home page). The
          identity here is a giant outlined swap-arrow watermark behind a
          centered Alfa Slab "Make a Move." plus a large filled CTA. */}
      <View style={styles.dealSection}>
        <View style={styles.dealWatermarkWrap} pointerEvents="none">
          <Ionicons
            name="swap-horizontal"
            size={ms(170)}
            color={c.gold}
            style={styles.dealWatermark}
            accessible={false}
          />
        </View>

        <View style={styles.dealEyebrowRow}>
          <View style={[styles.dealRule, { backgroundColor: c.gold }]} />
          <ThemedText
            type="varsitySmall"
            style={[styles.dealEyebrow, { color: c.gold }]}
            numberOfLines={1}
          >
            Front Office
          </ThemedText>
          <View style={[styles.dealRule, styles.dealRuleFlex, { backgroundColor: c.gold }]} />
        </View>

        <ThemedText
          type="display"
          style={[styles.dealTitle, { color: c.text }]}
          accessibilityRole="header"
        >
          Make a Move.
        </ThemedText>

        {isPastDeadline ? (
          <View style={[styles.dealDeadlineRow, { borderColor: c.border, backgroundColor: c.cardAlt }]}>
            <Ionicons name="lock-closed" size={14} color={c.secondaryText} accessible={false} />
            <ThemedText style={[styles.dealDeadlineText, { color: c.secondaryText }]}>
              The trade deadline has passed. No new trades can be proposed.
            </ThemedText>
          </View>
        ) : (
          <View style={styles.dealCta}>
            <BrandButton
              label="Propose Trade"
              icon="swap-horizontal"
              variant="primary"
              size="large"
              fullWidth
              onPress={() => setShowPropose(true)}
              accessibilityLabel="Propose trade"
            />
          </View>
        )}
      </View>

      {/* Trade Block pill — gold-rule eyebrow chip when trade block has
          listings. Tap to open the BottomSheet of available players. */}
      {tab === 0 && hasTradeBlock && (
        <TouchableOpacity
          style={[
            styles.tradeBlockPill,
            { backgroundColor: c.card, borderColor: c.border },
          ]}
          onPress={() => setShowTradeBlock(true)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`Trade Block, ${(tradeBlock ?? []).reduce((sum, g) => sum + g.players.length, 0)} players`}
        >
          <Ionicons
            name="megaphone-outline"
            size={13}
            color={c.gold}
            accessible={false}
          />
          <ThemedText
            type="varsitySmall"
            style={[styles.tradeBlockPillText, { color: c.gold }]}
          >
            Trade Block
          </ThemedText>
          <Badge
            label={String((tradeBlock ?? []).reduce((sum, g) => sum + g.players.length, 0))}
            variant="gold"
            size="small"
          />
        </TouchableOpacity>
      )}

      {/* Scrollable content: trade list */}
      <ScrollView
        style={styles.scrollArea}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            accessibilityLabel="Pull to refresh trades"
          />
        }
      >
        {/* Trade list */}
        {isLoading ? (
          <View style={styles.loader}><LogoSpinner /></View>
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <ThemedText style={[styles.emptyText, { color: c.secondaryText }]}>
              {tab === 0 ? "No active trades" : "No trade history"}
            </ThemedText>
          </View>
        ) : (
          <View style={styles.list}>
            {filtered.map((item) => (
              <TradeCard
                key={item.id}
                proposal={item}
                onPress={() => setSelectedProposal(item)}
                playerHeadshotMap={playerHeadshotMap}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {/* Tabs at bottom */}
      <View style={[styles.tabRow, { borderTopColor: c.border }]}>
        <SegmentedControl
          options={TABS}
          selectedIndex={tab}
          onSelect={setTab}
        />
      </View>

      {/* Trade Block Sheet */}
      {showTradeBlock && leagueId && teamId && (
        <TradeBlockSheet
          visible={showTradeBlock}
          tradeBlock={tradeBlock ?? []}
          leagueId={leagueId}
          teamId={teamId}
          onClose={() => setShowTradeBlock(false)}
          onPlayerPress={(player) => {
            setShowTradeBlock(false);
            handleTradeBlockPlayerPress(player);
          }}
        />
      )}

      {/* Modals */}
      {showPropose && leagueId && teamId && (
        <ProposeTradeModal
          leagueId={leagueId}
          teamId={teamId}
          preselectedTeamId={preselectedTradeTeamId}
          preselectedPlayer={preselectedPlayer}
          counterofferData={counterofferProposal ? {
            originalProposalId: counterofferProposal.id,
            teams: counterofferProposal.teams,
            items: counterofferProposal.items,
          } : undefined}
          editData={editProposal ? {
            originalProposalId: editProposal.id,
            teams: editProposal.teams,
            items: editProposal.items,
            notes: editProposal.notes,
          } : undefined}
          isPastDeadline={isPastDeadline}
          onClose={handleProposeClose}
        />
      )}

      {selectedProposal && leagueId && teamId && (
        <TradeDetailModal
          proposal={selectedProposal}
          leagueId={leagueId}
          teamId={teamId}
          onClose={() => setSelectedProposal(null)}
          onCounteroffer={isPastDeadline ? undefined : handleCounteroffer}
          onEdit={isPastDeadline ? undefined : handleEdit}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 70,
    paddingHorizontal: 8,
  },
  backText: {
    fontSize: ms(16),
    fontWeight: "500",
  },
  title: {
    fontSize: ms(16),
    textAlign: "center",
  },
  // Trade Floor banner — type-driven, no surface card. The big outlined
  // swap-horizontal icon sits behind the title at low opacity as a brand
  // watermark, anchoring the section visually without copying HomeHero's
  // turfGreen recipe.
  dealSection: {
    position: "relative",
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    overflow: "hidden",
  },
  dealWatermarkWrap: {
    position: "absolute",
    right: -20,
    top: -10,
    bottom: 0,
    width: 200,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  dealWatermark: {
    opacity: 0.08,
  },
  dealEyebrowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  dealRule: {
    height: 2,
    width: 18,
  },
  dealRuleFlex: { flex: 1 },
  dealEyebrow: {
    fontSize: ms(10),
    letterSpacing: 1.4,
  },
  dealTitle: {
    fontSize: ms(32),
    lineHeight: ms(36),
    letterSpacing: -0.4,
    marginBottom: 14,
  },
  dealCta: {
    // BrandButton large + fullWidth carries its own size — no extra wrap.
  },
  dealDeadlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dealDeadlineText: {
    fontSize: ms(13),
    flex: 1,
  },
  scrollArea: {
    flex: 1,
  },

  // Trade Block pill — chip with gold accents matching the brand's
  // varsity-caps eyebrow rhythm.
  tradeBlockPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tradeBlockPillText: {
    fontSize: ms(10),
    letterSpacing: 1.2,
  },

  // Trade list
  loader: {
    marginTop: 40,
  },
  empty: {
    paddingVertical: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontSize: ms(15),
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  tabRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});

export const options = {
  headerShown: false,
};
