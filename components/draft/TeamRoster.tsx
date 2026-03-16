import { supabase } from '@/lib/supabase';
import { PlayerSeasonStats } from '@/types/player';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ThemedText } from '../ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeagueRosterConfig } from '@/hooks/useLeagueRosterConfig';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { slotLabel } from '@/utils/rosterSlots';
import { formatPosition } from '@/utils/formatting';
import { getInjuryBadge } from '@/utils/injuryBadge';
import { getPlayerHeadshotUrl, getTeamLogoUrl } from '@/utils/playerHeadshot';
import { calculateAvgFantasyPoints } from '@/utils/fantasyPoints';
import { PlayerDetailModal } from '../player/PlayerDetailModal';
import { useState } from 'react';

interface TeamRosterProps {
  teamId: string;
  leagueId: string;
}

interface RosterPlayer extends PlayerSeasonStats {
  roster_slot: string | null;
}

interface SlotEntry {
  slotPosition: string;
  slotIndex: number;
  player: RosterPlayer | null;
}

export function TeamRoster({ teamId, leagueId }: TeamRosterProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const c = Colors[colorScheme];
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerSeasonStats | null>(null);

  const { data: scoringWeights } = useLeagueScoring(leagueId);
  const { data: rosterConfig, isLoading: isLoadingConfig } = useLeagueRosterConfig(leagueId);

  const { data: rosterPlayers, isLoading: isLoadingPlayers } = useQuery<RosterPlayer[]>({
    queryKey: ['teamRoster', teamId],
    queryFn: async () => {
      const { data: leaguePlayers, error: lpError } = await supabase
        .from('league_players')
        .select('player_id, roster_slot')
        .eq('team_id', teamId);

      if (lpError) throw lpError;
      if (!leaguePlayers || leaguePlayers.length === 0) return [];

      const playerIds = leaguePlayers.map(lp => lp.player_id);

      const { data: stats, error: statsError } = await supabase
        .from('player_season_stats')
        .select('*')
        .in('player_id', playerIds);

      if (statsError) throw statsError;

      const slotMap = new Map(leaguePlayers.map(lp => [lp.player_id, lp.roster_slot]));

      return (stats as PlayerSeasonStats[]).map(p => ({
        ...p,
        roster_slot: slotMap.get(p.player_id) ?? null,
      }));
    },
    enabled: !!teamId,
  });

  const isLoading = isLoadingConfig || isLoadingPlayers;

  // Build slot entries from roster config (mirrors roster page logic)
  const starterSlots: SlotEntry[] = [];
  const benchSlots: SlotEntry[] = [];
  const irSlots: SlotEntry[] = [];

  if (rosterConfig && rosterPlayers) {
    const benchConfig = rosterConfig.find(c => c.position === 'BE');
    const irConfig = rosterConfig.find(c => c.position === 'IR');
    const activeConfigs = rosterConfig.filter(c => c.position !== 'BE' && c.position !== 'IR');

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
          const player = rosterPlayers.find(p => p.roster_slot === numberedSlot) ?? null;
          starterSlots.push({ slotPosition: numberedSlot, slotIndex: i, player });
        }
      } else {
        const playersInSlot = rosterPlayers.filter(p => p.roster_slot === config.position);
        for (let i = 0; i < config.slot_count; i++) {
          starterSlots.push({
            slotPosition: config.position,
            slotIndex: i,
            player: playersInSlot[i] ?? null,
          });
        }
      }
    }

    const benchPlayers: RosterPlayer[] = [];
    for (const player of rosterPlayers) {
      if (player.roster_slot === 'IR') continue;
      if (!player.roster_slot || player.roster_slot === 'BE' || !validSlotNames.has(player.roster_slot)) {
        benchPlayers.push(player);
      }
    }

    const benchSlotCount = Math.max(benchConfig?.slot_count ?? 0, benchPlayers.length);
    for (let i = 0; i < benchSlotCount; i++) {
      benchSlots.push({
        slotPosition: 'BE',
        slotIndex: i,
        player: benchPlayers[i] ?? null,
      });
    }

    if (irConfig && irConfig.slot_count > 0) {
      const irPlayers = rosterPlayers.filter(p => p.roster_slot === 'IR');
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

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: c.cardAlt }]}>
        <ActivityIndicator style={styles.centered} />
      </View>
    );
  }

  // Build position fill summary
  const positionCounts: { label: string; filled: number; total: number }[] = [];
  if (rosterConfig && rosterPlayers) {
    const activeConfigs = rosterConfig.filter(cfg => cfg.position !== 'BE' && cfg.position !== 'IR');
    for (const config of activeConfigs) {
      if (config.position === 'UTIL') {
        const filled = starterSlots.filter(s => s.slotPosition.startsWith('UTIL') && s.player !== null).length;
        positionCounts.push({ label: 'UTIL', filled, total: config.slot_count });
      } else {
        const filled = starterSlots.filter(s => s.slotPosition === config.position && s.player !== null).length;
        positionCounts.push({ label: config.position, filled, total: config.slot_count });
      }
    }
  }

  if (!rosterPlayers || rosterPlayers.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: c.cardAlt }]}>
        <View style={styles.centered}>
          <ThemedText style={{ color: c.secondaryText }}>
            No players drafted yet.
          </ThemedText>
        </View>
      </View>
    );
  }

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
        <View
          style={[
            styles.slotLabel,
            { backgroundColor: slot.player ? c.activeCard : c.cardAlt },
          ]}
        >
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
            <View style={styles.portraitWrap}>
              {(() => {
                const url = getPlayerHeadshotUrl(slot.player.external_id_nba);
                return url ? (
                  <Image source={{ uri: url }} style={styles.headshot} resizeMode="cover" />
                ) : (
                  <View style={[styles.headshot, { backgroundColor: c.border }]} />
                );
              })()}
              {(() => {
                const logoUrl = getTeamLogoUrl(slot.player.nba_team);
                return (
                  <View style={styles.teamPill}>
                    {logoUrl && (
                      <Image source={{ uri: logoUrl }} style={styles.teamPillLogo} resizeMode="contain" />
                    )}
                    <Text style={styles.teamPillText}>{slot.player.nba_team}</Text>
                  </View>
                );
              })()}
            </View>
            <View style={styles.slotPlayerInfo}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap', flexShrink: 1 }}>
                <ThemedText type="defaultSemiBold" style={styles.slotPlayerName}>
                  {slot.player.name}
                </ThemedText>
                {(() => {
                  const badge = getInjuryBadge(slot.player.status);
                  return badge ? (
                    <View style={[styles.badge, { backgroundColor: badge.color }]}>
                      <Text style={styles.badgeText}>{badge.label}</Text>
                    </View>
                  ) : null;
                })()}
              </View>
              <ThemedText style={[styles.slotPlayerSub, { color: c.secondaryText }]} numberOfLines={1}>
                {formatPosition(slot.player.position)}
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
    <View style={[styles.container, { backgroundColor: c.cardAlt }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Position Fill Summary */}
        {positionCounts.length > 0 && (
          <View
            style={styles.positionSummary}
            accessibilityLabel={`Roster positions filled: ${positionCounts.map(p => `${p.label} ${p.filled} of ${p.total}`).join(', ')}`}
          >
            {positionCounts.map((p, i) => (
              <ThemedText key={p.label} style={[styles.positionSummaryText, { color: c.secondaryText }]}>
                {i > 0 ? '  |  ' : ''}{p.label} {p.filled}/{p.total}
              </ThemedText>
            ))}
          </View>
        )}

        {/* Starters */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <ThemedText type="subtitle">Starters</ThemedText>
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
      </ScrollView>

      <PlayerDetailModal
        player={selectedPlayer}
        leagueId={leagueId}
        teamId={teamId}
        onClose={() => setSelectedPlayer(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingBottom: 56 },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  positionSummary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  positionSummaryText: {
    fontSize: 11,
    fontWeight: '600',
  },
  section: { padding: 16, paddingBottom: 0 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
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
    minHeight: 56,
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
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  portraitWrap: {
    width: 44,
    height: 36,
    marginRight: 8,
  },
  headshot: {
    width: 44,
    height: 32,
    borderRadius: 4,
  },
  teamPill: {
    position: 'absolute',
    bottom: -1,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 8,
    paddingHorizontal: 3,
    paddingVertical: 1,
    gap: 2,
  },
  teamPillLogo: {
    width: 9,
    height: 9,
  },
  teamPillText: {
    color: '#fff',
    fontSize: 7,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  slotPlayerInfo: { flex: 1, marginRight: 8 },
  slotPlayerName: { fontSize: 14 },
  slotPlayerSub: { fontSize: 11, marginTop: 1 },
  slotFpts: { fontSize: 13, fontWeight: '600' },
  emptySlotText: { fontSize: 13, fontStyle: 'italic' },
  emptyBench: { padding: 16, alignItems: 'center' },
  badge: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  badgeText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
