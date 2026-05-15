import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MatchupChip } from '@/components/player/MatchupChip';
import { PlayerDetailModal } from '@/components/player/PlayerDetailModal';
import { PlayerHeadshotImage } from '@/components/player/PlayerHeadshotImage';
import { AnimatedFpts } from '@/components/roster/AnimatedFpts';
import { rosterStyles as styles } from '@/components/roster/rosterStyles';
import { SectionEyebrow } from '@/components/roster/SectionEyebrow';
import { RosterPlayer, SlotEntry } from '@/components/roster/SlotPickerModal';
import { TeamLogo } from '@/components/team/TeamLogo';
import { ProposeTradeModal } from '@/components/trade/ProposeTradeModal';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import { queryKeys } from '@/constants/queryKeys';
import { useAppState } from '@/context/AppStateProvider';
import { useActiveLeagueSport } from '@/hooks/useActiveLeagueSport';
import { useColors } from '@/hooks/useColors';
import { useLeague } from '@/hooks/useLeague';
import { useLeagueRosterConfig } from '@/hooks/useLeagueRosterConfig';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { supabase } from '@/lib/supabase';
import { PlayerSeasonStats, PlayerGameLog } from '@/types/player';
import { formatPosition } from '@/utils/formatting';
import { getSportToday } from '@/utils/leagueTime';
import { getInjuryBadge } from '@/utils/nba/injuryBadge';
import {
  formatGameInfo,
  liveToGameLog,
  useLivePlayerStats,
} from '@/utils/nba/nbaLive';
import {
  fetchNbaScheduleForDate,
  formatGameTime,
  ScheduleEntry,
} from '@/utils/nba/nbaSchedule';
import { getTeamLogoUrl } from '@/utils/nba/playerHeadshot';
import { fetchTeamSlots } from '@/utils/roster/fetchTeamSlots';
import { slotLabel } from '@/utils/roster/rosterSlots';
import { ms, s } from '@/utils/scale';
import {
  calculateGameFantasyPoints,
  formatScore,
} from '@/utils/scoring/fantasyPoints';

// ─── Types ───────────────────────────────────────────────────────────────────

interface LeagueTeamMeta {
  id: string;
  name: string;
  tricode: string | null;
  logo_key: string | null;
}

// `Record<string, number>` for the matchup PlayerCell stat parser. Mirrors
// the shape used by (tabs)/roster.tsx's resolveSlotStats.
function buildStatLine(stats: Record<string, number>): string | null {
  const parts: string[] = [];
  if (stats.pts != null) parts.push(`${stats.pts} PTS`);
  if (stats.reb != null) parts.push(`${stats.reb} REB`);
  if (stats.ast != null) parts.push(`${stats.ast} AST`);
  if (parts.length === 0) return null;
  return parts.join(' · ');
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function TeamRosterScreen() {
  const { id: viewTeamId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const c = useColors();
  const { leagueId, teamId: myTeamId } = useAppState();
  const sport = useActiveLeagueSport(leagueId);

  const [selectedPlayer, setSelectedPlayer] = useState<PlayerSeasonStats | null>(null);
  const [showTradeModal, setShowTradeModal] = useState(false);
  const [showSwitcher, setShowSwitcher] = useState(false);

  const isOwnTeam = viewTeamId === myTeamId;
  const today = getSportToday(sport);

  const { data: league } = useLeague();
  const isCategories = league?.scoring_type === 'h2h_categories';

  // Trade deadline gate for the right-side Trade button
  const { data: leagueDeadline } = useQuery({
    queryKey: queryKeys.leagueDeadline(leagueId!),
    queryFn: async () => {
      const { data } = await supabase.from('leagues').select('trade_deadline').eq('id', leagueId!).single();
      return data?.trade_deadline as string | null;
    },
    enabled: !!leagueId,
  });
  const isPastDeadline = !!leagueDeadline && new Date(leagueDeadline + 'T23:59:59') < new Date();

  const { data: scoringWeights } = useLeagueScoring(leagueId ?? '');
  const { data: rosterConfig, isLoading: isLoadingConfig } = useLeagueRosterConfig(leagueId ?? '');

  // Fetch team name
  const { data: teamName, isError: isTeamError } = useQuery({
    queryKey: queryKeys.teamName(viewTeamId!),
    queryFn: async () => {
      const { data } = await supabase
        .from('teams')
        .select('name')
        .eq('id', viewTeamId!)
        .single();
      return data?.name ?? 'Team';
    },
    enabled: !!viewTeamId,
  });

  // All league teams — drives the header dropdown so the user can jump
  // between opponent rosters without bouncing back to standings/matchup.
  const { data: leagueTeams } = useQuery<LeagueTeamMeta[]>({
    queryKey: queryKeys.leagueTeams(leagueId!),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teams')
        .select('id, name, tricode, logo_key')
        .eq('league_id', leagueId!);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 5,
  });

  const opponentTeams = useMemo(
    () =>
      (leagueTeams ?? [])
        .filter((t) => t.id !== myTeamId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [leagueTeams, myTeamId],
  );
  const canSwitch = opponentTeams.length > 1;

  // Fetch roster — today only, current players only. Adds nbaTricode so the
  // matchup chip / live-game data resolves the same way as (tabs)/roster.
  const { data: rosterPlayers, isLoading: isLoadingRoster } = useQuery<RosterPlayer[]>({
    queryKey: queryKeys.viewTeamRoster(viewTeamId!, today),
    queryFn: async () => {
      const slots = await fetchTeamSlots(viewTeamId!, leagueId!, today);
      const playerIds = [...slots.currentPlayerIds];
      if (playerIds.length === 0) return [];

      const [statsResult, playersResult] = await Promise.all([
        supabase.from('player_season_stats').select('*').in('player_id', playerIds),
        supabase
          .from('players')
          .select('id, name, position, pro_team, external_id_nba, status')
          .in('id', playerIds),
      ]);
      if (statsResult.error) throw statsResult.error;

      type PlayerInfo = NonNullable<typeof playersResult.data>[number];
      const playerInfoMap = new Map<string, PlayerInfo>();
      for (const p of playersResult.data ?? []) playerInfoMap.set(p.id, p);

      const tricodeMap = new Map<string, string>(
        (playersResult.data ?? [])
          .filter(
            (p): p is PlayerInfo & { pro_team: string } =>
              !!p.pro_team && p.pro_team !== 'Active' && p.pro_team !== 'Inactive',
          )
          .map((p) => [p.id, p.pro_team]),
      );

      const statsById = new Map<string, PlayerSeasonStats>();
      for (const p of (statsResult.data as PlayerSeasonStats[]) ?? []) {
        statsById.set(p.player_id, p);
      }

      return playerIds.map((pid): RosterPlayer => {
        const stats = statsById.get(pid);
        const info = playerInfoMap.get(pid);
        if (stats) {
          return {
            ...stats,
            status: info?.status ?? stats.status,
            roster_slot: slots.slotMap.get(pid) ?? null,
            nbaTricode: tricodeMap.get(pid) ?? null,
          };
        }
        return {
          player_id: pid,
          name: info?.name ?? 'Unknown',
          position: info?.position ?? '—',
          pro_team: info?.pro_team ?? '—',
          status: info?.status ?? 'active',
          external_id_nba: info?.external_id_nba ?? null,
          // PlayerSeasonStats has many optional fields — leave them undefined
          // so the row falls back to the no-stats path.
          roster_slot: slots.slotMap.get(pid) ?? null,
          nbaTricode: tricodeMap.get(pid) ?? null,
        } as RosterPlayer;
      });
    },
    enabled: !!viewTeamId && !!leagueId,
    staleTime: 1000 * 60 * 2,
  });

  // Schedule for today — populates the upcoming-game chip pre-tipoff.
  const { data: daySchedule } = useQuery<Map<string, ScheduleEntry>>({
    queryKey: [...queryKeys.daySchedule(today), sport],
    queryFn: () => fetchNbaScheduleForDate(today, sport),
    staleTime: 1000 * 60 * 60,
  });

  // Live stats (today only)
  const playerIdList = rosterPlayers?.map((p) => p.player_id) ?? [];
  const rawLiveMap = useLivePlayerStats(playerIdList, true);
  const liveMap = new Map(
    [...rawLiveMap].filter(([, stats]) => stats.game_date === today),
  );

  const isLoading = isLoadingConfig || isLoadingRoster;

  // ─── Build slot entries ─────────────────────────────────────────────────────

  const slots: SlotEntry[] = [];
  const benchPlayers: RosterPlayer[] = [];
  const irSlots: SlotEntry[] = [];
  const taxiSlots: SlotEntry[] = [];

  if (rosterConfig && rosterPlayers) {
    const benchConfig = rosterConfig.find((cfg) => cfg.position === 'BE');
    const irConfig = rosterConfig.find((cfg) => cfg.position === 'IR');
    const taxiConfig = rosterConfig.find((cfg) => cfg.position === 'TAXI');
    const activeConfigs = rosterConfig.filter(
      (cfg) =>
        cfg.position !== 'BE' && cfg.position !== 'IR' && cfg.position !== 'TAXI',
    );

    const validSlotNames = new Set<string>();
    for (const config of activeConfigs) {
      if (config.position === 'UTIL') {
        for (let i = 1; i <= config.slot_count; i++) validSlotNames.add(`UTIL${i}`);
      } else {
        validSlotNames.add(config.position);
      }
    }

    const placedPlayerIds = new Set<string>();
    for (const config of activeConfigs) {
      if (config.position === 'UTIL') {
        for (let i = 0; i < config.slot_count; i++) {
          const numberedSlot = `UTIL${i + 1}`;
          const player =
            rosterPlayers.find(
              (p) => p.roster_slot === numberedSlot && !placedPlayerIds.has(p.player_id),
            ) ?? null;
          if (player) placedPlayerIds.add(player.player_id);
          slots.push({ slotPosition: numberedSlot, slotIndex: i, player });
        }
      } else {
        const playersInSlot = rosterPlayers.filter(
          (p) => p.roster_slot === config.position && !placedPlayerIds.has(p.player_id),
        );
        for (let i = 0; i < config.slot_count; i++) {
          const player = playersInSlot[i] ?? null;
          if (player) placedPlayerIds.add(player.player_id);
          slots.push({
            slotPosition: config.position,
            slotIndex: i,
            player,
          });
        }
      }
    }

    for (const player of rosterPlayers) {
      if (player.roster_slot === 'IR' || player.roster_slot === 'TAXI') continue;
      if (
        !player.roster_slot ||
        player.roster_slot === 'BE' ||
        !validSlotNames.has(player.roster_slot) ||
        !placedPlayerIds.has(player.player_id)
      ) {
        benchPlayers.push(player);
      }
    }

    const benchSlotCount = Math.max(benchConfig?.slot_count ?? 0, benchPlayers.length);
    for (let i = 0; i < benchSlotCount; i++) {
      slots.push({
        slotPosition: 'BE',
        slotIndex: i,
        player: benchPlayers[i] ?? null,
      });
    }

    if (irConfig && irConfig.slot_count > 0) {
      const irPlayers = rosterPlayers.filter((p) => p.roster_slot === 'IR');
      const irSlotCount = Math.max(irConfig.slot_count, irPlayers.length);
      for (let i = 0; i < irSlotCount; i++) {
        irSlots.push({
          slotPosition: 'IR',
          slotIndex: i,
          player: irPlayers[i] ?? null,
        });
      }
    }

    if (taxiConfig && taxiConfig.slot_count > 0) {
      const taxiPlayers = rosterPlayers.filter((p) => p.roster_slot === 'TAXI');
      const taxiSlotCount = Math.max(taxiConfig.slot_count, taxiPlayers.length);
      for (let i = 0; i < taxiSlotCount; i++) {
        taxiSlots.push({
          slotPosition: 'TAXI',
          slotIndex: i,
          player: taxiPlayers[i] ?? null,
        });
      }
    }
  }

  // ─── Today-only stats resolver (mirrors the today branch in
  //     (tabs)/roster.tsx's resolveSlotStats — read-only, so no past/future).
  function resolveSlotStats(player: RosterPlayer | null): {
    fpts: number | null;
    statLine: string | null;
    isLive: boolean;
    matchup: string | null;
    gameTimeUtc: string | null;
  } {
    if (!player || !scoringWeights) {
      return { fpts: null, statLine: null, isLive: false, matchup: null, gameTimeUtc: null };
    }
    const live = liveMap.get(player.player_id);
    const scheduleEntry = player.nbaTricode
      ? daySchedule?.get(player.nbaTricode) ?? null
      : null;
    const todayMatchup = scheduleEntry?.matchup ?? null;
    const todayGameTime = scheduleEntry?.gameTimeUtc ?? null;
    if (!live && !todayMatchup) {
      return { fpts: null, statLine: null, isLive: false, matchup: null, gameTimeUtc: null };
    }
    if (live) {
      const stats = liveToGameLog(live);
      const fpts = isCategories
        ? null
        : Math.round(
            calculateGameFantasyPoints(
              stats as unknown as PlayerGameLog,
              scoringWeights,
            ) * 10,
          ) / 10;
      return {
        fpts,
        statLine:
          live.game_status === 1
            ? null
            : buildStatLine(stats as Record<string, number>),
        isLive: live.game_status === 2,
        matchup: live.matchup || null,
        gameTimeUtc: null,
      };
    }
    return {
      fpts: isCategories ? null : 0,
      statLine: null,
      isLive: false,
      matchup: todayMatchup,
      gameTimeUtc: todayGameTime,
    };
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
        <PageHeader title={teamName ?? 'Team'} />
        <View style={styles.centered}>
          <LogoSpinner />
        </View>
      </SafeAreaView>
    );
  }

  if (isTeamError) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
        <PageHeader title="Team" />
        <ThemedText style={{ textAlign: 'center', marginTop: 40, fontSize: ms(15), color: c.secondaryText }}>
          Team not found
        </ThemedText>
      </SafeAreaView>
    );
  }

  const starterSlots = slots.filter((s) => s.slotPosition !== 'BE');
  const benchSlots = slots.filter((s) => s.slotPosition === 'BE');

  const starterTotal = scoringWeights
    ? starterSlots.reduce((sum, slot) => {
        if (!slot.player) return sum;
        const { fpts, isLive } = resolveSlotStats(slot.player);
        if (!isLive && fpts !== null) {
          if (!liveMap.get(slot.player.player_id)) return sum;
        }
        return fpts !== null ? sum + fpts : sum;
      }, 0)
    : null;

  const renderSlotRow = (slot: SlotEntry, idx: number, list: SlotEntry[]) => {
    const { fpts, statLine, isLive, matchup, gameTimeUtc } = resolveSlotStats(slot.player);
    const isPreGame = !!matchup && !isLive && !statLine;
    const matchupDisplay = matchup
      ? gameTimeUtc && !isLive
        ? `${matchup} · ${formatGameTime(gameTimeUtc)}`
        : matchup
      : null;
    const liveData = slot.player ? liveMap.get(slot.player.player_id) : null;
    const isOnCourt = !!(liveData?.oncourt && liveData.game_status === 2);
    const gameInfo = liveData ? formatGameInfo(liveData) : '';

    return (
      <View
        key={`${slot.slotPosition}-${slot.slotIndex}`}
        style={[
          styles.slotRow,
          idx % 2 === 1 && { backgroundColor: c.cardAlt },
          idx < list.length - 1 && {
            borderBottomColor: c.border,
            borderBottomWidth: StyleSheet.hairlineWidth,
          },
        ]}
      >
        {/* Slot pill — read-only chip (matches the visual but not interactive) */}
        <View
          style={[
            styles.slotPill,
            {
              backgroundColor: slot.player ? c.cardAlt : 'transparent',
              borderColor: c.border,
              borderWidth: 1,
            },
          ]}
        >
          <ThemedText
            type="varsitySmall"
            style={[
              styles.slotPillText,
              { color: slot.player ? c.text : c.secondaryText },
            ]}
          >
            {slotLabel(slot.slotPosition)}
          </ThemedText>
        </View>

        {slot.player ? (
          <TouchableOpacity
            style={styles.slotPlayer}
            onPress={() => setSelectedPlayer(slot.player)}
            accessibilityRole="button"
            accessibilityLabel={`${slot.player!.name}, ${formatPosition(slot.player!.position)}, ${slot.player!.pro_team}${matchupDisplay ? `, ${matchupDisplay}` : ''}${!isCategories && fpts !== null ? `, ${formatScore(fpts)} fantasy points` : ''}${isLive ? ', live' : ''}`}
            accessibilityHint="Opens player details"
          >
            <View style={styles.rosterPortraitWrap} accessible={false}>
              <View
                style={[
                  styles.rosterHeadshotCircle,
                  {
                    borderColor: isOnCourt ? c.success : c.heritageGold,
                    backgroundColor: c.cardAlt,
                  },
                ]}
                accessible={false}
              >
                <PlayerHeadshotImage
                  externalIdNba={slot.player.external_id_nba}
                  sport={sport}
                  style={styles.rosterHeadshotImg}
                  accessible={false}
                />
              </View>
              {(() => {
                const logoUrl = getTeamLogoUrl(slot.player.pro_team, sport);
                return (
                  <View style={styles.rosterTeamPill}>
                    {logoUrl && (
                      <Image
                        source={{ uri: logoUrl }}
                        style={styles.rosterTeamPillLogo}
                        contentFit="contain"
                        cachePolicy="memory-disk"
                        recyclingKey={logoUrl}
                      />
                    )}
                    <Text style={[styles.rosterTeamPillText, { color: c.statusText }]}>
                      {slot.player.pro_team}
                    </Text>
                  </View>
                );
              })()}
            </View>

            <View style={styles.slotPlayerInfo}>
              <View style={styles.slotLine1}>
                <ThemedText
                  type="defaultSemiBold"
                  style={[styles.slotPlayerName, { flexShrink: 1 }]}
                  numberOfLines={1}
                >
                  {slot.player.name}
                </ThemedText>
                {(() => {
                  const badge = getInjuryBadge(slot.player.status);
                  return badge ? (
                    <View style={[styles.liveBadge, { backgroundColor: badge.color }]}>
                      <Text style={[styles.liveText, { color: c.statusText }]}>{badge.label}</Text>
                    </View>
                  ) : null;
                })()}
              </View>

              {matchupDisplay && !isPreGame ? (
                <View style={styles.slotMatchupRow}>
                  <MatchupChip matchup={matchupDisplay} isLive={isLive} c={c} />
                  {gameInfo ? (
                    <ThemedText
                      type="varsitySmall"
                      style={[
                        styles.matchupChipMeta,
                        { color: isLive ? c.success : c.secondaryText },
                      ]}
                      numberOfLines={1}
                    >
                      {gameInfo}
                    </ThemedText>
                  ) : null}
                </View>
              ) : (
                <ThemedText
                  type="varsitySmall"
                  style={[styles.slotMatchupText, { color: c.secondaryText }]}
                  numberOfLines={1}
                >
                  {formatPosition(slot.player.position)}
                </ThemedText>
              )}

              {statLine ? (
                <ThemedText
                  style={[styles.slotStatLine, { color: c.secondaryText }]}
                  numberOfLines={1}
                >
                  {statLine}
                </ThemedText>
              ) : null}
            </View>

            {!isCategories && isPreGame ? (
              <View style={styles.slotUpcoming} accessible={false}>
                <MatchupChip matchup={matchup!} c={c} alignSelf="flex-end" />
                {gameTimeUtc ? (
                  <ThemedText
                    type="varsitySmall"
                    style={[styles.slotUpcomingTime, { color: c.secondaryText }]}
                    numberOfLines={1}
                  >
                    {formatGameTime(gameTimeUtc)}
                  </ThemedText>
                ) : null}
              </View>
            ) : null}
            {!isCategories && !isPreGame && (
              <AnimatedFpts
                value={fpts}
                accentColor={c.gold}
                dimColor={c.secondaryText}
                textStyle={styles.slotFpts}
                animate
                projected={false}
              />
            )}
          </TouchableOpacity>
        ) : (
          <View style={styles.slotPlayer}>
            <View style={styles.rosterPortraitWrap}>
              <View
                style={[
                  styles.emptyHeadshot,
                  { borderColor: c.border, backgroundColor: c.cardAlt },
                ]}
              >
                <Ionicons name="remove" size={18} color={c.secondaryText} />
              </View>
            </View>
            <View style={styles.slotPlayerInfo}>
              <ThemedText
                type="varsitySmall"
                style={[styles.emptySlotEyebrow, { color: c.secondaryText }]}
              >
                EMPTY SLOT
              </ThemedText>
            </View>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      <PageHeader
        title={teamName ?? 'Team Roster'}
        titleNode={
          canSwitch ? (
            <TouchableOpacity
              onPress={() => setShowSwitcher(true)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`${teamName ?? 'Team'}. Tap to switch teams.`}
              hitSlop={8}
              style={titleStyles.titleHit}
            >
              <ThemedText
                type="varsity"
                style={[titleStyles.titleText, { color: c.secondaryText }]}
                numberOfLines={1}
              >
                {teamName ?? 'TEAM ROSTER'}
              </ThemedText>
              <Ionicons
                name="chevron-down"
                size={ms(12)}
                color={c.secondaryText}
                style={titleStyles.titleChevron}
                accessible={false}
              />
            </TouchableOpacity>
          ) : undefined
        }
        rightAction={
          !isOwnTeam && !isPastDeadline && myTeamId && leagueId ? (
            <TouchableOpacity
              onPress={() => setShowTradeModal(true)}
              style={[titleStyles.headerTradeBtn, { backgroundColor: c.accent }]}
              accessibilityRole="button"
              accessibilityLabel={`Propose Trade with ${teamName}`}
            >
              <Text style={[titleStyles.headerTradeBtnText, { color: c.accentText }]}>Trade</Text>
            </TouchableOpacity>
          ) : undefined
        }
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Starters */}
        <View style={styles.section}>
          <SectionEyebrow
            label="STARTERS"
            right={
              !isCategories && starterTotal !== null ? (
                <View
                  style={[
                    styles.headerPill,
                    { backgroundColor: c.cardAlt, borderColor: c.border },
                  ]}
                  accessibilityLabel={`Fantasy points: ${formatScore(starterTotal)}`}
                >
                  <ThemedText
                    type="varsitySmall"
                    style={[styles.headerPillLabel, { color: c.gold }]}
                  >
                    FPTS
                  </ThemedText>
                  <ThemedText
                    type="mono"
                    style={[styles.headerPillValue, { color: c.text }]}
                  >
                    {formatScore(starterTotal)}
                  </ThemedText>
                </View>
              ) : null
            }
          />
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            {starterSlots.map((slot, idx) => renderSlotRow(slot, idx, starterSlots))}
          </View>
        </View>

        {/* Bench */}
        <View style={styles.section}>
          <SectionEyebrow label="BENCH" />
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            {benchSlots.length > 0 ? (
              benchSlots.map((slot, idx) => renderSlotRow(slot, idx, benchSlots))
            ) : (
              <View style={styles.emptyBench}>
                <ThemedText
                  type="varsitySmall"
                  style={{ color: c.secondaryText, letterSpacing: 1.2 }}
                >
                  NO BENCH SLOTS
                </ThemedText>
              </View>
            )}
          </View>
        </View>

        {/* IR */}
        {irSlots.length > 0 && (
          <View style={styles.section}>
            <SectionEyebrow label="INJURED RESERVE" />
            <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
              {irSlots.map((slot, idx) => renderSlotRow(slot, idx, irSlots))}
            </View>
          </View>
        )}

        {/* Taxi Squad */}
        {taxiSlots.length > 0 && (
          <View style={styles.section}>
            <SectionEyebrow label="TAXI SQUAD" />
            <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
              {taxiSlots.map((slot, idx) => renderSlotRow(slot, idx, taxiSlots))}
            </View>
          </View>
        )}
      </ScrollView>

      <PlayerDetailModal
        player={selectedPlayer}
        leagueId={leagueId ?? ''}
        teamId={myTeamId ?? undefined}
        onClose={() => setSelectedPlayer(null)}
      />

      {showTradeModal && !isOwnTeam && myTeamId && leagueId && viewTeamId && (
        <ProposeTradeModal
          leagueId={leagueId}
          teamId={myTeamId}
          preselectedTeamId={viewTeamId}
          onClose={() => setShowTradeModal(false)}
        />
      )}

      <BottomSheet
        visible={showSwitcher}
        onClose={() => setShowSwitcher(false)}
        title="Team"
        subtitle={`${opponentTeams.length} OPPONENTS · TAP TO SWITCH`}
        height="60%"
        scrollableBody={false}
      >
        <FlatList
          data={opponentTeams}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const isCurrent = item.id === viewTeamId;
            return (
              <TouchableOpacity
                onPress={() => {
                  setShowSwitcher(false);
                  if (!isCurrent) router.replace(`/team-roster/${item.id}` as never);
                }}
                activeOpacity={0.65}
                accessibilityRole="button"
                accessibilityState={{ selected: isCurrent }}
                accessibilityLabel={`${item.name}${isCurrent ? ', currently viewing' : ''}`}
                style={[
                  switcherStyles.row,
                  { borderBottomColor: c.border },
                  isCurrent && { backgroundColor: c.goldMuted },
                ]}
              >
                <TeamLogo
                  logoKey={item.logo_key}
                  teamName={item.name}
                  tricode={item.tricode ?? undefined}
                  size="medium"
                />
                <View style={switcherStyles.rowText}>
                  <ThemedText
                    type="defaultSemiBold"
                    style={[switcherStyles.rowName, { color: isCurrent ? c.gold : c.text }]}
                    numberOfLines={1}
                  >
                    {item.name}
                  </ThemedText>
                  {item.tricode ? (
                    <ThemedText
                      type="varsitySmall"
                      style={[switcherStyles.rowTricode, { color: c.secondaryText }]}
                    >
                      {item.tricode}
                    </ThemedText>
                  ) : null}
                </View>
                {isCurrent && (
                  <Ionicons
                    name="checkmark-circle"
                    size={ms(18)}
                    color={c.gold}
                    accessible={false}
                  />
                )}
              </TouchableOpacity>
            );
          }}
        />
      </BottomSheet>
    </SafeAreaView>
  );
}

// Title-region styles (header dropdown + trade button) live alongside the
// shared rosterStyles so we don't duplicate the row layout.
const titleStyles = StyleSheet.create({
  titleHit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
    paddingHorizontal: s(4),
    paddingVertical: s(4),
  },
  titleText: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(12),
    letterSpacing: 1.2,
  },
  titleChevron: { marginTop: 1 },
  headerTradeBtn: {
    paddingHorizontal: s(10),
    paddingVertical: s(5),
    borderRadius: 6,
  },
  headerTradeBtnText: { fontSize: ms(12), fontWeight: '700' },
});

const switcherStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: s(4),
    paddingVertical: s(10),
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: s(12),
  },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { fontSize: ms(15) },
  rowTricode: { fontSize: ms(10), letterSpacing: 0.6, marginTop: 2 },
});
