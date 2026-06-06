import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OnCourtDot } from '@/components/matchup/PlayerCell';
import { MatchupChip } from '@/components/player/MatchupChip';
import { PlayerDetailModal } from '@/components/player/PlayerDetailModal';
import { PlayerHeadshotImage } from '@/components/player/PlayerHeadshotImage';
import { AnimatedFpts } from '@/components/roster/AnimatedFpts';
import {
  buildSeasonAverages,
  type SeasonAverages,
} from '@/components/roster/rosterData';
import {
  rosterStyles as styles,
  slotPillVariant,
} from '@/components/roster/rosterStyles';
import {
  RosterWindowPicker,
  type RosterStatMode,
} from '@/components/roster/RosterWindowPicker';
import { SeasonMetaLine } from '@/components/roster/SeasonMetaLine';
import { SectionEyebrow } from '@/components/roster/SectionEyebrow';
import { RosterPlayer, SlotEntry } from '@/components/roster/SlotPickerModal';
import { UpcomingGame } from '@/components/roster/UpcomingGame';
import { TeamLogo } from '@/components/team/TeamLogo';
import { ProposeTradeModal } from '@/components/trade/ProposeTradeModal';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Fonts } from '@/constants/Colors';
import { formatSeasonShort, getPreviousSeason } from '@/constants/LeagueDefaults';
import { queryKeys } from '@/constants/queryKeys';
import { useAppState } from '@/context/AppStateProvider';
import { useActiveLeagueSport } from '@/hooks/useActiveLeagueSport';
import { useColors } from '@/hooks/useColors';
import { useLeague } from '@/hooks/useLeague';
import { useLeagueRosterConfig } from '@/hooks/useLeagueRosterConfig';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import {
  usePlayerProjections,
  type ProjectionRow,
} from '@/hooks/usePlayerProjections';
import { usePrevSeasonFpts } from '@/hooks/usePrevSeasonFpts';
import { useRosterGameLogs } from '@/hooks/useRosterGameLogs';
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
import { ROSTER_SLOT } from '@/utils/roster/rosterSlotsShared';
import { ms, s } from '@/utils/scale';
import {
  calculateGameFantasyPoints,
  formatScore,
  gameWindowSize,
  projAvgRowToFpts,
} from '@/utils/scoring/fantasyPoints';

// Heritage deck watermark — same patch that bleeds into the corner of the
// matchup / roster heroes, so this header reads as part of that family.
const PATCH_SOURCE = require('../../assets/images/patch_logo.png');

// ─── Types ───────────────────────────────────────────────────────────────────

interface LeagueTeamMeta {
  id: string;
  name: string;
  tricode: string | null;
  logo_key: string | null;
  wins: number | null;
  losses: number | null;
  ties: number;
}

function formatRecord(
  t: { wins: number | null; losses: number | null; ties: number } | null,
): string {
  if (!t) return '';
  const w = t.wins ?? 0;
  const l = t.losses ?? 0;
  return t.ties > 0 ? `${w}-${l}-${t.ties}` : `${w}-${l}`;
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
  // Forward-facing stat window — only affects pre-game / no-game rows, just
  // like in (tabs)/roster.tsx. Past dates aren't selectable on this page,
  // and live/finished games render their real stats unchanged.
  const [windowSel, setWindowSel] = useState<RosterStatMode>('season');

  const isOwnTeam = viewTeamId === myTeamId;
  const today = getSportToday(sport);

  const { data: league } = useLeague();
  const isCategories = league?.scoring_type === 'h2h_categories';

  // Next-game projections — shown inline next to each upcoming game, and in the
  // per-row context slot when the window picker is on "Proj" (points only).
  const { data: nextGameProjections } = usePlayerProjections(
    sport,
    'next_game',
    !isCategories,
  );

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
        .select('id, name, tricode, logo_key, wins, losses, ties')
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

  const viewedTeam = useMemo(
    () => (leagueTeams ?? []).find((t) => t.id === viewTeamId) ?? null,
    [leagueTeams, viewTeamId],
  );

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

  // Previous-season fpts/G (points leagues) — powers the "Prev" window option.
  const { data: prevSeasonFpts } = usePrevSeasonFpts(
    leagueId,
    sport,
    isCategories ? [] : playerIdList,
    scoringWeights,
  );
  const prevSeasonLabel = formatSeasonShort(getPreviousSeason(sport), sport);

  // Window state for forward-facing stat display. Same gating + adaptive
  // options as the user's roster page so the two views read identically.
  const isProjMode = windowSel === 'proj';
  const isPrevMode = windowSel === 'prev';
  const winSize =
    windowSel === 'proj' || windowSel === 'prev' ? null : gameWindowSize(windowSel);
  const { data: rosterLogsByPlayer } = useRosterGameLogs(
    winSize != null ? playerIdList : [],
  );
  const maxRosterGames = useMemo(() => {
    let max = 0;
    for (const p of rosterPlayers ?? []) {
      const g = (p as Partial<PlayerSeasonStats>).games_played ?? 0;
      if (g > max) max = g;
    }
    return max;
  }, [rosterPlayers]);
  const availableWindows = useMemo<readonly RosterStatMode[]>(() => {
    const out: RosterStatMode[] = [];
    if (maxRosterGames >= 5) out.push('L5');
    if (maxRosterGames >= 10) out.push('L10');
    if (maxRosterGames >= 15) out.push('L15');
    out.push('season');
    // Proj under Season, Prev under Proj (points leagues only).
    if (!isCategories && nextGameProjections && nextGameProjections.size > 0) {
      out.push('proj');
    }
    if (!isCategories && prevSeasonFpts && prevSeasonFpts.size > 0) {
      out.push('prev');
    }
    return out;
  }, [maxRosterGames, isCategories, nextGameProjections, prevSeasonFpts]);
  // Snap stale selection back to 'season' so the picker never lands on a
  // hidden option after a season rollover.
  useEffect(() => {
    if (!availableWindows.includes(windowSel)) setWindowSel('season');
  }, [availableWindows, windowSel]);

  const isLoading = isLoadingConfig || isLoadingRoster;

  // ─── Build slot entries ─────────────────────────────────────────────────────

  const slots: SlotEntry[] = [];
  const benchPlayers: RosterPlayer[] = [];
  const irSlots: SlotEntry[] = [];
  const taxiSlots: SlotEntry[] = [];

  if (rosterConfig && rosterPlayers) {
    const benchConfig = rosterConfig.find((cfg) => cfg.position === 'BE');
    const irConfig = rosterConfig.find((cfg) => cfg.position === 'IR');
    const taxiConfig = rosterConfig.find((cfg) => cfg.position === ROSTER_SLOT.TAXI);
    const activeConfigs = rosterConfig.filter(
      (cfg) =>
        cfg.position !== 'BE' && cfg.position !== 'IR' && cfg.position !== ROSTER_SLOT.TAXI,
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
      if (player.roster_slot === 'IR' || player.roster_slot === ROSTER_SLOT.TAXI) continue;
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
      const taxiPlayers = rosterPlayers.filter((p) => p.roster_slot === ROSTER_SLOT.TAXI);
      const taxiSlotCount = Math.max(taxiConfig.slot_count, taxiPlayers.length);
      for (let i = 0; i < taxiSlotCount; i++) {
        taxiSlots.push({
          slotPosition: ROSTER_SLOT.TAXI,
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

  // Pre-formatted next-game projected fpts for a player, e.g. "18.3" — or null
  // when there's no usable projection. Drives the inline next-to-game readout.
  const projFptsFor = (playerId: string): string | null => {
    if (isCategories || !scoringWeights || !nextGameProjections) return null;
    const pr = nextGameProjections.get(playerId);
    if (!pr) return null;
    const fpts = projAvgRowToFpts(pr as Record<string, unknown>, scoringWeights);
    return fpts > 0 ? fpts.toFixed(1) : null;
  };

  // A next-game projection shaped like a SeasonAverages so SeasonMetaLine can
  // render it (labeled PROJ) when the window picker is on "Proj".
  const projToContext = (pr: ProjectionRow | undefined): SeasonAverages | null => {
    if (!pr || !scoringWeights) return null;
    const fpts = projAvgRowToFpts(pr as Record<string, unknown>, scoringWeights);
    if (fpts <= 0) return null;
    const stats = `${(pr.proj_pts ?? 0).toFixed(1)}P/${(pr.proj_reb ?? 0).toFixed(1)}R/${(pr.proj_ast ?? 0).toFixed(1)}A`;
    return { stats, fpts: fpts.toFixed(1) };
  };

  // Last season's fpts/G for the "Prev" context mode (`stats` stays empty — only
  // the fpts is shown). Null when no prior row.
  const prevToContext = (playerId: string): SeasonAverages | null => {
    const fpts = prevSeasonFpts?.get(playerId);
    return fpts && fpts > 0 ? { stats: '', fpts: fpts.toFixed(1) } : null;
  };

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
    // Season context on rows without actual stats (pre-game and no-game): a
    // single line beside the position — the fpts average (points leagues) or
    // the box score (category leagues, no fpts). Null for 0-game players.
    const seasonAvg =
      slot.player && !isLive && !statLine
        ? buildSeasonAverages(
            slot.player,
            scoringWeights,
            isCategories,
            winSize != null
              ? {
                  gameLog: rosterLogsByPlayer?.get(slot.player.player_id),
                  windowSize: winSize,
                }
              : undefined,
          )
        : null;
    // "Proj"/"Prev" windows swap the context number for the next-game projection
    // or last season's average (else the season avg).
    const forwardOk = slot.player && !isLive && !statLine;
    const projContext =
      isProjMode && forwardOk
        ? projToContext(nextGameProjections?.get(slot.player!.player_id))
        : null;
    const prevContext =
      isPrevMode && forwardOk ? prevToContext(slot.player!.player_id) : null;
    const contextAvg = projContext ?? prevContext ?? seasonAvg;
    const contextLabel = projContext
      ? 'PROJ'
      : prevContext
        ? prevSeasonLabel
        : 'FPTS/G';
    // Inline projection next to the upcoming game — only for players with a game.
    const upcomingProj =
      isPreGame && slot.player ? projFptsFor(slot.player.player_id) : null;

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
        {/* Slot pill — always read-only here (another team's roster), so it
            uses the neutral-border variant matching the locked/past-day pills
            on the user's own roster. */}
        {(() => {
          const pill = slotPillVariant(c, {
            canEdit: false,
            isActive: false,
            hasPlayer: !!slot.player,
          });
          return (
            <View style={[styles.slotPill, pill.container]}>
              <ThemedText
                type="varsitySmall"
                style={[styles.slotPillText, { color: pill.textColor }]}
              >
                {slotLabel(slot.slotPosition)}
              </ThemedText>
            </View>
          );
        })()}

        {slot.player ? (
          <TouchableOpacity
            style={styles.slotPlayer}
            onPress={() => setSelectedPlayer(slot.player)}
            accessibilityRole="button"
            accessibilityLabel={`${slot.player!.name}, ${formatPosition(slot.player!.position)}, ${slot.player!.pro_team}${matchupDisplay ? `, ${matchupDisplay}` : ''}${seasonAvg ? `, season average ${seasonAvg.fpts ? `${seasonAvg.fpts} fantasy points per game, ` : ''}${seasonAvg.stats}` : ''}${!isCategories && fpts !== null ? `, ${formatScore(fpts)} fantasy points` : ''}${isLive ? ', live' : ''}`}
            accessibilityHint="Opens player details"
          >
            <View style={styles.rosterPortraitWrap} accessible={false}>
              <View
                style={[
                  styles.rosterHeadshotCircle,
                  {
                    borderColor: c.heritageGold,
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
              {/* On-court dot leads the name line (mirrors roster + matchup). */}
              <View style={styles.slotLine1}>
                {isOnCourt && <OnCourtDot />}
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

              {/* Context line. Live/final: matchup chip + game info. Otherwise
                  the position with the season fpts average beside it — the game
                  itself lives in its own section on the right. */}
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
                <SeasonMetaLine
                  position={slot.player.position}
                  seasonAvg={contextAvg}
                  valueLabel={contextLabel}
                  c={c}
                />
              )}

              {/* Mono detail line — actual game stats on played days. */}
              {statLine ? (
                <ThemedText
                  style={[styles.slotStatLine, { color: c.secondaryText }]}
                  numberOfLines={1}
                >
                  {statLine}
                </ThemedText>
              ) : null}
            </View>

            {/* Right column — opponent pill + tipoff time on pre-game rows;
                FPTS readout on live/final. */}
            {isPreGame ? (
              <UpcomingGame
                matchup={matchup!}
                gameTimeUtc={gameTimeUtc}
                projFpts={upcomingProj}
                c={c}
              />
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
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Team identity — hero band: logo + name + record on the turf
            surface, matching the matchup / roster heroes. */}
        {viewedTeam && (
          <View
            style={[titleStyles.identityCard, { backgroundColor: c.heroSurface }, c.heroShadow]}
            accessible
            accessibilityLabel={`${viewedTeam.name}, record ${formatRecord(viewedTeam) || 'none'}`}
          >
            <Image
              source={PATCH_SOURCE}
              style={titleStyles.identityPatch}
              contentFit="contain"
              cachePolicy="memory-disk"
              transition={0}
              accessible={false}
            />
            <View style={titleStyles.identityRule} />
            <View style={titleStyles.identityLogoRing}>
              <TeamLogo
                logoKey={viewedTeam.logo_key}
                teamName={viewedTeam.name}
                tricode={viewedTeam.tricode ?? undefined}
                size="large"
              />
            </View>
            <View style={titleStyles.identityLabels}>
              <ThemedText
                type="display"
                style={titleStyles.identityName}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {viewedTeam.name}
              </ThemedText>
              <View style={titleStyles.identityMetaRow}>
                {viewedTeam.tricode ? (
                  <ThemedText type="varsitySmall" style={titleStyles.identityTricode}>
                    {viewedTeam.tricode.toUpperCase()}
                  </ThemedText>
                ) : null}
                {formatRecord(viewedTeam) !== '' && (
                  <>
                    {viewedTeam.tricode ? (
                      <View style={titleStyles.identityDot} />
                    ) : null}
                    <ThemedText type="mono" style={titleStyles.identityRecord}>
                      {formatRecord(viewedTeam)}
                    </ThemedText>
                  </>
                )}
              </View>
            </View>
            {!isOwnTeam && !isPastDeadline && myTeamId && leagueId ? (
              <TouchableOpacity
                onPress={() => setShowTradeModal(true)}
                style={[titleStyles.identityTradeBtn, { backgroundColor: c.accent }]}
                accessibilityRole="button"
                accessibilityLabel={`Propose trade with ${viewedTeam.name}`}
              >
                <Text style={[titleStyles.identityTradeBtnText, { color: c.accentText }]}>
                  TRADE
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}

        {/* Starters */}
        <View style={styles.section}>
          <SectionEyebrow
            label="STARTERS"
            leftAccessory={
              <RosterWindowPicker
                windowSel={windowSel}
                onWindowChange={setWindowSel}
                availableWindows={availableWindows}
                prevLabel={prevSeasonLabel}
              />
            }
            right={
              <>
                {!isCategories && starterTotal !== null ? (
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
                ) : null}
              </>
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

  // Team identity hero band — turf surface + gold top-rule + patch
  // watermark, mirroring RosterHero / MatchupHero chrome.
  identityCard: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(14),
    borderRadius: 16,
    paddingVertical: s(14),
    paddingHorizontal: s(16),
    marginHorizontal: s(16),
    marginTop: s(12),
    marginBottom: s(4),
    overflow: 'hidden',
  },
  identityRule: {
    position: 'absolute',
    top: 0,
    left: s(16),
    height: 3,
    width: s(36),
    backgroundColor: Brand.vintageGold,
  },
  identityPatch: {
    position: 'absolute',
    right: s(-20),
    bottom: s(-24),
    width: s(108),
    height: s(108),
    opacity: 0.12,
  },
  // Thin gold ring around the logo so it reads as a framed crest rather
  // than a floating avatar.
  identityLogoRing: {
    padding: s(2),
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: 'rgba(181, 123, 48, 0.65)',
  },
  identityLabels: { flex: 1, gap: s(4) },
  identityName: {
    color: Brand.ecru,
    fontSize: ms(24),
    lineHeight: ms(30),
    letterSpacing: -0.5,
  },
  identityMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(7),
  },
  identityTricode: {
    color: Brand.vintageGold,
    fontSize: ms(11),
    letterSpacing: 1.2,
  },
  identityDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: Brand.ecruFaint,
  },
  identityRecord: {
    color: Brand.ecruMuted,
    fontSize: ms(13),
    letterSpacing: 0.5,
  },
  // Gold CTA pinned to the right edge of the band — the primary action
  // for an opponent roster now lives in the hero instead of the header.
  identityTradeBtn: {
    flexShrink: 0,
    paddingHorizontal: s(14),
    paddingVertical: s(8),
    borderRadius: 8,
  },
  identityTradeBtnText: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(12),
    letterSpacing: 1,
  },
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
