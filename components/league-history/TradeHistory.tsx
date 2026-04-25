import { TradeCard } from '@/components/trade/TradeCard';
import { TradeDetailModal } from '@/components/trade/TradeDetailModal';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Colors } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { TradeProposalRow, useTradeProposals } from '@/hooks/useTrades';
import { ms, s } from '@/utils/scale';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

interface TradeHistoryProps {
  leagueId: string;
}

const HISTORICAL_STATUSES = new Set(['completed', 'reversed']);

export function TradeHistory({ leagueId }: TradeHistoryProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
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

  if (historicalTrades.length === 0) {
    return (
      <ThemedText style={[styles.emptyText, { color: c.secondaryText }]}>
        No completed trades yet.
      </ThemedText>
    );
  }

  const renderPill = (id: string | null, label: string) => {
    const isActive = selectedTeam === id;
    return (
      <TouchableOpacity
        key={id ?? 'all'}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: isActive }}
        style={[
          styles.pill,
          { borderColor: c.border },
          isActive
            ? { backgroundColor: Brand.turfGreen, borderColor: Brand.turfGreen }
            : { backgroundColor: c.cardAlt },
        ]}
        onPress={() => setSelectedTeam(id)}
      >
        <ThemedText
          type="varsitySmall"
          style={[
            styles.pillText,
            { color: isActive ? Brand.ecru : c.secondaryText },
          ]}
          numberOfLines={1}
        >
          {label}
        </ThemedText>
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
        {renderPill(null, 'All')}
        {teams.map((t) => renderPill(t.id, t.name))}
      </ScrollView>

      <ThemedText
        type="varsitySmall"
        style={[styles.count, { color: c.secondaryText }]}
      >
        {filteredTrades.length} trade{filteredTrades.length !== 1 ? 's' : ''}
      </ThemedText>

      {filteredTrades.map((trade) => (
        <TradeCard
          key={trade.id}
          proposal={trade}
          onPress={() => setDetailProposal(trade)}
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
    marginHorizontal: -s(4),
    marginBottom: s(8),
  },
  filterRowContent: {
    paddingHorizontal: s(4),
    gap: s(8),
  },
  pill: {
    paddingHorizontal: s(14),
    paddingVertical: s(7),
    borderRadius: 8,
    borderWidth: 1,
    maxWidth: s(140),
  },
  pillText: {
    fontSize: ms(10),
  },
  count: {
    fontSize: ms(10),
    marginBottom: s(10),
  },
});
