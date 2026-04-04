import { PlayerDetailModal } from '@/components/player/PlayerDetailModal';
import { ProposeTradeModal } from '@/components/trade/ProposeTradeModal';
import { ThemedText } from '@/components/ui/ThemedText';
import { PageHeader } from '@/components/ui/PageHeader';
import { Colors } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';
import { useLeagueRosterConfig, RosterConfigSlot } from '@/hooks/useLeagueRosterConfig';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { supabase } from '@/lib/supabase';
import { PlayerSeasonStats, ScoringWeight } from '@/types/player';
import { toDateStr } from '@/utils/dates';
import { fetchTeamSlots } from '@/utils/fetchTeamSlots';
import { calculateAvgFantasyPoints } from '@/utils/fantasyPoints';
import { formatPosition } from '@/utils/formatting';
import { getInjuryBadge } from '@/utils/injuryBadge';
import { slotLabel } from '@/utils/rosterSlots';
import { queryKeys } from '@/constants/queryKeys';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { getPlayerHeadshotUrl, getTeamLogoUrl } from '@/utils/playerHeadshot';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// ─── Types ───────────────────────────────────────────────────────────────────

interface RosterPlayer extends PlayerSeasonStats {
  roster_slot: string | null;
}

interface SlotEntry {
  slotPosition: string;
  slotIndex: number;
  player: RosterPlayer | null;
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function TeamRosterScreen() {
  const { id: viewTeamId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { leagueId, teamId: myTeamId } = useAppState();

  const [selectedPlayer, setSelectedPlayer] = useState<PlayerSeasonStats | null>(null);
  const [showTradeModal, setShowTradeModal] = useState(false);

  const isOwnTeam = viewTeamId === myTeamId;

  // Check trade deadline
  const { data: leagueDeadline } = useQuery({
    queryKey: queryKeys.leagueDeadline(leagueId!),
    queryFn: async () => {
      const { data } = await supabase.from('leagues').select('trade_deadline').eq('id', leagueId!).single();
      return data?.trade_deadline as string | null;
    },
    enabled: !!leagueId,
  });
  const isPastDeadline = !!leagueDeadline && new Date(leagueDeadline + 'T23:59:59') < new Date();
  const today = toDateStr(new Date());

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

  // Fetch roster
  const { data: rosterPlayers, isLoading: isLoadingRoster } = useQuery<RosterPlayer[]>({
    queryKey: queryKeys.viewTeamRoster(viewTeamId!, today),
    queryFn: async () => {
      const { data: leaguePlayers, error: lpError } = await supabase
        .from('league_players')
        .select('player_id, roster_slot')
        .eq('team_id', viewTeamId!)
        .eq('league_id', leagueId!);

      if (lpError) throw lpError;
      if (!leaguePlayers || leaguePlayers.length === 0) return [];

      const playerIds = leaguePlayers.map((lp) => lp.player_id);

      const slots = await fetchTeamSlots(viewTeamId!, leagueId!, today);

      const { data: stats, error: statsError } = await supabase
        .from('player_season_stats')
        .select('*')
        .in('player_id', playerIds);

      if (statsError) throw statsError;

      return (stats as PlayerSeasonStats[]).map((p) => ({
        ...p,
        roster_slot: slots.slotMap.get(p.player_id) ?? null,
      }));
    },
    enabled: !!viewTeamId && !!leagueId,
    staleTime: 1000 * 60 * 2,
  });

  const isLoading = isLoadingConfig || isLoadingRoster;

  // ─── Build slot entries ─────────────────────────────────────────────────────

  const slots: SlotEntry[] = [];
  const benchPlayers: RosterPlayer[] = [];
  const irSlots: SlotEntry[] = [];

  if (rosterConfig && rosterPlayers) {
    const benchConfig = rosterConfig.find((cfg) => cfg.position === 'BE');
    const irConfig = rosterConfig.find((cfg) => cfg.position === 'IR');
    const activeConfigs = rosterConfig.filter(
      (cfg) => cfg.position !== 'BE' && cfg.position !== 'IR',
    );

    const validSlotNames = new Set<string>();
    for (const config of activeConfigs) {
      if (config.position === 'UTIL') {
        for (let i = 1; i <= config.slot_count; i++) validSlotNames.add(`UTIL${i}`);
      } else {
        validSlotNames.add(config.position);
      }
    }

    // Track which players are placed in starter slots to catch duplicates
    const placedPlayerIds = new Set<string>();

    for (const config of activeConfigs) {
      if (config.position === 'UTIL') {
        for (let i = 0; i < config.slot_count; i++) {
          const numberedSlot = `UTIL${i + 1}`;
          const player = rosterPlayers.find((p) => p.roster_slot === numberedSlot && !placedPlayerIds.has(p.player_id)) ?? null;
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
      if (player.roster_slot === 'IR') continue;
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
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.cardAlt }]}>
        <ActivityIndicator style={styles.centered} />
      </SafeAreaView>
    );
  }

  if (isTeamError) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.cardAlt }]}>
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
        const avg = calculateAvgFantasyPoints(slot.player, scoringWeights);
        return avg !== null ? sum + avg : sum;
      }, 0)
    : null;

  const renderSlotRow = (slot: SlotEntry, idx: number, list: SlotEntry[]) => {
    const avgFpts = slot.player && scoringWeights
      ? calculateAvgFantasyPoints(slot.player, scoringWeights)
      : null;

    return (
      <View
        key={`${slot.slotPosition}-${slot.slotIndex}`}
        style={[
          styles.slotRow,
          idx < list.length - 1 && {
            borderBottomColor: c.border,
            borderBottomWidth: StyleSheet.hairlineWidth,
          },
        ]}
      >
        <View style={[styles.slotLabel, { backgroundColor: slot.player ? c.activeCard : c.cardAlt }]}>
          <ThemedText
            style={[
              styles.slotLabelText,
              { color: slot.player ? c.activeText : c.secondaryText },
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
            accessibilityLabel={`${slot.player.name}, ${formatPosition(slot.player.position)}, ${slot.player.nba_team}${avgFpts !== null ? `, ${avgFpts.toFixed(1)} average fantasy points` : ''}`}
          >
            {/* Headshot with team pill */}
            <View style={styles.rosterPortraitWrap} accessible={false}>
              {(() => {
                const url = getPlayerHeadshotUrl(slot.player.external_id_nba);
                return (
                  <View
                    style={[
                      styles.rosterHeadshotCircle,
                      { borderColor: c.gold, backgroundColor: c.cardAlt },
                    ]}
                    accessible={false}
                  >
                    {url ? (
                      <Image
                        source={{ uri: url }}
                        style={styles.rosterHeadshotImg}
                        resizeMode="cover"
                        accessible={false}
                      />
                    ) : null}
                  </View>
                );
              })()}
              {(() => {
                const logoUrl = getTeamLogoUrl(slot.player.nba_team);
                return (
                  <View style={styles.rosterTeamPill}>
                    {logoUrl && (
                      <Image
                        source={{ uri: logoUrl }}
                        style={styles.rosterTeamPillLogo}
                        resizeMode="contain"
                      />
                    )}
                    <Text style={[styles.rosterTeamPillText, { color: c.statusText }]}>
                      {slot.player.nba_team}
                    </Text>
                  </View>
                );
              })()}
            </View>
            <View style={styles.slotPlayerInfo}>
              <View style={styles.nameRow}>
                <ThemedText type="defaultSemiBold" numberOfLines={1} style={styles.slotPlayerName}>
                  {slot.player.name}
                </ThemedText>
                {(() => {
                  const badge = getInjuryBadge(slot.player.status);
                  return badge ? (
                    <View
                      style={[styles.injuryBadge, { backgroundColor: badge.color }]}
                      accessibilityLabel={`${badge.label} injury status`}
                    >
                      <Text style={[styles.injuryText, { color: c.statusText }]}>{badge.label}</Text>
                    </View>
                  ) : null;
                })()}
              </View>
              <ThemedText style={[styles.slotPlayerSub, { color: c.secondaryText }]} numberOfLines={1}>
                {formatPosition(slot.player.position)} · {slot.player.nba_team}
              </ThemedText>
            </View>
            {avgFpts !== null && (
              <Text style={[styles.slotFpts, { color: c.accent }]}>
                {avgFpts.toFixed(1)}
              </Text>
            )}
          </TouchableOpacity>
        ) : (
          <View style={styles.slotPlayer}>
            <ThemedText style={[styles.emptySlotText, { color: c.secondaryText }]}>
              Empty
            </ThemedText>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.cardAlt }]}>
      <PageHeader
        title={teamName ?? 'Team Roster'}
        rightAction={
          !isOwnTeam && !isPastDeadline && myTeamId && leagueId ? (
            <TouchableOpacity
              onPress={() => setShowTradeModal(true)}
              style={[styles.headerTradeBtn, { backgroundColor: c.accent }]}
              accessibilityRole="button"
              accessibilityLabel={`Propose Trade with ${teamName}`}
            >
              <Text style={[styles.headerTradeBtnText, { color: c.accentText }]}>Trade</Text>
            </TouchableOpacity>
          ) : undefined
        }
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Starters */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <ThemedText type="subtitle" accessibilityRole="header">Starters</ThemedText>
            {starterTotal !== null && (
              <View style={[styles.totalBadge, { backgroundColor: c.activeCard, borderColor: c.activeBorder }]}>
                <ThemedText style={[styles.totalLabel, { color: c.secondaryText }]}>AVG FPTS</ThemedText>
                <ThemedText style={[styles.totalValue, { color: c.activeText }]}>
                  {starterTotal.toFixed(1)}
                </ThemedText>
              </View>
            )}
          </View>
          <View style={[styles.card, { backgroundColor: c.card }]}>
            {starterSlots.map((slot, idx) => renderSlotRow(slot, idx, starterSlots))}
          </View>
        </View>

        {/* Bench */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <ThemedText type="subtitle" accessibilityRole="header">Bench</ThemedText>
          </View>
          <View style={[styles.card, { backgroundColor: c.card }]}>
            {benchSlots.length > 0 ? (
              benchSlots.map((slot, idx) => renderSlotRow(slot, idx, benchSlots))
            ) : (
              <View style={styles.emptyBench}>
                <ThemedText style={[styles.emptySlotText, { color: c.secondaryText }]}>
                  No bench slots
                </ThemedText>
              </View>
            )}
          </View>
        </View>

        {/* IR */}
        {irSlots.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <ThemedText type="subtitle" accessibilityRole="header">Injured Reserve</ThemedText>
            </View>
            <View style={[styles.card, { backgroundColor: c.card }]}>
              {irSlots.map((slot, idx) => renderSlotRow(slot, idx, irSlots))}
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
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: s(20) },
  scrollContent: { paddingBottom: s(56) },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: s(8),
    paddingVertical: s(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: s(70), paddingHorizontal: s(8) },
  backText: { fontSize: ms(16), fontWeight: '500' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: ms(16) },
  headerSub: { fontSize: ms(11), marginTop: s(2) },
  section: { padding: s(16), paddingBottom: 0 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: s(8),
  },
  totalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: s(10),
    paddingVertical: s(4),
    borderRadius: 6,
    borderWidth: 1,
    gap: s(6),
  },
  totalLabel: { fontSize: ms(10), fontWeight: '600' },
  totalValue: { fontSize: ms(16), fontWeight: '700' },
  card: {
    borderRadius: 8,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: s(56),
  },
  slotLabel: {
    width: s(44),
    alignSelf: 'stretch',
    justifyContent: 'center',
    alignItems: 'center',
  },
  slotLabelText: { fontSize: ms(11), fontWeight: '700' },
  slotPlayer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(6),
    paddingHorizontal: s(12),
  },
  rosterPortraitWrap: {
    width: s(50),
    height: s(50),
    marginRight: s(8),
    alignItems: 'center',
  },
  rosterHeadshotCircle: {
    width: s(48),
    height: s(48),
    borderRadius: 25,
    borderWidth: 1.5,
    overflow: 'hidden' as const,
  },
  rosterHeadshotImg: {
    position: 'absolute' as const,
    bottom: s(-2),
    left: 0,
    right: 0,
    height: s(42),
  },
  rosterTeamPill: {
    position: 'absolute',
    bottom: s(-1),
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 8,
    paddingHorizontal: s(3),
    paddingVertical: 1,
    gap: s(2),
  },
  rosterTeamPillLogo: {
    width: s(9),
    height: s(9),
  },
  rosterTeamPillText: {
    fontSize: ms(7),
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  slotPlayerInfo: { flex: 1, marginRight: s(8) },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: s(6) },
  slotPlayerName: { fontSize: ms(14), flexShrink: 1 },
  injuryBadge: {
    paddingHorizontal: s(4),
    paddingVertical: 1,
    borderRadius: 3,
  },
  injuryText: {
    fontSize: ms(8),
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  slotPlayerSub: { fontSize: ms(11), marginTop: s(2) },
  slotFpts: { fontSize: ms(13), fontWeight: '600' },
  emptySlotText: { fontSize: ms(13), fontStyle: 'italic' },
  emptyBench: { padding: s(16), alignItems: 'center' },
  headerTradeBtn: {
    paddingHorizontal: s(10),
    paddingVertical: s(5),
    borderRadius: 6,
  },
  headerTradeBtnText: {
    fontSize: ms(12),
    fontWeight: '700',
  },
});
