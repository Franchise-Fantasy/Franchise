import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, TouchableOpacity, View } from 'react-native';

import { PickConditionRow } from '@/components/draft-hub/PickConditionRow';
import { TeamLogo } from '@/components/team/TeamLogo';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors, Fonts, cardShadow } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { DraftHubPick, DraftHubSwap, DraftHubTeam } from '@/hooks/useDraftHub';
import { formatProtectionStory, formatSwapStory } from '@/types/trade';
import { ms, s } from '@/utils/scale';

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

export function ByTeamTab({
  picks,
  swaps,
  teams,
  validSeasons,
  pickConditionsEnabled,
}: ByTeamTabProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);

  const tricodeMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of teams) map[t.id] = t.tricode ?? t.name.slice(0, 3).toUpperCase();
    return map;
  }, [teams]);

  const teamGroups = useMemo(() => {
    const sorted = [...teams].sort((a, b) => a.name.localeCompare(b.name));

    return sorted.map((team): TeamPickGroup => {
      const teamPicks = picks.filter((p) => p.current_team_id === team.id);
      const teamSwaps = swaps.filter(
        (sw) => sw.beneficiary_team_id === team.id || sw.counterparty_team_id === team.id,
      );
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
        .filter((season) => (seasonMap[season]?.length ?? 0) > 0 || (swapMap[season]?.length ?? 0) > 0)
        .map((season) => ({
          season,
          picks: (seasonMap[season] ?? []).sort((a, b) =>
            a.round !== b.round ? a.round - b.round : a.display_slot - b.display_slot,
          ),
          swaps: swapMap[season] ?? [],
        }));

      return { team, pickCount: teamPicks.length, bySeason };
    });
  }, [picks, swaps, teams, validSeasons]);

  const renderTeam = ({ item }: { item: TeamPickGroup }) => {
    const expanded = expandedTeamId === item.team.id;
    const tricode = tricodeMap[item.team.id];

    return (
      <View style={styles.cardWrap}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`${item.team.name}, ${item.pickCount} ${item.pickCount === 1 ? 'pick' : 'picks'}`}
          accessibilityState={{ expanded }}
          style={[
            styles.card,
            { backgroundColor: c.card, borderColor: c.border, ...cardShadow },
          ]}
          onPress={() => setExpandedTeamId(expanded ? null : item.team.id)}
          activeOpacity={0.78}
        >
          <View style={styles.teamHeader}>
            <TeamLogo
              logoKey={item.team.logo_key}
              teamName={item.team.name}
              tricode={tricode}
              size="medium"
            />
            <View style={styles.teamHeaderText}>
              <ThemedText
                type="varsity"
                style={[styles.teamTricode, { color: c.gold }]}
                numberOfLines={1}
              >
                {tricode}
              </ThemedText>
              <ThemedText type="display" style={styles.teamName} numberOfLines={1}>
                {item.team.name}
              </ThemedText>
            </View>
            <View style={styles.statBlock}>
              <ThemedText style={[styles.pickCountValue, { color: c.text }]}>
                {item.pickCount}
              </ThemedText>
              <View style={[styles.statDivider, { backgroundColor: c.gold }]} />
              <ThemedText
                type="varsitySmall"
                style={[styles.statLabel, { color: c.secondaryText }]}
              >
                {item.pickCount === 1 ? 'Pick' : 'Picks'}
              </ThemedText>
              <Ionicons
                name={expanded ? 'chevron-up' : 'chevron-down'}
                size={ms(16)}
                color={c.secondaryText}
                accessible={false}
                style={styles.chevron}
              />
            </View>
          </View>

          {expanded && (
            <View style={[styles.expandedContent, { borderTopColor: c.border }]}>
              {item.bySeason.length === 0 ? (
                <ThemedText style={[styles.noPicks, { color: c.secondaryText }]}>
                  No picks
                </ThemedText>
              ) : (
                item.bySeason.map(({ season, picks: seasonPicks, swaps: seasonSwaps }) => {
                  const year = parseInt(season.split('-')[0], 10);
                  return (
                    <View key={season} style={styles.seasonBlock}>
                      {/* Year header — Alfa Slab year + thin gold rule */}
                      <View style={styles.seasonHeader}>
                        <ThemedText style={[styles.seasonYear, { color: c.text }]}>
                          {year}
                        </ThemedText>
                        <View style={[styles.seasonRule, { backgroundColor: c.gold }]} />
                      </View>

                      {seasonPicks.map((pick, idx) => {
                        const isUpcoming = season === validSeasons[0];
                        const showProtection = pick.protection_threshold && pickConditionsEnabled;
                        const isLast =
                          idx === seasonPicks.length - 1 &&
                          (!pickConditionsEnabled || seasonSwaps.length === 0);
                        const protectionOwnerTricode = pick.protection_owner_name
                          ? (teams.find((t) => t.name === pick.protection_owner_name)?.tricode
                              ?? pick.protection_owner_name.slice(0, 3).toUpperCase())
                          : tricode;
                        const conveyanceTricode = tricode;
                        const originTricode = tricodeMap[pick.original_team_id]
                          ?? pick.original_team_name.slice(0, 3).toUpperCase();
                        return (
                          <View
                            key={pick.id}
                            style={[
                              styles.pickCell,
                              { borderBottomColor: c.border },
                              isLast && { borderBottomWidth: 0 },
                            ]}
                          >
                            <View style={styles.pickRow}>
                              <ThemedText
                                type="varsitySmall"
                                style={[styles.roundBadge, { color: c.secondaryText }]}
                              >
                                R{pick.round}
                              </ThemedText>
                              <ThemedText style={[styles.pickLabel, { color: c.text }]}>
                                {isUpcoming ? `Pick ${pick.display_slot}` : 'Slot TBD'}
                              </ThemedText>
                              <View style={{ flex: 1 }} />
                              {pick.isTraded && (
                                <View style={styles.viaTag}>
                                  <ThemedText
                                    type="varsitySmall"
                                    style={[styles.viaText, { color: c.secondaryText }]}
                                  >
                                    via
                                  </ThemedText>
                                  <View style={styles.fadedLogoWrap}>
                                    <TeamLogo
                                      logoKey={
                                        teams.find((t) => t.id === pick.original_team_id)
                                          ?.logo_key
                                      }
                                      teamName={pick.original_team_name}
                                      tricode={originTricode}
                                      size="small"
                                    />
                                  </View>
                                  <ThemedText
                                    type="varsitySmall"
                                    style={[styles.viaText, { color: c.secondaryText }]}
                                  >
                                    {originTricode}
                                  </ThemedText>
                                </View>
                              )}
                            </View>
                            {showProtection ? (
                              <View style={styles.storyLineWrap}>
                                <PickConditionRow
                                  kind="protection_pending"
                                  badgeLabel={`TOP-${pick.protection_threshold}`}
                                  storyText={formatProtectionStory(
                                    pick.protection_threshold!,
                                    protectionOwnerTricode,
                                    conveyanceTricode,
                                    'pending',
                                  )}
                                />
                              </View>
                            ) : null}
                          </View>
                        );
                      })}
                      {pickConditionsEnabled &&
                        seasonSwaps.map((sw, idx) => {
                          const isBeneficiary = sw.beneficiary_team_id === item.team.id;
                          const partnerId = isBeneficiary
                            ? sw.counterparty_team_id
                            : sw.beneficiary_team_id;
                          const partnerTricode = tricodeMap[partnerId] ?? '—';
                          const beneficiaryTricode = tricodeMap[sw.beneficiary_team_id] ?? '—';
                          return (
                            <View
                              key={sw.id}
                              style={[
                                styles.pickCell,
                                { borderBottomColor: c.border },
                                idx === seasonSwaps.length - 1 && { borderBottomWidth: 0 },
                              ]}
                            >
                              <View style={styles.pickRow}>
                                <ThemedText
                                  type="varsitySmall"
                                  style={[styles.roundBadge, { color: c.secondaryText }]}
                                >
                                  R{sw.round}
                                </ThemedText>
                                <ThemedText style={[styles.pickLabel, { color: c.text }]}>
                                  Pick swap
                                </ThemedText>
                              </View>
                              <View style={styles.storyLineWrap}>
                                <PickConditionRow
                                  kind="swap"
                                  badgeLabel={partnerTricode}
                                  storyText={formatSwapStory(
                                    beneficiaryTricode,
                                    sw.counterparty_team_name,
                                  )}
                                />
                              </View>
                            </View>
                          );
                        })}
                    </View>
                  );
                })
              )}
            </View>
          )}
        </TouchableOpacity>
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
  list: { padding: s(16), paddingBottom: s(40) },
  cardWrap: { marginBottom: s(14) },

  // Card surface
  card: {
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  teamHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: s(14),
    paddingVertical: s(14),
    gap: s(12),
  },
  teamHeaderText: { flex: 1, minWidth: 0 },
  teamTricode: {
    fontSize: ms(11),
    letterSpacing: 1.4,
    marginBottom: s(2),
  },
  teamName: {
    fontSize: ms(20),
    lineHeight: ms(24),
    letterSpacing: -0.3,
  },

  // Stat block — mono value + small gold divider + caps label
  // (mirrors the HomeHero stat-row pattern: value · gold rule · LABEL)
  statBlock: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pickCountValue: {
    fontFamily: Fonts.mono,
    fontSize: ms(20),
    letterSpacing: 0.5,
  },
  statDivider: {
    width: s(8),
    height: 1,
    marginHorizontal: s(8),
    opacity: 0.7,
  },
  statLabel: { fontSize: ms(10), letterSpacing: 1.2 },
  chevron: { marginLeft: s(8) },

  // Expanded content
  expandedContent: {
    paddingHorizontal: s(14),
    paddingBottom: s(12),
    paddingTop: s(2),
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  noPicks: { fontSize: ms(13), paddingVertical: s(10) },

  // Season block — Alfa Slab year + extending gold rule
  seasonBlock: { paddingTop: s(10), paddingBottom: s(2) },
  seasonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    marginBottom: s(6),
  },
  seasonYear: {
    fontFamily: Fonts.display,
    fontSize: ms(15),
    lineHeight: ms(18),
    letterSpacing: -0.3,
  },
  seasonRule: {
    flex: 1,
    height: 1,
    opacity: 0.5,
  },

  // Pick cell
  pickCell: {
    paddingVertical: s(8),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
  },
  roundBadge: {
    fontSize: ms(10),
    letterSpacing: 1.2,
    minWidth: s(22),
  },
  pickLabel: { fontSize: ms(13), fontWeight: '500' },
  viaTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
  },
  viaText: { fontSize: ms(9), letterSpacing: 0.8 },
  fadedLogoWrap: { opacity: 0.4 },

  storyLineWrap: { paddingTop: s(4), paddingLeft: s(32) },
});
