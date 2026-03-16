import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { DraftHubPick, DraftHubSwap, DraftHubTeam } from '@/hooks/useDraftHub';
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, TouchableOpacity, View } from 'react-native';

interface ByTeamTabProps {
  picks: DraftHubPick[];
  swaps: DraftHubSwap[];
  teams: DraftHubTeam[];
  validSeasons: string[];
  pickConditionsEnabled: boolean;
}

interface TeamPickGroup {
  team: DraftHubTeam;
  pickCount: number;
  bySeason: { season: string; picks: DraftHubPick[]; swaps: DraftHubSwap[] }[];
}

export function ByTeamTab({ picks, swaps, teams, validSeasons, pickConditionsEnabled }: ByTeamTabProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);

  const teamGroups = useMemo(() => {
    const sorted = [...teams].sort((a, b) => a.name.localeCompare(b.name));

    return sorted.map((team): TeamPickGroup => {
      const teamPicks = picks.filter((p) => p.current_team_id === team.id);
      const teamSwaps = swaps.filter((s) => s.beneficiary_team_id === team.id || s.counterparty_team_id === team.id);
      const seasonMap: Record<string, DraftHubPick[]> = {};
      const swapMap: Record<string, DraftHubSwap[]> = {};
      for (const pick of teamPicks) {
        if (!seasonMap[pick.season]) seasonMap[pick.season] = [];
        seasonMap[pick.season].push(pick);
      }
      for (const sw of teamSwaps) {
        if (!swapMap[sw.season]) swapMap[sw.season] = [];
        swapMap[sw.season].push(sw);
      }

      const bySeason = validSeasons
        .filter((s) => (seasonMap[s]?.length ?? 0) > 0 || (swapMap[s]?.length ?? 0) > 0)
        .map((season) => ({
          season,
          picks: (seasonMap[season] ?? []).sort((a, b) => a.round - b.round),
          swaps: swapMap[season] ?? [],
        }));

      return { team, pickCount: teamPicks.length, bySeason };
    });
  }, [picks, swaps, teams, validSeasons]);

  const renderTeam = ({ item }: { item: TeamPickGroup }) => {
    const expanded = expandedTeamId === item.team.id;

    return (
      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`${item.team.name}, ${item.pickCount} ${item.pickCount === 1 ? 'pick' : 'picks'}`}
          accessibilityState={{ expanded }}
          style={styles.teamHeader}
          onPress={() => setExpandedTeamId(expanded ? null : item.team.id)}
          activeOpacity={0.6}
        >
          <ThemedText type="defaultSemiBold" style={styles.teamName} numberOfLines={1}>
            {item.team.name}
          </ThemedText>
          <View style={[styles.countBadge, { backgroundColor: c.cardAlt }]}>
            <ThemedText style={[styles.countText, { color: c.secondaryText }]}>
              {item.pickCount} {item.pickCount === 1 ? 'pick' : 'picks'}
            </ThemedText>
          </View>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={c.secondaryText}
            accessible={false}
          />
        </TouchableOpacity>

        {expanded && (
          <View style={styles.expandedContent}>
            {item.bySeason.length === 0 ? (
              <ThemedText style={[styles.noPicks, { color: c.secondaryText }]}>
                No picks
              </ThemedText>
            ) : (
              item.bySeason.map(({ season, picks: seasonPicks, swaps: seasonSwaps }) => (
                <View key={season} style={styles.seasonBlock}>
                  <ThemedText style={[styles.seasonLabel, { color: c.accent }]}>
                    {parseInt(season.split('-')[0], 10) + 1}
                  </ThemedText>
                  {seasonPicks.map((pick, idx) => (
                    <View key={pick.id} style={[styles.pickRow, { borderBottomColor: c.border }, idx === seasonPicks.length - 1 && { borderBottomWidth: 0 }]}>
                      <View style={styles.pickInfo}>
                        <ThemedText style={{ fontSize: 13 }}>
                          Round {pick.round}
                        </ThemedText>
                        {pick.protection_threshold && pickConditionsEnabled && (
                          <View style={styles.protBadge}>
                            <ThemedText style={styles.protBadgeText}>Top-{pick.protection_threshold}</ThemedText>
                          </View>
                        )}
                      </View>
                      {pick.isTraded && (
                        <View style={styles.tradedInfo}>
                          <Ionicons name="swap-horizontal" size={12} color={c.secondaryText} />
                          <ThemedText style={[styles.tradedText, { color: c.secondaryText }]}>
                            via {pick.original_team_name}
                          </ThemedText>
                        </View>
                      )}
                    </View>
                  ))}
                  {pickConditionsEnabled && seasonSwaps.map((sw, idx) => (
                    <View key={sw.id} style={[styles.pickRow, { borderBottomColor: c.border }, idx === seasonSwaps.length - 1 && { borderBottomWidth: 0 }]}>
                      <View style={styles.pickInfo}>
                        <Ionicons name="swap-horizontal" size={12} color={c.accent} />
                        <ThemedText style={{ fontSize: 12, color: c.accent }}>
                          Rd {sw.round} swap vs {sw.beneficiary_team_id === item.team.id ? sw.counterparty_team_name : sw.beneficiary_team_name}
                        </ThemedText>
                      </View>
                      <ThemedText style={[styles.tradedText, { color: c.secondaryText }]}>
                        {sw.beneficiary_team_id === item.team.id ? 'Gets better' : 'Gives better'}
                      </ThemedText>
                    </View>
                  ))}
                </View>
              ))
            )}
          </View>
        )}
      </View>
    );
  };

  return (
    <FlatList
      data={teamGroups}
      keyExtractor={(item) => item.team.id}
      renderItem={renderTeam}
      contentContainerStyle={styles.list}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 40 },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 10,
    overflow: 'hidden',
  },
  teamHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 10,
  },
  teamName: { flex: 1, fontSize: 15 },
  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  countText: { fontSize: 11, fontWeight: '600' },
  expandedContent: {
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  noPicks: { fontSize: 13, paddingVertical: 8 },
  seasonBlock: { marginBottom: 8 },
  seasonLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingLeft: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tradedInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tradedText: { fontSize: 12 },
  protBadge: {
    backgroundColor: '#d4920040',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  protBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#d49200',
  },
});
