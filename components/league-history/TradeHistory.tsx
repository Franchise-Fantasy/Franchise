import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { TradeCard } from '@/components/trade/TradeCard';
import { TradeDetailModal } from '@/components/trade/TradeDetailModal';
import { ThemedText } from '@/components/ui/ThemedText';
import { useAppState } from '@/context/AppStateProvider';
import { useColors } from '@/hooks/useColors';
import {
  TradeProposalRow,
  useTradeProposals,
  useTradeProposalsHeadshots,
} from '@/hooks/useTrades';
import { ms, s } from '@/utils/scale';

interface TradeHistoryProps {
  leagueId: string;
}

const HISTORICAL_STATUSES = new Set(['completed', 'reversed']);

export function TradeHistory({ leagueId }: TradeHistoryProps) {
  const c = useColors();
  const { teamId } = useAppState();
  const { data: allProposals } = useTradeProposals(leagueId);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [detailProposal, setDetailProposal] = useState<TradeProposalRow | null>(null);

  const historicalTrades = useMemo(() => {
    if (!allProposals) return [];
    return allProposals.filter((p) => HISTORICAL_STATUSES.has(p.status));
  }, [allProposals]);

  const teams = useMemo(() => {
    const teamMap = new Map<string, string>();
    for (const t of historicalTrades) {
      for (const team of t.teams) {
        teamMap.set(team.team_id, team.team_name);
      }
    }
    return [...teamMap.entries()].map(([id, name]) => ({ id, name }));
  }, [historicalTrades]);

  const filteredTrades = useMemo(() => {
    if (!selectedTeam) return historicalTrades;
    return historicalTrades.filter((t) =>
      t.teams.some((team) => team.team_id === selectedTeam),
    );
  }, [historicalTrades, selectedTeam]);

  // Single batched headshot fetch for every player on every visible card.
  const { data: playerHeadshotMap } = useTradeProposalsHeadshots(filteredTrades);

  if (historicalTrades.length === 0) {
    return (
      <ThemedText style={[styles.emptyText, { color: c.secondaryText }]}>
        No completed trades yet.
      </ThemedText>
    );
  }

  // Underline-active varsity-caps filter — same rhythm as ByYearTab,
  // ProspectsTab, prospect-board, draft-room toggle bar, DraftBoard.
  const renderFilter = (id: string | null, label: string) => {
    const isActive = selectedTeam === id;
    return (
      <TouchableOpacity
        key={id ?? 'all'}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: isActive }}
        style={styles.filterBtn}
        onPress={() => setSelectedTeam(id)}
        activeOpacity={0.7}
      >
        <ThemedText
          type="varsity"
          style={[
            styles.filterText,
            { color: isActive ? c.text : c.secondaryText },
          ]}
          numberOfLines={1}
        >
          {label}
        </ThemedText>
        <View
          style={[
            styles.filterUnderline,
            { backgroundColor: isActive ? c.gold : 'transparent' },
          ]}
        />
      </TouchableOpacity>
    );
  };

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRowContent}
        style={styles.filterRow}
      >
        {renderFilter(null, 'All')}
        {teams.map((t) => renderFilter(t.id, t.name))}
      </ScrollView>

      <ThemedText
        type="varsitySmall"
        style={[styles.count, { color: c.secondaryText }]}
      >
        {filteredTrades.length} Trade{filteredTrades.length !== 1 ? 's' : ''}
      </ThemedText>

      {filteredTrades.map((trade) => (
        <TradeCard
          key={trade.id}
          proposal={trade}
          onPress={() => setDetailProposal(trade)}
          playerHeadshotMap={playerHeadshotMap}
        />
      ))}

      {detailProposal && (
        <TradeDetailModal
          proposal={detailProposal}
          leagueId={leagueId}
          teamId={teamId ?? ''}
          onClose={() => setDetailProposal(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  emptyText: { fontSize: ms(13), textAlign: 'center', paddingVertical: s(16) },

  filterRow: {
    marginHorizontal: -s(2),
    marginBottom: s(6),
  },
  filterRowContent: {
    paddingHorizontal: s(2),
    gap: s(20),
  },
  filterBtn: {
    alignItems: 'center',
    paddingTop: s(4),
  },
  filterText: {
    fontSize: ms(11),
    letterSpacing: 1.0,
  },
  filterUnderline: {
    marginTop: s(6),
    height: 2,
    width: '100%',
    minWidth: s(28),
  },

  count: {
    fontSize: ms(10),
    letterSpacing: 1.2,
    marginBottom: s(10),
  },
});
