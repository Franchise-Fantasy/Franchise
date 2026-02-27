import { TradeCard } from '@/components/trade/TradeCard';
import { ThemedText } from '@/components/ThemedText';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Colors } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import {
  TradeBlockPlayer,
  TradeBlockTeamGroup,
  TradeProposalRow,
  useTradeBlock,
  useTradeProposals,
} from '@/hooks/useTrades';
import { supabase } from '@/lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ProposeTradeModal } from '@/components/trade/ProposeTradeModal';
import { TradeDetailModal } from '@/components/trade/TradeDetailModal';

const TABS = ['Active', 'History'];
const ACTIVE_STATUSES = ['pending', 'accepted', 'in_review'];
const HISTORY_STATUSES = ['completed', 'rejected', 'cancelled', 'vetoed'];

export default function Trades() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { leagueId, teamId } = useAppState();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState(0);
  const [showPropose, setShowPropose] = useState(false);
  const [preselectedTradeTeamId, setPreselectedTradeTeamId] = useState<string | undefined>();
  const [preselectedPlayer, setPreselectedPlayer] = useState<TradeBlockPlayer | undefined>();
  const [selectedProposal, setSelectedProposal] = useState<TradeProposalRow | null>(null);
  const [tradeBlockExpanded, setTradeBlockExpanded] = useState(true);

  const { data: proposals, isLoading } = useTradeProposals(leagueId);
  const { data: tradeBlock } = useTradeBlock(leagueId);

  // Auto-complete trades whose review period has expired (client-side check)
  useEffect(() => {
    if (!proposals) return;
    const now = Date.now();
    const expired = proposals.filter(
      (p) =>
        p.status === 'in_review' &&
        p.review_expires_at &&
        new Date(p.review_expires_at).getTime() < now
    );
    for (const p of expired) {
      supabase.functions
        .invoke('execute-trade', { body: { proposal_id: p.id } })
        .then(() => queryClient.invalidateQueries({ queryKey: ['tradeProposals', leagueId] }))
        .catch(console.error);
    }
  }, [proposals, leagueId, queryClient]);

  const filtered = useMemo(() => {
    if (!proposals) return [];
    const statuses = tab === 0 ? ACTIVE_STATUSES : HISTORY_STATUSES;
    return proposals.filter((p) => statuses.includes(p.status));
  }, [proposals, tab]);

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
  };

  const hasTradeBlock = (tradeBlock ?? []).length > 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.cardAlt }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={[styles.backText, { color: c.accent }]}>‹ Back</Text>
        </TouchableOpacity>
        <ThemedText type="defaultSemiBold" style={styles.title}>Trade Room</ThemedText>
        <View style={styles.backBtn} />
      </View>

      {/* Propose Trade Button */}
      <TouchableOpacity
        style={[styles.proposeBtn, { backgroundColor: c.accent }]}
        onPress={() => setShowPropose(true)}
        activeOpacity={0.8}
      >
        <Text style={[styles.proposeBtnText, { color: c.accentText }]}>+ Propose Trade</Text>
      </TouchableOpacity>

      {/* Scrollable content: trade block + trade list */}
      <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator={false}>
        {/* Trade Block */}
        {tab === 0 && hasTradeBlock && (
          <View style={styles.tradeBlockSection}>
            <TouchableOpacity
              style={styles.tradeBlockHeader}
              onPress={() => setTradeBlockExpanded(!tradeBlockExpanded)}
              activeOpacity={0.7}
            >
              <View style={styles.tradeBlockHeaderLeft}>
                <Ionicons name="megaphone-outline" size={16} color={c.accent} />
                <ThemedText type="defaultSemiBold" style={styles.tradeBlockTitle}>
                  Trade Block
                </ThemedText>
                <ThemedText style={[styles.tradeBlockCount, { color: c.secondaryText }]}>
                  ({(tradeBlock ?? []).reduce((sum, g) => sum + g.players.length, 0)})
                </ThemedText>
              </View>
              <Ionicons
                name={tradeBlockExpanded ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={c.secondaryText}
              />
            </TouchableOpacity>

            {tradeBlockExpanded && (tradeBlock ?? []).map((group: TradeBlockTeamGroup) => (
              <View key={group.team_id} style={styles.tradeBlockGroup}>
                <ThemedText style={[styles.tradeBlockTeamName, { color: c.secondaryText }]}>
                  {group.team_id === teamId ? 'Your Team' : group.team_name}
                </ThemedText>
                {group.players.map((p: TradeBlockPlayer) => (
                  <TouchableOpacity
                    key={p.player_id}
                    style={[styles.tradeBlockRow, { backgroundColor: c.card }]}
                    onPress={() => handleTradeBlockPlayerPress(p)}
                    activeOpacity={p.team_id === teamId ? 1 : 0.7}
                  >
                    <View style={styles.tradeBlockPlayerInfo}>
                      <ThemedText style={styles.tradeBlockPlayerName} numberOfLines={1}>
                        {p.name}
                      </ThemedText>
                      <ThemedText style={[styles.tradeBlockPlayerMeta, { color: c.secondaryText }]}>
                        {p.position} · {p.nba_team}
                      </ThemedText>
                    </View>
                    {p.team_id !== teamId && (
                      <Ionicons name="swap-horizontal-outline" size={16} color={c.accent} />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </View>
        )}

        {/* Trade list */}
        {isLoading ? (
          <ActivityIndicator style={styles.loader} />
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <ThemedText style={[styles.emptyText, { color: c.secondaryText }]}>
              {tab === 0 ? 'No active trades' : 'No trade history'}
            </ThemedText>
          </View>
        ) : (
          <View style={styles.list}>
            {filtered.map((item) => (
              <TradeCard key={item.id} proposal={item} onPress={() => setSelectedProposal(item)} />
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

      {/* Modals */}
      {showPropose && leagueId && teamId && (
        <ProposeTradeModal
          leagueId={leagueId}
          teamId={teamId}
          preselectedTeamId={preselectedTradeTeamId}
          preselectedPlayer={preselectedPlayer}
          onClose={handleProposeClose}
        />
      )}

      {selectedProposal && leagueId && teamId && (
        <TradeDetailModal
          proposal={selectedProposal}
          leagueId={leagueId}
          teamId={teamId}
          onClose={() => setSelectedProposal(null)}
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 70,
    paddingHorizontal: 8,
  },
  backText: {
    fontSize: 16,
    fontWeight: '500',
  },
  title: {
    fontSize: 16,
    textAlign: 'center',
  },
  proposeBtn: {
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 6,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  proposeBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
  scrollArea: {
    flex: 1,
  },

  // Trade Block
  tradeBlockSection: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  tradeBlockHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  tradeBlockHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tradeBlockTitle: {
    fontSize: 14,
  },
  tradeBlockCount: {
    fontSize: 13,
  },
  tradeBlockGroup: {
    marginBottom: 8,
  },
  tradeBlockTeamName: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
    marginTop: 4,
  },
  tradeBlockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginBottom: 4,
  },
  tradeBlockPlayerInfo: {
    flex: 1,
  },
  tradeBlockPlayerName: {
    fontSize: 13,
    fontWeight: '500',
  },
  tradeBlockPlayerMeta: {
    fontSize: 11,
  },

  // Trade list
  loader: {
    marginTop: 40,
  },
  empty: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 15,
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
