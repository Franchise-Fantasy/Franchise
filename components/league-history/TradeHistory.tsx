import { TradeCard } from '@/components/trade/TradeCard';
import { TradeDetailModal } from '@/components/trade/TradeDetailModal';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
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

  // Get unique teams involved in trades
  const teams = useMemo(() => {
    const teamMap = new Map<string, string>();
    for (const t of historicalTrades) {
      for (const team of t.teams) {
        teamMap.set(team.team_id, team.team_name);
      }
    }
    return [...teamMap.entries()].map(([id, name]) => ({ id, name }));
  }, [historicalTrades]);

  // Filter by selected team
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

  return (
    <View>
      {/* Team filter pills */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="All teams"
          accessibilityState={{ selected: !selectedTeam }}
          style={[styles.pill, !selectedTeam ? { backgroundColor: c.accent } : { backgroundColor: c.cardAlt }]}
          onPress={() => setSelectedTeam(null)}
        >
          <ThemedText style={[styles.pillText, !selectedTeam && { color: c.accentText }]}>All</ThemedText>
        </TouchableOpacity>
        {teams.map((t) => (
          <TouchableOpacity
            key={t.id}
            accessibilityRole="button"
            accessibilityLabel={t.name}
            accessibilityState={{ selected: selectedTeam === t.id }}
            style={[styles.pill, selectedTeam === t.id ? { backgroundColor: c.accent } : { backgroundColor: c.cardAlt }]}
            onPress={() => setSelectedTeam(t.id)}
          >
            <ThemedText style={[styles.pillText, selectedTeam === t.id && { color: c.accentText }]}>{t.name}</ThemedText>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ThemedText style={[styles.count, { color: c.secondaryText }]}>
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
  filterRow: { marginBottom: s(10) },
  pill: {
    paddingHorizontal: s(12),
    paddingVertical: s(6),
    borderRadius: 16,
    marginRight: s(8),
  },
  pillText: { fontSize: ms(12), fontWeight: '600' },
  count: { fontSize: ms(12), marginBottom: s(10) },
});
