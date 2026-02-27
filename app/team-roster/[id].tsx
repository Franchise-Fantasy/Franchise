import { PlayerDetailModal } from '@/components/player/PlayerDetailModal';
import { ProposeTradeModal } from '@/components/trade/ProposeTradeModal';
import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeagueRosterConfig, RosterConfigSlot } from '@/hooks/useLeagueRosterConfig';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { supabase } from '@/lib/supabase';
import { PlayerSeasonStats, ScoringWeight } from '@/types/player';
import { fetchLineupForDate } from '@/utils/dailyLineup';
import { calculateAvgFantasyPoints } from '@/utils/fantasyPoints';
import { formatPosition } from '@/utils/formatting';
import { slotLabel } from '@/utils/rosterSlots';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toDateStr(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
  const today = toDateStr(new Date());

  const { data: scoringWeights } = useLeagueScoring(leagueId ?? '');
  const { data: rosterConfig, isLoading: isLoadingConfig } = useLeagueRosterConfig(leagueId ?? '');

  // Fetch team name
  const { data: teamName } = useQuery({
    queryKey: ['teamName', viewTeamId],
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
    queryKey: ['viewTeamRoster', viewTeamId, today],
    queryFn: async () => {
      const { data: leaguePlayers, error: lpError } = await supabase
        .from('league_players')
        .select('player_id, roster_slot')
        .eq('team_id', viewTeamId!)
        .eq('league_id', leagueId!);

      if (lpError) throw lpError;
      if (!leaguePlayers || leaguePlayers.length === 0) return [];

      const playerIds = leaguePlayers.map((lp) => lp.player_id);

      const slotMap = await fetchLineupForDate(viewTeamId!, leagueId!, today);

      const { data: stats, error: statsError } = await supabase
        .from('player_season_stats')
        .select('*')
        .in('player_id', playerIds);

      if (statsError) throw statsError;

      return (stats as PlayerSeasonStats[]).map((p) => ({
        ...p,
        roster_slot: slotMap.get(p.player_id) ?? null,
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

    for (const config of activeConfigs) {
      if (config.position === 'UTIL') {
        for (let i = 0; i < config.slot_count; i++) {
          const numberedSlot = `UTIL${i + 1}`;
          const player = rosterPlayers.find((p) => p.roster_slot === numberedSlot) ?? null;
          slots.push({ slotPosition: numberedSlot, slotIndex: i, player });
        }
      } else {
        const playersInSlot = rosterPlayers.filter(
          (p) => p.roster_slot === config.position,
        );
        for (let i = 0; i < config.slot_count; i++) {
          slots.push({
            slotPosition: config.position,
            slotIndex: i,
            player: playersInSlot[i] ?? null,
          });
        }
      }
    }

    for (const player of rosterPlayers) {
      if (player.roster_slot === 'IR') continue;
      if (
        !player.roster_slot ||
        player.roster_slot === 'BE' ||
        !validSlotNames.has(player.roster_slot)
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
          >
            <View style={styles.slotPlayerInfo}>
              <ThemedText type="defaultSemiBold" numberOfLines={1} style={styles.slotPlayerName}>
                {slot.player.name}
              </ThemedText>
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
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={[styles.backText, { color: c.accent }]}>‹ Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <ThemedText type="defaultSemiBold" style={styles.headerTitle} numberOfLines={1}>
            {teamName ?? 'Team Roster'}
          </ThemedText>
          <ThemedText style={[styles.headerSub, { color: c.secondaryText }]}>
            Avg FPTS per game
          </ThemedText>
        </View>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Starters */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <ThemedText type="subtitle">Starters</ThemedText>
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
            <ThemedText type="subtitle">Bench</ThemedText>
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
              <ThemedText type="subtitle">Injured Reserve</ThemedText>
            </View>
            <View style={[styles.card, { backgroundColor: c.card }]}>
              {irSlots.map((slot, idx) => renderSlotRow(slot, idx, irSlots))}
            </View>
          </View>
        )}

        {/* Propose Trade button — only shown when viewing another team */}
        {!isOwnTeam && myTeamId && leagueId && (
          <View style={styles.section}>
            <TouchableOpacity
              style={[styles.tradeBtn, { backgroundColor: c.accent }]}
              onPress={() => setShowTradeModal(true)}
            >
              <Text style={[styles.tradeBtnText, { color: c.accentText }]}>
                Propose Trade with {teamName}
              </Text>
            </TouchableOpacity>
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
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  scrollContent: { paddingBottom: 56 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 70, paddingHorizontal: 8 },
  backText: { fontSize: 16, fontWeight: '500' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 16 },
  headerSub: { fontSize: 11, marginTop: 2 },
  section: { padding: 16, paddingBottom: 0 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  totalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    gap: 6,
  },
  totalLabel: { fontSize: 10, fontWeight: '600' },
  totalValue: { fontSize: 16, fontWeight: '700' },
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
    minHeight: 52,
  },
  slotLabel: {
    width: 44,
    alignSelf: 'stretch',
    justifyContent: 'center',
    alignItems: 'center',
  },
  slotLabelText: { fontSize: 11, fontWeight: '700' },
  slotPlayer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  slotPlayerInfo: { flex: 1, marginRight: 8 },
  slotPlayerName: { fontSize: 14 },
  slotPlayerSub: { fontSize: 11, marginTop: 2 },
  slotFpts: { fontSize: 13, fontWeight: '600' },
  emptySlotText: { fontSize: 13, fontStyle: 'italic' },
  emptyBench: { padding: 16, alignItems: 'center' },
  tradeBtn: {
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 16,
  },
  tradeBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
});
