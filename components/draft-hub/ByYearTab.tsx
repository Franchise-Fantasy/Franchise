import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { DraftHubPick, DraftHubLeagueSettings, DraftHubSwap, DraftHubTeam } from '@/hooks/useDraftHub';
import { calcLotteryPoolSize, generateDefaultOdds } from '@/utils/lottery';
import { ms, s } from '@/utils/scale';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

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

/** Compact protection badge with animated ribbon that slides LEFT on tap */
function ProtectionBadge({
  threshold,
  holds,
  expanded,
  onToggle,
  detailText,
  c,
}: {
  threshold: number;
  holds: boolean;
  expanded: boolean;
  onToggle: () => void;
  detailText: string;
  c: (typeof Colors)['light'];
}) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(anim, {
      toValue: expanded ? 1 : 0,
      useNativeDriver: false,
      tension: 120,
      friction: 14,
    }).start();
  }, [expanded]);

  const ribbonMaxWidth = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 180] });
  const ribbonOpacity = anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0, 1] });
  const ribbonPadH = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 6] });

  const color = holds ? c.gold : c.secondaryText;
  const bg = holds ? c.goldMuted : c.cardAlt;

  return (
    <View style={styles.protBadgeWrap}>
      {/* Ribbon sits inline to the LEFT of the badge — team name flexShrinks to make room */}
      <Animated.View
        style={[
          styles.protRibbon,
          {
            backgroundColor: bg,
            maxWidth: ribbonMaxWidth,
            opacity: ribbonOpacity,
            paddingHorizontal: ribbonPadH,
          },
        ]}
        pointerEvents={expanded ? 'auto' : 'none'}
      >
        <ThemedText style={[styles.protRibbonText, { color }]} numberOfLines={1}>
          {detailText}
        </ThemedText>
      </Animated.View>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`Top-${threshold} protection, tap for details`}
        onPress={onToggle}
        style={[
          styles.protBadge,
          { backgroundColor: bg },
          expanded && styles.protBadgeExpandedLeft,
        ]}
      >
        <Ionicons
          name={holds ? 'lock-closed' : 'lock-open'}
          size={9}
          color={color}
          style={{ marginRight: 2 }}
        />
        <ThemedText style={[styles.protBadgeText, { color }]}>
          Top-{threshold}
        </ThemedText>
      </TouchableOpacity>
    </View>
  );
}

export function ByYearTab({ picks, swaps, teams, validSeasons, leagueSettings }: ByYearTabProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [selectedSeason, setSelectedSeason] = useState(validSeasons[0]);
  const [simResult, setSimResult] = useState<SimulationEntry[] | null>(null);
  const [expandedProts, setExpandedProts] = useState<Set<string>>(new Set());
  const toggleProt = useCallback((key: string) => {
    setExpandedProts(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const isUpcomingSeason = selectedSeason === validSeasons[0];

  const seasonPicks = useMemo(
    () => picks.filter((p) => p.season === selectedSeason),
    [picks, selectedSeason],
  );

  // Standings in reverse order (worst first) for lottery/draft order
  const reversedStandings = useMemo(() => [...teams].reverse(), [teams]);

  const lotteryPoolSize = calcLotteryPoolSize(teams.length, leagueSettings.playoffTeams);
  const lotteryPool = useMemo(() => reversedStandings.slice(0, lotteryPoolSize), [reversedStandings, lotteryPoolSize]);
  const playoffTeams = useMemo(() => reversedStandings.slice(lotteryPoolSize), [reversedStandings, lotteryPoolSize]);
  const odds = useMemo(
    () => leagueSettings.lotteryOdds ?? generateDefaultOdds(lotteryPoolSize),
    [leagueSettings.lotteryOdds, lotteryPoolSize],
  );

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

  // team_id → tricode for compact display
  const tricodeMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of teams) map[t.id] = t.tricode ?? t.name.slice(0, 3).toUpperCase();
    return map;
  }, [teams]);

  // Map original_team_id → current owner for Round 1 of the selected season (for odds table)
  const pickOwnerMap = useMemo(() => {
    const map: Record<string, { ownerName: string; ownerId: string; isTraded: boolean; protectionThreshold: number | null; protectionOwnerName: string | null; protectionOwnerId: string | null; wasSwapped: boolean }> = {};
    for (const pick of displayPicks) {
      if (pick.round === 1) {
        map[pick.original_team_id] = {
          ownerName: pick.current_team_name,
          ownerId: pick.current_team_id,
          isTraded: pick.isTraded,
          protectionThreshold: pick.protection_threshold,
          protectionOwnerName: pick.protection_owner_name,
          protectionOwnerId: pick.protection_owner_id ?? null,
          wasSwapped: pick.wasSwapped ?? false,
        };
      }
    }
    return map;
  }, [displayPicks]);

  // Sort picks within each round by display_slot — this is the same value
  // shown in the pick circle, so ordering and label always match.
  const roundGroups = useMemo(() => {
    const groups: Record<number, DraftHubPick[]> = {};
    for (const pick of displayPicks) {
      if (!groups[pick.round]) groups[pick.round] = [];
      groups[pick.round].push(pick);
    }
    return Object.entries(groups)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([round, roundPicks]) => ({
        round: Number(round),
        picks: roundPicks.sort((a, b) => a.display_slot - b.display_slot),
      }));
  }, [displayPicks]);

  // Build the lottery-odds display rows once per relevant input change rather than
  // rebuilding the whole list every render (previously an inline IIFE inside JSX).
  type OddsRow = {
    team: DraftHubTeam;
    position: number;
    moved: number;
    wasDrawn: boolean;
    isPlayoff: boolean;
    oddsValue: string;
  };
  const displayRows: OddsRow[] = useMemo(() => {
    const rows: OddsRow[] = [];
    if (simResult) {
      const combined = [...lotteryPool, ...playoffTeams];
      simResult.forEach((entry, i) => {
        const team = combined.find((t) => t.id === entry.team_id)!;
        const origIdx = lotteryPool.findIndex((t) => t.id === entry.team_id);
        rows.push({
          team,
          position: i + 1,
          moved: entry.original_standing - entry.lottery_position,
          wasDrawn: entry.was_drawn,
          isPlayoff: false,
          oddsValue: origIdx >= 0 && odds[origIdx] != null ? `${odds[origIdx]}%` : '—',
        });
      });
      playoffTeams.forEach((team, i) => {
        rows.push({
          team,
          position: lotteryPoolSize + i + 1,
          moved: 0,
          wasDrawn: false,
          isPlayoff: true,
          oddsValue: '—',
        });
      });
    } else {
      lotteryPool.forEach((team, i) => {
        rows.push({
          team,
          position: i + 1,
          moved: 0,
          wasDrawn: false,
          isPlayoff: false,
          oddsValue: odds[i] != null ? `${odds[i]}%` : '—',
        });
      });
      playoffTeams.forEach((team, i) => {
        rows.push({
          team,
          position: lotteryPoolSize + i + 1,
          moved: 0,
          wasDrawn: false,
          isPlayoff: true,
          oddsValue: '—',
        });
      });
    }
    return rows;
  }, [simResult, lotteryPool, playoffTeams, lotteryPoolSize, odds]);

  const playoffCutoffIndex = useMemo(
    () => displayRows.findIndex((r) => r.isPlayoff),
    [displayRows],
  );

  const handleSimulate = () => {
    if (lotteryPoolSize === 0 || !leagueSettings.leagueFull) return;
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
              accessibilityLabel={`Season ${parseInt(season.split('-')[0], 10)}`}
              accessibilityState={{ selected: active }}
              style={[styles.pill, { backgroundColor: active ? c.accent : c.cardAlt, borderColor: active ? c.accent : c.border }]}
              onPress={() => { setSelectedSeason(season); setSimResult(null); }}
            >
              <ThemedText style={[styles.pillText, { color: active ? c.accentText : c.text }]}>
                {parseInt(season.split('-')[0], 10)}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Lottery odds / standings + simulation (upcoming season only).
          Stays visible through lottery and rookie draft; only hides once the
          rookie draft is complete. Sim button hides after the lottery runs. */}
      {isUpcomingSeason && lotteryPoolSize > 0 && !leagueSettings.rookieDraftComplete && (
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
          {displayRows.map((row, i) => {
            const ownership = pickOwnerMap[row.team.id];

            // Compute effective owner based on position and protection
            let effectiveOwnerName = ownership?.ownerName;
            let effectiveIsTraded = ownership?.isTraded ?? false;
            let protectionHolds = false;
            if (ownership?.protectionThreshold && ownership?.protectionOwnerId && leagueSettings.pickConditionsEnabled) {
              protectionHolds = row.position <= ownership.protectionThreshold;
              if (protectionHolds) {
                effectiveOwnerName = ownership.protectionOwnerName ?? ownership.ownerName;
                effectiveIsTraded = ownership.protectionOwnerId !== row.team.id;
              }
            }

            return (
              <View key={row.team.id}>
                  {/* Insert playoff cutoff divider */}
                  {i === playoffCutoffIndex && playoffCutoffIndex > 0 && (
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
                        {effectiveIsTraded ? (
                          <View style={styles.oddsTradeRow}>
                            <ThemedText style={[styles.oddsTeamFaded, { color: c.secondaryText }]} numberOfLines={1}>
                              {tricodeMap[row.team.id]}
                            </ThemedText>
                            <Ionicons name="arrow-forward" size={10} color={c.secondaryText} />
                            <ThemedText style={styles.oddsTeam} numberOfLines={1}>
                              {effectiveOwnerName}
                            </ThemedText>
                          </View>
                        ) : (
                          <ThemedText style={styles.oddsTeam} numberOfLines={1}>{row.team.name}</ThemedText>
                        )}
                        {ownership?.protectionThreshold && leagueSettings.pickConditionsEnabled && (
                          <ProtectionBadge
                            threshold={ownership.protectionThreshold}
                            holds={protectionHolds}
                            expanded={expandedProts.has(`odds-${row.team.id}`)}
                            onToggle={() => toggleProt(`odds-${row.team.id}`)}
                            detailText={protectionHolds
                              ? `Kept by ${ownership.protectionOwnerName} · ${ownership.ownerName} misses`
                              : `→ ${ownership.ownerName}`}
                            c={c}
                          />
                        )}
                        {ownership?.wasSwapped && leagueSettings.pickConditionsEnabled && (
                          <View style={[styles.swapBadge, { backgroundColor: c.link + '20' }]}>
                            <Ionicons name="swap-horizontal" size={9} color={c.accent} />
                          </View>
                        )}
                        {simResult && row.moved !== 0 && (
                          <ThemedText style={[styles.movedBadge, { color: row.moved > 0 ? c.success : c.danger }]}>
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
            })}

          {/* Simulate / Clear buttons — hidden once the lottery has been run */}
          {!leagueSettings.lotteryComplete && (
            <View style={styles.simButtonRow}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={simResult ? 'Simulate again' : 'Simulate lottery'}
                accessibilityState={{ disabled: !leagueSettings.leagueFull }}
                accessibilityHint={!leagueSettings.leagueFull ? 'All teams must join before simulating' : undefined}
                disabled={!leagueSettings.leagueFull}
                style={[styles.simButton, { backgroundColor: c.accent, opacity: leagueSettings.leagueFull ? 1 : 0.4 }]}
                onPress={handleSimulate}
              >
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
          )}
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
            {roundPicks.map((pick, idx) => {
              const pickPos = pick.display_slot;
              // Protection position checks only meaningful when standings are known
              const protHolds = pick.protection_threshold && leagueSettings.pickConditionsEnabled && isUpcomingSeason
                ? pickPos <= pick.protection_threshold
                : false;

              // Resolve effective owner: if protection holds, revert to protection owner
              const effectiveName = protHolds && pick.protection_owner_name
                ? pick.protection_owner_name
                : pick.current_team_name;
              const effectiveIsTraded = protHolds
                ? (pick.protection_owner_id !== pick.original_team_id)
                : pick.isTraded;

              const hasProtection = pick.protection_threshold && leagueSettings.pickConditionsEnabled;
              const hasBadges = hasProtection || pick.wasSwapped || effectiveIsTraded;

              return (
                <View
                  key={pick.id}
                  style={[styles.pickRow, idx < roundPicks.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border }]}
                >
                  <View style={styles.pickRowLine1}>
                    <View style={[styles.pickNum, { backgroundColor: c.cardAlt }]}>
                      <ThemedText style={[styles.pickNumText, { color: c.secondaryText }]}>
                        {isUpcomingSeason ? pickPos : '?'}
                      </ThemedText>
                    </View>
                    <ThemedText style={styles.pickTeamName} numberOfLines={1}>
                      {effectiveName}
                    </ThemedText>
                  </View>
                  {hasBadges && (
                    <View style={styles.pickRowLine2}>
                      {hasProtection && (
                        <ProtectionBadge
                          threshold={pick.protection_threshold!}
                          holds={protHolds}
                          expanded={expandedProts.has(`pick-${pick.id}`)}
                          onToggle={() => toggleProt(`pick-${pick.id}`)}
                          detailText={protHolds
                            ? `Kept by ${pick.protection_owner_name} · ${pick.current_team_name} misses`
                            : `→ ${pick.current_team_name}`}
                          c={c}
                        />
                      )}
                      {pick.wasSwapped && (
                        <View style={[styles.swapBadge, { backgroundColor: c.link + '20' }]}>
                          <Ionicons name="swap-horizontal" size={9} color={c.accent} />
                        </View>
                      )}
                      {effectiveIsTraded && (
                        <View style={styles.tradedInfo}>
                          <Ionicons name="swap-horizontal" size={14} color={c.secondaryText} />
                          <ThemedText style={[styles.tradedText, { color: c.secondaryText }]} numberOfLines={1}>
                            via {pick.original_team_name}
                          </ThemedText>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  contentContainer: { padding: s(16), paddingBottom: s(40) },
  seasonSelector: { marginBottom: s(16), flexGrow: 0 },
  seasonPills: { gap: s(8) },
  pill: {
    paddingHorizontal: s(16),
    paddingVertical: s(8),
    borderRadius: 20,
    borderWidth: 1,
  },
  pillText: { fontSize: ms(14), fontWeight: '600' },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: s(16),
    marginBottom: s(16),
  },
  cardTitle: { marginBottom: s(12) },
  roundHeader: { marginBottom: s(8) },

  // Odds table
  oddsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: s(6),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.3)',
  },
  oddsHeader: { fontSize: ms(10), fontWeight: '600' },
  oddsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(8),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  oddsPos: { width: s(24), fontSize: ms(12) },
  oddsTeamCol: { flex: 1 },
  oddsTeamRow: { flexDirection: 'row', alignItems: 'center', gap: s(6) },
  oddsTeam: { fontSize: ms(13), flexShrink: 1 },
  oddsTeamFaded: { fontSize: ms(11), flexShrink: 0 },
  oddsTradeRow: { flexDirection: 'row', alignItems: 'center', gap: s(4), flex: 1, minWidth: 0 },
  movedBadge: { fontSize: ms(10), fontWeight: '700' },
  oddsRecord: { width: s(48), textAlign: 'center', fontSize: ms(12) },
  oddsPct: { width: s(48), textAlign: 'right', fontSize: ms(12) },

  // Cutoff
  cutoffRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(6),
    gap: s(8),
  },
  cutoffLine: { flex: 1, height: 1, opacity: 0.4 },
  cutoffLabel: { fontSize: ms(9), fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },

  // Simulate
  simButtonRow: {
    flexDirection: 'row',
    gap: s(8),
    marginTop: s(12),
  },
  simButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(8),
    paddingVertical: s(10),
    borderRadius: 8,
  },
  clearButton: {
    paddingHorizontal: s(16),
    paddingVertical: s(10),
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  simButtonText: { fontSize: ms(14), fontWeight: '600' },

  // Pick rows
  pickRow: {
    flexDirection: 'column',
    alignItems: 'stretch',
    paddingVertical: s(8),
    gap: s(6),
  },
  pickRowLine1: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
  },
  pickRowLine2: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: s(8),
    paddingLeft: s(38), // align under the team name (pickNum width 28 + gap 10)
  },
  pickNum: {
    width: s(28),
    height: s(28),
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickNumText: { fontSize: ms(12), fontWeight: '700' },
  pickTeamName: { flex: 1, fontSize: ms(14) },
  tradedInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
    flexShrink: 0,
  },
  tradedText: { fontSize: ms(12) },
  protBadgeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 10,
  },
  protBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 4,
    paddingHorizontal: s(5),
    paddingVertical: 1,
  },
  protBadgeExpandedLeft: {
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
  },
  protRibbon: {
    overflow: 'hidden',
    borderTopLeftRadius: 4,
    borderBottomLeftRadius: 4,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    justifyContent: 'center',
    paddingVertical: 1,
  },
  protRibbonText: {
    fontSize: ms(10),
    fontWeight: '600',
  },
  swapBadge: {
    borderRadius: 4,
    padding: s(2),
    marginLeft: s(4),
  },
  protBadgeText: {
    fontSize: ms(10),
    fontWeight: '600',
  },
  emptyState: { padding: s(20), alignItems: 'center' },
});
