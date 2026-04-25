import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ProposeTradeModal } from "@/components/trade/ProposeTradeModal";
import { TradeBlockSheet } from "@/components/trade/TradeBlockSheet";
import { TradeCard } from "@/components/trade/TradeCard";
import { TradeDetailModal } from "@/components/trade/TradeDetailModal";
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
} from "@/hooks/useTrades";
import { supabase } from "@/lib/supabase";
import { ms, s } from "@/utils/scale";

const TABS = ["Active", "History"];
const ACTIVE_STATUSES = ["pending", "accepted", "in_review"];
const HISTORY_STATUSES = ["completed", "rejected", "cancelled", "vetoed"];

export default function Trades() {
  const router = useRouter();
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
  const queryClient = useQueryClient();

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

      {/* Propose Trade Button / Deadline Banner */}
      {isPastDeadline ? (
        <View
          style={[
            styles.deadlineBanner,
            { backgroundColor: c.card, borderColor: c.border },
          ]}
        >
          <Ionicons
            name="lock-closed"
            size={14}
            color={c.secondaryText}
            accessible={false}
          />
          <ThemedText style={[styles.deadlineText, { color: c.secondaryText }]}>
            The trade deadline has passed. No new trades can be proposed.
          </ThemedText>
        </View>
      ) : (
        <TouchableOpacity
          style={[styles.proposeBtn, { backgroundColor: c.accent }]}
          onPress={() => setShowPropose(true)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Propose Trade"
        >
          <Text style={[styles.proposeBtnText, { color: c.accentText }]}>
            + Propose Trade
          </Text>
        </TouchableOpacity>
      )}

      {/* Trade Block pill */}
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
          <View style={styles.tradeBlockPillIcon}>
            <Ionicons
              name="megaphone-outline"
              size={13}
              color={c.accent}
              accessible={false}
            />
          </View>
          <ThemedText style={styles.tradeBlockPillText}>Trade Block</ThemedText>
          <View style={[styles.tradeBlockBadge, { backgroundColor: c.accent }]}>
            <ThemedText
              style={[styles.tradeBlockBadgeText, { color: c.accentText }]}
            >
              {(tradeBlock ?? []).reduce((sum, g) => sum + g.players.length, 0)}
            </ThemedText>
          </View>
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
  proposeBtn: {
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 6,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  proposeBtnText: {
    fontSize: ms(15),
    fontWeight: "700",
  },
  deadlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 6,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  deadlineText: {
    fontSize: ms(13),
    flex: 1,
  },
  scrollArea: {
    flex: 1,
  },

  // Trade Block pill
  tradeBlockPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
  },
  tradeBlockPillIcon: {
    width: 14,
    height: 14,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  tradeBlockPillText: {
    fontSize: ms(13),
    fontWeight: "600",
  },
  tradeBlockBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  tradeBlockBadgeText: {
    fontSize: ms(11),
    fontWeight: "700",
    lineHeight: 20,
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
