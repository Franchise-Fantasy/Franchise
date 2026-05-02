import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { PickConditionRow } from '@/components/draft-hub/PickConditionRow';
import { TeamLogo } from '@/components/team/TeamLogo';
import { BrandButton } from '@/components/ui/BrandButton';
import { Section } from '@/components/ui/Section';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors, Fonts } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { DraftHubPick, DraftHubLeagueSettings, DraftHubSwap, DraftHubTeam } from '@/hooks/useDraftHub';
import { formatProtectionStory, formatSwapStory } from '@/types/trade';
import { calcLotteryPoolSize, generateDefaultOdds } from '@/utils/league/lottery';
import { ms, s } from '@/utils/scale';

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

  const reversedStandings = useMemo(() => [...teams].reverse(), [teams]);
  const lotteryPoolSize = calcLotteryPoolSize(teams.length, leagueSettings.playoffTeams);
  const lotteryPool = useMemo(() => reversedStandings.slice(0, lotteryPoolSize), [reversedStandings, lotteryPoolSize]);
  const playoffTeams = useMemo(() => reversedStandings.slice(lotteryPoolSize), [reversedStandings, lotteryPoolSize]);
  const odds = useMemo(
    () => leagueSettings.lotteryOdds ?? generateDefaultOdds(lotteryPoolSize),
    [leagueSettings.lotteryOdds, lotteryPoolSize],
  );

  const seasonSwaps = useMemo(
    () => swaps.filter((s) => s.season === selectedSeason),
    [swaps, selectedSeason],
  );

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

  const tricodeMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of teams) map[t.id] = t.tricode ?? t.name.slice(0, 3).toUpperCase();
    return map;
  }, [teams]);

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

  const findSwapInfo = (
    pick: DraftHubPick,
  ): { isBeneficiary: boolean; beneficiaryName: string; counterpartyName: string; partnerTricode: string } | null => {
    const swap = seasonSwaps.find(
      (sw) =>
        sw.round === pick.round &&
        (sw.beneficiary_team_id === pick.original_team_id ||
          sw.counterparty_team_id === pick.original_team_id),
    );
    if (!swap) return null;
    const isBeneficiary = swap.beneficiary_team_id === pick.original_team_id;
    const partnerId = isBeneficiary ? swap.counterparty_team_id : swap.beneficiary_team_id;
    return {
      isBeneficiary,
      beneficiaryName: swap.beneficiary_team_name,
      counterpartyName: swap.counterparty_team_name,
      partnerTricode: tricodeMap[partnerId] ?? '—',
    };
  };

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

  const showLotteryCard =
    isUpcomingSeason && lotteryPoolSize > 0 && !leagueSettings.rookieDraftComplete;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* Season selector — text-only with gold underline on active. Reads as
          a within-tab filter, subordinate to the SegmentedControl tabs above. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.seasonSelector}
        contentContainerStyle={styles.seasonRow}
      >
        {validSeasons.map((season) => {
          const active = season === selectedSeason;
          const yearLabel = parseInt(season.split('-')[0], 10);
          return (
            <TouchableOpacity
              key={season}
              accessibilityRole="button"
              accessibilityLabel={`Season ${yearLabel}`}
              accessibilityState={{ selected: active }}
              style={styles.yearTab}
              onPress={() => { setSelectedSeason(season); setSimResult(null); }}
              activeOpacity={0.7}
            >
              <ThemedText
                style={[
                  styles.yearLabel,
                  {
                    fontFamily: active ? Fonts.display : Fonts.bodyMedium,
                    color: active ? c.text : c.secondaryText,
                  },
                ]}
              >
                {yearLabel}
              </ThemedText>
              <View
                style={[
                  styles.yearUnderline,
                  { backgroundColor: active ? c.gold : 'transparent' },
                ]}
              />
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {showLotteryCard && (
        <Section title="Lottery Odds">
          {/* Column headers — varsitySmall caps, gold-tinted */}
          <View style={[styles.oddsHeaderRow, { borderBottomColor: c.border }]}>
            <ThemedText type="varsitySmall" style={[styles.colPos, styles.headerText, { color: c.gold }]}>#</ThemedText>
            <ThemedText type="varsitySmall" style={[styles.colTeam, styles.headerText, { color: c.gold }]}>Team</ThemedText>
            <ThemedText type="varsitySmall" style={[styles.colRecord, styles.headerText, { color: c.gold }]}>Rec</ThemedText>
            <ThemedText type="varsitySmall" style={[styles.colOdds, styles.headerText, { color: c.gold }]}>Odds</ThemedText>
          </View>

          {displayRows.map((row, i) => {
            const ownership = pickOwnerMap[row.team.id];

            let effectiveOwnerName = ownership?.ownerName;
            let effectiveIsTraded = ownership?.isTraded ?? false;
            let protectionHolds = false;
            const hasResolvedProtection = !!simResult && !!ownership?.protectionThreshold;
            if (ownership?.protectionThreshold && ownership?.protectionOwnerId && leagueSettings.pickConditionsEnabled) {
              protectionHolds = row.position <= ownership.protectionThreshold;
              if (protectionHolds) {
                effectiveOwnerName = ownership.protectionOwnerName ?? ownership.ownerName;
                effectiveIsTraded = ownership.protectionOwnerId !== row.team.id;
              }
            }

            const showProtectionStory =
              ownership?.protectionThreshold && leagueSettings.pickConditionsEnabled;
            const showSwapStory =
              ownership?.wasSwapped && leagueSettings.pickConditionsEnabled;

            const round1Pick = displayPicks.find(
              (p) => p.round === 1 && p.original_team_id === row.team.id,
            );
            const swapInfo = round1Pick ? findSwapInfo(round1Pick) : null;

            const ownerTricode = effectiveOwnerName
              ? (teams.find((t) => t.name === effectiveOwnerName)?.tricode
                  ?? effectiveOwnerName.slice(0, 3).toUpperCase())
              : '—';
            const protectionOwnerTricode = ownership?.protectionOwnerName
              ? (teams.find((t) => t.name === ownership.protectionOwnerName)?.tricode
                  ?? ownership.protectionOwnerName.slice(0, 3).toUpperCase())
              : ownerTricode;
            const conveyanceTricode = ownership ? (tricodeMap[ownership.ownerId] ?? '—') : '—';

            return (
              <View key={row.team.id}>
                {i === playoffCutoffIndex && playoffCutoffIndex > 0 && (
                  <View style={styles.cutoffRow}>
                    <View style={[styles.cutoffLine, { backgroundColor: c.gold }]} />
                    <ThemedText
                      type="varsitySmall"
                      style={[styles.cutoffLabel, { color: c.gold }]}
                    >
                      Playoff Teams
                    </ThemedText>
                    <View style={[styles.cutoffLine, { backgroundColor: c.gold }]} />
                  </View>
                )}
                <View style={[styles.oddsCell, { borderBottomColor: c.border }]}>
                  <View style={styles.oddsRow}>
                    {/* Pick number — Alfa Slab, the "draft card" treatment */}
                    <View style={styles.colPos}>
                      <ThemedText
                        style={[
                          styles.pickNumber,
                          { color: row.isPlayoff ? c.secondaryText : c.text },
                        ]}
                      >
                        {row.position}
                      </ThemedText>
                    </View>
                    {/* Team — logo + varsity tricode (with trade arrow when relevant).
                        Conveying team's logo is faded; recipient's is solid. */}
                    <View style={styles.colTeam}>
                      <View style={styles.teamLine}>
                        {effectiveIsTraded ? (
                          <View style={styles.tradeRow}>
                            <View style={styles.fadedLogoWrap}>
                              <TeamLogo
                                logoKey={row.team.logo_key}
                                teamName={row.team.name}
                                tricode={tricodeMap[row.team.id]}
                                size="small"
                              />
                            </View>
                            <ThemedText
                              type="varsitySmall"
                              style={[styles.tricodeFaded, { color: c.secondaryText }]}
                              numberOfLines={1}
                            >
                              {tricodeMap[row.team.id]}
                            </ThemedText>
                            <Ionicons name="arrow-forward" size={ms(10)} color={c.gold} />
                            {(() => {
                              const ownerTeam = teams.find((t) => t.name === effectiveOwnerName);
                              const ownerTricode =
                                ownerTeam?.tricode
                                ?? effectiveOwnerName?.slice(0, 3).toUpperCase()
                                ?? '—';
                              return (
                                <>
                                  <TeamLogo
                                    logoKey={ownerTeam?.logo_key}
                                    teamName={effectiveOwnerName ?? ownerTricode}
                                    tricode={ownerTricode}
                                    size="small"
                                  />
                                  <ThemedText
                                    type="varsity"
                                    style={[styles.tricodeStrong, { color: c.text }]}
                                    numberOfLines={1}
                                  >
                                    {ownerTricode}
                                  </ThemedText>
                                </>
                              );
                            })()}
                          </View>
                        ) : (
                          <>
                            <TeamLogo
                              logoKey={row.team.logo_key}
                              teamName={row.team.name}
                              tricode={tricodeMap[row.team.id]}
                              size="small"
                            />
                            <ThemedText
                              type="varsity"
                              style={[styles.tricodeStrong, { color: row.isPlayoff ? c.secondaryText : c.text }]}
                              numberOfLines={1}
                            >
                              {tricodeMap[row.team.id]}
                            </ThemedText>
                          </>
                        )}
                        {simResult && row.moved !== 0 && (
                          <ThemedText
                            type="varsitySmall"
                            style={[styles.movedBadge, { color: row.moved > 0 ? c.success : c.danger }]}
                          >
                            {row.moved > 0 ? `▲${row.moved}` : `▼${Math.abs(row.moved)}`}
                          </ThemedText>
                        )}
                      </View>
                    </View>
                    {/* Record — mono tabular figures */}
                    <ThemedText style={[styles.colRecord, styles.monoStat, { color: c.secondaryText }]}>
                      {row.team.wins}-{row.team.losses}
                    </ThemedText>
                    {/* Odds % — mono, gold for in-lottery, faded for playoff */}
                    <ThemedText
                      style={[
                        styles.colOdds,
                        styles.monoStat,
                        styles.oddsValue,
                        { color: row.isPlayoff ? c.secondaryText : c.gold },
                      ]}
                    >
                      {row.oddsValue}
                    </ThemedText>
                  </View>

                  {showProtectionStory ? (
                    <View style={styles.storyLineWrap}>
                      <PickConditionRow
                        kind={
                          hasResolvedProtection
                            ? protectionHolds
                              ? 'protection_held'
                              : 'protection_missed'
                            : 'protection_pending'
                        }
                        badgeLabel={`TOP-${ownership.protectionThreshold}`}
                        storyText={formatProtectionStory(
                          ownership.protectionThreshold!,
                          protectionOwnerTricode,
                          conveyanceTricode,
                          hasResolvedProtection ? protectionHolds : 'pending',
                        )}
                      />
                    </View>
                  ) : null}
                  {showSwapStory && swapInfo ? (
                    <View style={styles.storyLineWrap}>
                      <PickConditionRow
                        kind="swap"
                        badgeLabel={swapInfo.partnerTricode}
                        storyText={formatSwapStory(
                          tricodeMap[
                            seasonSwaps.find(
                              (sw) =>
                                sw.round === 1 &&
                                (swapInfo.isBeneficiary
                                  ? sw.beneficiary_team_name === swapInfo.beneficiaryName
                                  : sw.counterparty_team_name === swapInfo.counterpartyName),
                            )?.beneficiary_team_id ?? ''
                          ] ?? swapInfo.beneficiaryName,
                          swapInfo.counterpartyName,
                        )}
                      />
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })}

          {!leagueSettings.lotteryComplete && (
            <View style={styles.simButtonRow}>
              <BrandButton
                label={simResult ? 'Simulate Again' : 'Simulate Lottery'}
                onPress={handleSimulate}
                variant="primary"
                size="default"
                icon="shuffle"
                disabled={!leagueSettings.leagueFull}
                accessibilityHint={
                  !leagueSettings.leagueFull ? 'All teams must join before simulating' : undefined
                }
                fullWidth
                style={styles.simButtonFlex}
              />
              {simResult && (
                <BrandButton
                  label="Clear"
                  onPress={() => setSimResult(null)}
                  variant="secondary"
                  size="default"
                  accessibilityLabel="Clear simulation"
                />
              )}
            </View>
          )}
        </Section>
      )}

      {/* Pick list by round — Section per round with numbered code (R / 01) */}
      {roundGroups.length === 0 ? (
        <Section title="Picks">
          <View style={styles.emptyState}>
            <ThemedText style={{ color: c.secondaryText }}>No picks for this season</ThemedText>
          </View>
        </Section>
      ) : (
        roundGroups.map(({ round, picks: roundPicks }) => (
          <Section key={round} title={`Round ${round}`}>
            {roundPicks.map((pick, idx) => {
              const pickPos = pick.display_slot;
              const protHolds = pick.protection_threshold && leagueSettings.pickConditionsEnabled && isUpcomingSeason
                ? pickPos <= pick.protection_threshold
                : false;

              const effectiveName = protHolds && pick.protection_owner_name
                ? pick.protection_owner_name
                : pick.current_team_name;
              const effectiveIsTraded = protHolds
                ? (pick.protection_owner_id !== pick.original_team_id)
                : pick.isTraded;

              const hasProtection = pick.protection_threshold && leagueSettings.pickConditionsEnabled;
              const hasResolvedProtection = !!hasProtection && isUpcomingSeason;

              const swapInfo =
                pick.wasSwapped && leagueSettings.pickConditionsEnabled
                  ? findSwapInfo(pick)
                  : null;

              const effectiveTeam = teams.find((t) => t.name === effectiveName);
              const effectiveTricode =
                effectiveTeam?.tricode
                ?? effectiveName.slice(0, 3).toUpperCase();
              const originTeam = teams.find((t) => t.id === pick.original_team_id);
              const originTricode =
                originTeam?.tricode
                ?? tricodeMap[pick.original_team_id]
                ?? pick.original_team_name.slice(0, 3).toUpperCase();
              const protectionOwnerTricode = pick.protection_owner_name
                ? (teams.find((t) => t.name === pick.protection_owner_name)?.tricode
                    ?? pick.protection_owner_name.slice(0, 3).toUpperCase())
                : effectiveTricode;
              const conveyanceTricode = tricodeMap[pick.current_team_id]
                ?? pick.current_team_name.slice(0, 3).toUpperCase();

              return (
                <View
                  key={pick.id}
                  style={[
                    styles.pickRow,
                    idx < roundPicks.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: c.border,
                    },
                  ]}
                >
                  <View style={styles.pickRowLine1}>
                    {/* Alfa Slab pick number with thin gold side-rule */}
                    <View style={styles.pickNumColumn}>
                      <View style={[styles.pickNumRule, { backgroundColor: c.gold }]} />
                      <ThemedText style={[styles.pickRoundNumber, { color: c.text }]}>
                        {isUpcomingSeason ? pickPos : '?'}
                      </ThemedText>
                    </View>
                    {/* Team line — both logos when traded (origin faded → effective solid). */}
                    <View style={styles.pickTeamCol}>
                      <View style={styles.pickTeamLine}>
                        {effectiveIsTraded ? (
                          <>
                            <View style={styles.fadedLogoWrap}>
                              <TeamLogo
                                logoKey={originTeam?.logo_key}
                                teamName={pick.original_team_name}
                                tricode={originTricode}
                                size="small"
                              />
                            </View>
                            <ThemedText
                              type="varsitySmall"
                              style={[styles.tricodeFaded, { color: c.secondaryText }]}
                              numberOfLines={1}
                            >
                              {originTricode}
                            </ThemedText>
                            <Ionicons name="arrow-forward" size={ms(10)} color={c.gold} />
                            <TeamLogo
                              logoKey={effectiveTeam?.logo_key}
                              teamName={effectiveName}
                              tricode={effectiveTricode}
                              size="small"
                            />
                            <ThemedText
                              type="varsity"
                              style={[styles.tricodeStrong, { color: c.text }]}
                              numberOfLines={1}
                            >
                              {effectiveTricode}
                            </ThemedText>
                          </>
                        ) : (
                          <>
                            <TeamLogo
                              logoKey={effectiveTeam?.logo_key}
                              teamName={effectiveName}
                              tricode={effectiveTricode}
                              size="small"
                            />
                            <View style={styles.teamLineWide}>
                              <ThemedText
                                type="varsity"
                                style={[styles.tricodeStrong, { color: c.text }]}
                              >
                                {effectiveTricode}
                              </ThemedText>
                              <ThemedText
                                style={[styles.teamFullName, { color: c.secondaryText }]}
                                numberOfLines={1}
                              >
                                {effectiveName}
                              </ThemedText>
                            </View>
                          </>
                        )}
                      </View>
                    </View>
                  </View>

                  {hasProtection ? (
                    <View style={styles.pickStoryLine}>
                      <PickConditionRow
                        kind={
                          hasResolvedProtection
                            ? protHolds
                              ? 'protection_held'
                              : 'protection_missed'
                            : 'protection_pending'
                        }
                        badgeLabel={`TOP-${pick.protection_threshold}`}
                        storyText={formatProtectionStory(
                          pick.protection_threshold!,
                          protectionOwnerTricode,
                          conveyanceTricode,
                          hasResolvedProtection ? protHolds : 'pending',
                        )}
                      />
                    </View>
                  ) : null}

                  {swapInfo ? (
                    <View style={styles.pickStoryLine}>
                      <PickConditionRow
                        kind="swap"
                        badgeLabel={swapInfo.partnerTricode}
                        storyText={formatSwapStory(
                          tricodeMap[
                            seasonSwaps.find(
                              (sw) =>
                                sw.round === pick.round &&
                                sw.beneficiary_team_name === swapInfo.beneficiaryName,
                            )?.beneficiary_team_id ?? ''
                          ] ?? swapInfo.beneficiaryName,
                          swapInfo.counterpartyName,
                        )}
                      />
                    </View>
                  ) : null}
                </View>
              );
            })}
          </Section>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  contentContainer: { padding: s(16), paddingBottom: s(40) },

  // Season selector — text + gold-underline active. Subordinate to the
  // SegmentedControl tabs above so the page hierarchy reads cleanly.
  seasonSelector: { marginBottom: s(14), flexGrow: 0 },
  seasonRow: { gap: s(20), paddingHorizontal: s(2) },
  yearTab: {
    alignItems: 'center',
    paddingTop: s(2),
  },
  yearLabel: {
    fontSize: ms(18),
    lineHeight: ms(22),
    letterSpacing: -0.2,
  },
  yearUnderline: {
    marginTop: s(4),
    height: 2,
    width: '100%',
    minWidth: s(28),
  },

  // Lottery odds table
  oddsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: s(6),
    paddingTop: s(2),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerText: { fontSize: ms(10), letterSpacing: 1.4 },
  oddsCell: {
    paddingVertical: s(10),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  oddsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  colPos: { width: s(28) },
  colTeam: { flex: 1, paddingRight: s(6) },
  colRecord: { width: s(50), textAlign: 'center' },
  colOdds: { width: s(54), textAlign: 'right' },

  // Pick number — Alfa Slab "draft card" treatment
  pickNumber: {
    fontFamily: Fonts.display,
    fontSize: ms(18),
    lineHeight: ms(22),
    letterSpacing: -0.3,
  },

  // Team line in odds row
  teamLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    flexShrink: 1,
  },
  tradeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(5),
    flexShrink: 1,
  },
  tricodeFaded: { fontSize: ms(10), opacity: 0.85 },
  fadedLogoWrap: { opacity: 0.4 },
  tricodeStrong: { fontSize: ms(13), letterSpacing: 1.0 },
  movedBadge: { fontSize: ms(10) },

  // Mono stat columns (records, odds %)
  monoStat: {
    fontFamily: Fonts.mono,
    fontSize: ms(12),
    letterSpacing: 0.3,
  },
  oddsValue: { fontWeight: '600' },

  storyLineWrap: {
    paddingTop: s(8),
    paddingLeft: s(28), // align with team column
  },

  // Cutoff between lottery and playoff teams — gold rule + caps label
  cutoffRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(10),
    gap: s(10),
  },
  cutoffLine: { flex: 1, height: 1, opacity: 0.65 },
  cutoffLabel: { fontSize: ms(10), letterSpacing: 1.4 },

  // Sim button row
  simButtonRow: {
    flexDirection: 'row',
    gap: s(10),
    marginTop: s(14),
    marginBottom: s(4),
  },
  simButtonFlex: { flex: 1 },

  // Pick rows in round Sections
  pickRow: {
    flexDirection: 'column',
    paddingVertical: s(10),
    gap: s(6),
  },
  pickRowLine1: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(12),
  },
  pickNumColumn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    width: s(46),
  },
  pickNumRule: {
    width: 3,
    height: s(22),
  },
  pickRoundNumber: {
    fontFamily: Fonts.display,
    fontSize: ms(22),
    lineHeight: ms(26),
    letterSpacing: -0.3,
    minWidth: s(20),
  },
  pickTeamCol: {
    flex: 1,
    minWidth: 0,
  },
  pickTeamLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    flexShrink: 1,
    minWidth: 0,
  },
  teamLineWide: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: s(8),
    flexShrink: 1,
  },
  teamFullName: {
    fontSize: ms(13),
    flexShrink: 1,
  },
  pickStoryLine: {
    paddingLeft: s(58), // align under team-col after pick num + rule + gap
  },

  emptyState: { padding: s(20), alignItems: 'center' },
});
