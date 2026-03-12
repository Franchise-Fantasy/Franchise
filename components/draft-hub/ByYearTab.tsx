import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { DraftHubPick, DraftHubLeagueSettings, DraftHubSwap, DraftHubTeam } from '@/hooks/useDraftHub';
import { calcLotteryPoolSize, generateDefaultOdds } from '@/utils/lottery';
import { resolveProtections, resolveSwaps } from '@/utils/pickConditions';
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

interface SimulationEntry {
  team_id: string;
  team_name: string;
  original_standing: number;
  lottery_position: number;
  was_drawn: boolean;
}

interface ByYearTabProps {
  picks: DraftHubPick[];
  swaps: DraftHubSwap[];
  teams: DraftHubTeam[];
  validSeasons: string[];
  leagueSettings: DraftHubLeagueSettings;
}

function simulateLottery(
  lotteryPool: DraftHubTeam[],
  odds: number[],
  draws: number,
): SimulationEntry[] {
  const remainingPool = [...lotteryPool];
  const oddsTotal = odds.reduce((a, b) => a + b, 0);
  let remainingOdds = odds.map((o) => o / oddsTotal);
  const drawnTeams: DraftHubTeam[] = [];

  for (let draw = 0; draw < draws; draw++) {
    const rand = Math.random();
    let cumulative = 0;
    let selectedIdx = remainingPool.length - 1;

    for (let i = 0; i < remainingOdds.length; i++) {
      cumulative += remainingOdds[i];
      if (rand <= cumulative) {
        selectedIdx = i;
        break;
      }
    }

    drawnTeams.push(remainingPool[selectedIdx]);
    remainingPool.splice(selectedIdx, 1);
    remainingOdds.splice(selectedIdx, 1);

    const remTotal = remainingOdds.reduce((a, b) => a + b, 0);
    if (remTotal > 0) remainingOdds = remainingOdds.map((o) => o / remTotal);
  }

  return [
    ...drawnTeams.map((t, i) => ({
      team_id: t.id,
      team_name: t.name,
      original_standing: lotteryPool.findIndex((p) => p.id === t.id) + 1,
      lottery_position: i + 1,
      was_drawn: true,
    })),
    ...remainingPool.map((t, i) => ({
      team_id: t.id,
      team_name: t.name,
      original_standing: lotteryPool.findIndex((p) => p.id === t.id) + 1,
      lottery_position: drawnTeams.length + i + 1,
      was_drawn: false,
    })),
  ];
}

export function ByYearTab({ picks, swaps, teams, validSeasons, leagueSettings }: ByYearTabProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [selectedSeason, setSelectedSeason] = useState(validSeasons[0]);
  const [simResult, setSimResult] = useState<SimulationEntry[] | null>(null);

  const isUpcomingSeason = selectedSeason === validSeasons[0];

  const seasonPicks = useMemo(
    () => picks.filter((p) => p.season === selectedSeason),
    [picks, selectedSeason],
  );

  // Standings in reverse order (worst first) for lottery/draft order
  const reversedStandings = useMemo(() => [...teams].reverse(), [teams]);

  const lotteryPoolSize = calcLotteryPoolSize(teams.length, leagueSettings.playoffTeams);
  const lotteryPool = reversedStandings.slice(0, lotteryPoolSize);
  const playoffTeams = reversedStandings.slice(lotteryPoolSize);
  const odds = leagueSettings.lotteryOdds ?? generateDefaultOdds(lotteryPoolSize);

  // Swaps for the selected season
  const seasonSwaps = useMemo(
    () => swaps.filter((s) => s.season === selectedSeason),
    [swaps, selectedSeason],
  );

  // Pre-apply swaps based on current standings so they display like traded picks
  const displayPicks = useMemo(() => {
    if (!leagueSettings.pickConditionsEnabled || seasonSwaps.length === 0) return seasonPicks;
    const standingOrder: Record<string, number> = {};
    reversedStandings.forEach((t, i) => { standingOrder[t.id] = i; });
    const result = seasonPicks.map((p) => ({ ...p }));
    for (const swap of seasonSwaps) {
      const benefPick = result.find((p) => p.round === swap.round && p.current_team_id === swap.beneficiary_team_id);
      const counterPick = result.find((p) => p.round === swap.round && p.current_team_id === swap.counterparty_team_id);
      if (!benefPick || !counterPick) continue;
      const benefPos = standingOrder[benefPick.original_team_id] ?? 999;
      const counterPos = standingOrder[counterPick.original_team_id] ?? 999;
      benefPick.wasSwapped = true;
      counterPick.wasSwapped = true;
      if (counterPos < benefPos) {
        const tempId = benefPick.current_team_id;
        const tempName = benefPick.current_team_name;
        benefPick.current_team_id = counterPick.current_team_id;
        benefPick.current_team_name = counterPick.current_team_name;
        counterPick.current_team_id = tempId;
        counterPick.current_team_name = tempName;
        benefPick.isTraded = true;
        counterPick.isTraded = true;
      }
    }
    return result;
  }, [seasonPicks, seasonSwaps, reversedStandings, leagueSettings.pickConditionsEnabled]);

  // Map original_team_id → current owner for Round 1 of the selected season (for odds table)
  const pickOwnerMap = useMemo(() => {
    const map: Record<string, { ownerName: string; isTraded: boolean; protectionThreshold: number | null; wasSwapped: boolean }> = {};
    for (const pick of displayPicks) {
      if (pick.round === 1) {
        map[pick.original_team_id] = {
          ownerName: pick.current_team_name,
          isTraded: pick.isTraded,
          protectionThreshold: pick.protection_threshold,
          wasSwapped: pick.wasSwapped ?? false,
        };
      }
    }
    return map;
  }, [displayPicks]);

  // After simulation, resolve protections and swaps on picks
  const resolvedPicks = useMemo(() => {
    if (!simResult || !leagueSettings.pickConditionsEnabled) return displayPicks;
    const nameMap: Record<string, string> = {};
    for (const t of teams) nameMap[t.id] = t.name;
    const simulatedSlots: Record<string, number> = {};
    for (const entry of simResult) {
      simulatedSlots[entry.team_id] = entry.lottery_position;
    }
    const afterProtections = resolveProtections(seasonPicks, simulatedSlots, nameMap);
    return resolveSwaps(afterProtections, swaps, selectedSeason, simulatedSlots, nameMap);
  }, [simResult, seasonPicks, displayPicks, swaps, selectedSeason, teams, leagueSettings.pickConditionsEnabled]);

  // Sort picks within each round by reverse standings (worst team first = picks first)
  const roundGroups = useMemo(() => {
    const standingOrder: Record<string, number> = {};
    reversedStandings.forEach((t, i) => { standingOrder[t.id] = i; });

    const picksToUse = simResult ? resolvedPicks : displayPicks;
    const groups: Record<number, DraftHubPick[]> = {};
    for (const pick of picksToUse) {
      if (!groups[pick.round]) groups[pick.round] = [];
      groups[pick.round].push(pick);
    }
    return Object.entries(groups)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([round, roundPicks]) => ({
        round: Number(round),
        picks: roundPicks.sort((a, b) =>
          (standingOrder[a.original_team_id] ?? 99) - (standingOrder[b.original_team_id] ?? 99)
        ),
      }));
  }, [displayPicks, resolvedPicks, simResult, reversedStandings]);

  const handleSimulate = () => {
    if (lotteryPoolSize === 0) return;
    const result = simulateLottery(lotteryPool, odds, Math.min(leagueSettings.lotteryDraws, lotteryPoolSize));
    setSimResult(result);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* Season selector */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.seasonSelector} contentContainerStyle={styles.seasonPills}>
        {validSeasons.map((season) => {
          const active = season === selectedSeason;
          return (
            <TouchableOpacity
              key={season}
              accessibilityRole="button"
              accessibilityLabel={`Season ${season}`}
              accessibilityState={{ selected: active }}
              style={[styles.pill, { backgroundColor: active ? c.accent : c.cardAlt, borderColor: active ? c.accent : c.border }]}
              onPress={() => { setSelectedSeason(season); setSimResult(null); }}
            >
              <ThemedText style={[styles.pillText, { color: active ? c.accentText : c.text }]}>
                {season.split('-')[0]}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Lottery odds + simulation (upcoming season only) */}
      {isUpcomingSeason && lotteryPoolSize > 0 && (
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.cardTitle}>
            Lottery Odds
          </ThemedText>

          {/* Odds table header */}
          <View style={styles.oddsHeaderRow}>
            <ThemedText style={[styles.oddsPos, styles.oddsHeader, { color: c.secondaryText }]}>#</ThemedText>
            <View style={styles.oddsTeamCol}>
              <ThemedText style={[styles.oddsHeader, { color: c.secondaryText }]}>Team</ThemedText>
            </View>
            <ThemedText style={[styles.oddsRecord, styles.oddsHeader, { color: c.secondaryText }]}>Record</ThemedText>
            <ThemedText style={[styles.oddsPct, styles.oddsHeader, { color: c.secondaryText }]}>Odds</ThemedText>
          </View>

          {/* Teams in order — reordered if simulation active */}
          {(() => {
            // Build the display list: simulation reorders lottery pool, playoff teams stay at end
            const displayRows: {
              team: DraftHubTeam;
              position: number;
              moved: number; // positive = moved up, negative = moved down, 0 = same
              wasDrawn: boolean;
              isPlayoff: boolean;
              oddsValue: string;
            }[] = [];

            if (simResult) {
              // Simulation active: use simResult order for lottery teams
              simResult.forEach((entry, i) => {
                const team = [...lotteryPool, ...playoffTeams].find(t => t.id === entry.team_id)!;
                const origIdx = lotteryPool.findIndex(t => t.id === entry.team_id);
                displayRows.push({
                  team,
                  position: i + 1,
                  moved: entry.original_standing - entry.lottery_position,
                  wasDrawn: entry.was_drawn,
                  isPlayoff: false,
                  oddsValue: origIdx >= 0 && odds[origIdx] != null ? `${odds[origIdx]}%` : '—',
                });
              });
              // Playoff teams stay in their original order after lottery
              playoffTeams.forEach((team, i) => {
                displayRows.push({
                  team,
                  position: lotteryPoolSize + i + 1,
                  moved: 0,
                  wasDrawn: false,
                  isPlayoff: true,
                  oddsValue: '—',
                });
              });
            } else {
              // Default: original standings order with odds %
              lotteryPool.forEach((team, i) => {
                displayRows.push({
                  team,
                  position: i + 1,
                  moved: 0,
                  wasDrawn: false,
                  isPlayoff: false,
                  oddsValue: odds[i] != null ? `${odds[i]}%` : '—',
                });
              });
              playoffTeams.forEach((team, i) => {
                displayRows.push({
                  team,
                  position: lotteryPoolSize + i + 1,
                  moved: 0,
                  wasDrawn: false,
                  isPlayoff: true,
                  oddsValue: '—',
                });
              });
            }

            // Find where to insert the playoff cutoff divider
            const cutoffIndex = displayRows.findIndex(r => r.isPlayoff);

            return displayRows.map((row, i) => {
              const ownership = pickOwnerMap[row.team.id];
              return (
                <View key={row.team.id}>
                  {/* Insert playoff cutoff divider */}
                  {i === cutoffIndex && cutoffIndex > 0 && (
                    <View style={styles.cutoffRow}>
                      <View style={[styles.cutoffLine, { backgroundColor: c.secondaryText }]} />
                      <ThemedText style={[styles.cutoffLabel, { color: c.secondaryText }]}>
                        Playoff teams
                      </ThemedText>
                      <View style={[styles.cutoffLine, { backgroundColor: c.secondaryText }]} />
                    </View>
                  )}
                  <View style={[styles.oddsRow, { borderBottomColor: c.border }]}>
                    <ThemedText style={[styles.oddsPos, { color: c.secondaryText }]}>{row.position}</ThemedText>
                    <View style={styles.oddsTeamCol}>
                      <View style={styles.oddsTeamRow}>
                        {ownership?.isTraded ? (
                          <View style={styles.oddsTradeRow}>
                            <ThemedText style={[styles.oddsTeamFaded, { color: c.secondaryText }]} numberOfLines={1}>
                              {row.team.name}
                            </ThemedText>
                            <Ionicons name="arrow-forward" size={12} color={c.secondaryText} />
                            <ThemedText style={styles.oddsTeam} numberOfLines={1}>
                              {ownership.ownerName}
                            </ThemedText>
                          </View>
                        ) : (
                          <ThemedText style={styles.oddsTeam} numberOfLines={1}>{row.team.name}</ThemedText>
                        )}
                        {ownership?.protectionThreshold && leagueSettings.pickConditionsEnabled && (
                          <View style={styles.protBadge}>
                            <Ionicons name="lock-closed" size={9} color="#d49200" style={{ marginRight: 2 }} />
                            <ThemedText style={styles.protBadgeText}>{ownership.protectionThreshold === 1 ? '1' : `1-${ownership.protectionThreshold}`}</ThemedText>
                          </View>
                        )}
                        {ownership?.wasSwapped && leagueSettings.pickConditionsEnabled && (
                          <View style={styles.swapBadge}>
                            <Ionicons name="swap-horizontal" size={9} color={c.accent} />
                          </View>
                        )}
                        {simResult && row.moved !== 0 && (
                          <ThemedText style={[styles.movedBadge, { color: row.moved > 0 ? '#22c55e' : '#ef4444' }]}>
                            {row.moved > 0 ? `▲${row.moved}` : `▼${Math.abs(row.moved)}`}
                          </ThemedText>
                        )}
                      </View>
                    </View>
                    <ThemedText style={[styles.oddsRecord, { color: c.secondaryText }]}>
                      {row.team.wins}-{row.team.losses}
                    </ThemedText>
                    <ThemedText style={[
                      styles.oddsPct,
                      { color: row.isPlayoff ? c.secondaryText : c.accent, fontWeight: row.isPlayoff ? '400' : '600' },
                    ]}>
                      {row.oddsValue}
                    </ThemedText>
                  </View>
                </View>
              );
            });
          })()}

          {/* Simulate / Clear buttons */}
          <View style={styles.simButtonRow}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={simResult ? 'Simulate again' : 'Simulate lottery'} style={[styles.simButton, { backgroundColor: c.accent }]} onPress={handleSimulate}>
              <Ionicons name="shuffle" size={18} color={c.accentText} accessible={false} />
              <ThemedText style={[styles.simButtonText, { color: c.accentText }]}>
                {simResult ? 'Simulate Again' : 'Simulate Lottery'}
              </ThemedText>
            </TouchableOpacity>
            {simResult && (
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Clear simulation" style={[styles.clearButton, { borderColor: c.border }]} onPress={() => setSimResult(null)}>
                <ThemedText style={[styles.simButtonText, { color: c.text }]}>Clear</ThemedText>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* Pick list by round */}
      {roundGroups.length === 0 ? (
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.emptyState}>
            <ThemedText style={{ color: c.secondaryText }}>No picks for this season</ThemedText>
          </View>
        </View>
      ) : (
        roundGroups.map(({ round, picks: roundPicks }) => (
          <View key={round} style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.roundHeader}>
              Round {round}
            </ThemedText>
            {roundPicks.map((pick, idx) => (
              <View
                key={pick.id}
                style={[styles.pickRow, idx < roundPicks.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border }]}
              >
                <View style={[styles.pickNum, { backgroundColor: c.cardAlt }]}>
                  <ThemedText style={[styles.pickNumText, { color: c.secondaryText }]}>
                    {idx + 1}
                  </ThemedText>
                </View>
                <ThemedText style={styles.pickTeamName} numberOfLines={1}>
                  {pick.current_team_name}
                </ThemedText>
                {pick.protection_threshold && leagueSettings.pickConditionsEnabled && !simResult && (
                  <View style={styles.protBadge}>
                    <Ionicons name="lock-closed" size={9} color="#d49200" style={{ marginRight: 2 }} />
                    <ThemedText style={styles.protBadgeText}>{pick.protection_threshold === 1 ? '1' : `1-${pick.protection_threshold}`}</ThemedText>
                  </View>
                )}
                {simResult && pick.wasProtected && (
                  <View style={[styles.protBadge, { backgroundColor: '#22c55e30' }]}>
                    <ThemedText style={[styles.protBadgeText, { color: '#22c55e' }]}>Protected</ThemedText>
                  </View>
                )}
                {simResult && pick.wasConveyed && (
                  <View style={[styles.protBadge, { backgroundColor: '#ef444430' }]}>
                    <ThemedText style={[styles.protBadgeText, { color: '#ef4444' }]}>Conveyed</ThemedText>
                  </View>
                )}
                {pick.wasSwapped && (
                  <View style={styles.swapBadge}>
                    <Ionicons name="swap-horizontal" size={9} color={c.accent} />
                  </View>
                )}
                {pick.isTraded && (
                  <View style={styles.tradedInfo}>
                    <Ionicons name="swap-horizontal" size={14} color={c.secondaryText} />
                    <ThemedText style={[styles.tradedText, { color: c.secondaryText }]} numberOfLines={1}>
                      via {pick.original_team_name}
                    </ThemedText>
                  </View>
                )}
              </View>
            ))}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  contentContainer: { padding: 16, paddingBottom: 40 },
  seasonSelector: { marginBottom: 16, flexGrow: 0 },
  seasonPills: { gap: 8 },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  pillText: { fontSize: 14, fontWeight: '600' },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: { marginBottom: 12 },
  roundHeader: { marginBottom: 8 },

  // Odds table
  oddsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.3)',
  },
  oddsHeader: { fontSize: 10, fontWeight: '600' },
  oddsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  oddsPos: { width: 24, fontSize: 12 },
  oddsTeamCol: { flex: 1 },
  oddsTeamRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  oddsTeam: { fontSize: 13 },
  oddsTeamFaded: { fontSize: 13 },
  oddsTradeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  movedBadge: { fontSize: 10, fontWeight: '700' },
  oddsRecord: { width: 48, textAlign: 'center', fontSize: 12 },
  oddsPct: { width: 48, textAlign: 'right', fontSize: 12 },

  // Cutoff
  cutoffRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 8,
  },
  cutoffLine: { flex: 1, height: 1, opacity: 0.4 },
  cutoffLabel: { fontSize: 9, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },

  // Simulate
  simButtonRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  simButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 8,
  },
  clearButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  simButtonText: { fontSize: 14, fontWeight: '600' },

  // Pick rows
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
  },
  pickNum: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickNumText: { fontSize: 12, fontWeight: '700' },
  pickTeamName: { flex: 1, fontSize: 14 },
  tradedInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  tradedText: { fontSize: 12 },
  protBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#d4920040',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginRight: 4,
  },
  swapBadge: {
    backgroundColor: '#3b82f620',
    borderRadius: 4,
    padding: 2,
    marginRight: 4,
  },
  protBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#d49200',
  },
  emptyState: { padding: 20, alignItems: 'center' },
});
