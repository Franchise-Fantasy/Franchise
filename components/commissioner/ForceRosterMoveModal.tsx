import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { queryKeys } from '@/constants/queryKeys';
import { useConfirm } from '@/context/ConfirmProvider';
import { useColors } from '@/hooks/useColors';
import { useLeagueRosterConfig } from '@/hooks/useLeagueRosterConfig';
import { supabase } from '@/lib/supabase';
import { PlayerSeasonStats } from '@/types/player';
import { getInjuryBadge } from '@/utils/nba/injuryBadge';
import { isEligibleForSlot, slotLabel } from '@/utils/roster/rosterSlots';
import { ms, s } from '@/utils/scale';

interface Props {
  visible: boolean;
  leagueId: string;
  teams: { id: string; name: string }[];
  onClose: () => void;
}

type Step = 'team' | 'player' | 'slot';

interface RosterPlayer extends PlayerSeasonStats {
  roster_slot: string;
}

export function ForceRosterMoveModal({ visible, leagueId, teams, onClose }: Props) {
  const c = useColors();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { data: rosterConfig } = useLeagueRosterConfig(leagueId);

  const [step, setStep] = useState<Step>('team');
  const [selectedTeam, setSelectedTeam] = useState<{ id: string; name: string } | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<RosterPlayer | null>(null);
  const [processing, setProcessing] = useState(false);

  function handleClose() {
    setStep('team');
    setSelectedTeam(null);
    setSelectedPlayer(null);
    onClose();
  }

  function goBack() {
    if (step === 'slot') { setStep('player'); setSelectedPlayer(null); }
    else if (step === 'player') { setStep('team'); setSelectedTeam(null); }
  }

  // Fetch team roster with slots
  const { data: roster, isLoading } = useQuery<RosterPlayer[]>({
    queryKey: queryKeys.commishRosterMove(selectedTeam?.id, leagueId),
    queryFn: async () => {
      const { data: lp, error: lpErr } = await supabase
        .from('league_players')
        .select('player_id, roster_slot, position')
        .eq('team_id', selectedTeam!.id)
        .eq('league_id', leagueId);
      if (lpErr) throw lpErr;
      if (!lp || lp.length === 0) return [];

      const ids = lp.map((p) => p.player_id);
      const { data, error } = await supabase
        .from('player_season_stats')
        .select('*')
        .in('player_id', ids);
      if (error) throw error;

      const slotMap = new Map(lp.map((p) => [p.player_id, p.roster_slot]));
      return (data ?? []).map((p: any) => ({
        ...p,
        roster_slot: slotMap.get(p.player_id) ?? 'BE',
      }));
    },
    enabled: !!selectedTeam && step !== 'team',
  });

  // Build all possible slot names from config (with numbered UTILs)
  const allSlotNames: string[] = [];
  if (rosterConfig) {
    for (const cfg of rosterConfig) {
      if (cfg.position === 'UTIL') {
        for (let i = 1; i <= cfg.slot_count; i++) allSlotNames.push(`UTIL${i}`);
      } else {
        allSlotNames.push(cfg.position);
      }
    }
  }

  const availableSlots = selectedPlayer
    ? allSlotNames.filter(
        (slot) => isEligibleForSlot(selectedPlayer.position, slot) && slot !== selectedPlayer.roster_slot
      )
    : [];

  async function handleMoveToSlot(targetSlot: string) {
    if (!selectedPlayer || !selectedTeam) return;
    confirm({
      title: 'Force Roster Move',
      message: `Move ${selectedPlayer.name} from ${slotLabel(selectedPlayer.roster_slot)} to ${slotLabel(targetSlot)}?`,
      action: {
        label: 'Confirm',
        onPress: async () => {
          setProcessing(true);
          try {
            const { error } = await supabase.functions.invoke('commissioner-action', {
              body: {
                action: 'force_move',
                league_id: leagueId,
                team_id: selectedTeam.id,
                player_id: selectedPlayer.player_id,
                target_slot: targetSlot,
              },
            });
            if (error) throw new Error(error.message);

            Alert.alert('Done', `${selectedPlayer.name} moved to ${slotLabel(targetSlot)}.`);
            queryClient.invalidateQueries({ queryKey: ['teamRoster'] });
            queryClient.invalidateQueries({ queryKey: ['transactions'] });
            queryClient.invalidateQueries({ queryKey: ['commishRosterMove'] });
            handleClose();
          } catch (e: any) {
            Alert.alert('Error', e.message);
          } finally {
            setProcessing(false);
          }
        },
      },
    });
  }

  const title =
    step === 'team'
      ? 'Select Team'
      : step === 'player'
        ? selectedTeam?.name ?? 'Roster'
        : selectedPlayer?.name ?? 'Move Player';

  const headerAction = step !== 'team' ? (
    <TouchableOpacity
      onPress={goBack}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel="Go back"
    >
      <Ionicons name="arrow-back" size={ms(22)} color={c.secondaryText} />
    </TouchableOpacity>
  ) : undefined;

  return (
    <BottomSheet
      visible={visible}
      onClose={handleClose}
      title={title}
      headerAction={headerAction}
      height="92%"
      scrollableBody={false}
    >
      {step === 'team' && (
        <FlatList
          data={teams}
          keyExtractor={(t) => t.id}
          renderItem={({ item, index }) => (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={item.name}
              style={[styles.row, { borderBottomColor: c.border }, index === teams.length - 1 && { borderBottomWidth: 0 }]}
              onPress={() => { setSelectedTeam(item); setStep('player'); }}
            >
              <ThemedText>{item.name}</ThemedText>
              <Ionicons name="chevron-forward" size={18} color={c.secondaryText} />
            </TouchableOpacity>
          )}
        />
      )}

      {step === 'player' && (
        <>
          {isLoading ? (
            <View style={{ marginTop: s(20) }}><LogoSpinner /></View>
          ) : !roster || roster.length === 0 ? (
            <ThemedText style={[styles.empty, { color: c.secondaryText }]}>No players on roster.</ThemedText>
          ) : (
            <FlatList
              data={roster}
              keyExtractor={(p) => p.player_id}
              renderItem={({ item, index }) => {
                const badge = getInjuryBadge(item.status);
                return (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`${item.name}, ${item.position}, current slot ${slotLabel(item.roster_slot)}`}
                    style={[styles.row, { borderBottomColor: c.border }, index === (roster ?? []).length - 1 && { borderBottomWidth: 0 }]}
                    onPress={() => { setSelectedPlayer(item); setStep('slot'); }}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: s(6) }}>
                        <ThemedText style={{ fontWeight: '600' }}>{item.name}</ThemedText>
                        {badge && (
                          <View style={[styles.badge, { backgroundColor: badge.color + '22' }]}>
                            <Text style={{ color: badge.color, fontSize: ms(10), fontWeight: '700' }}>{badge.label}</Text>
                          </View>
                        )}
                      </View>
                      <ThemedText style={[styles.sub, { color: c.secondaryText }]}>
                        {item.position} · {item.pro_team}
                      </ThemedText>
                    </View>
                    <View style={[styles.slotBadge, { backgroundColor: c.cardAlt }]}>
                      <ThemedText style={{ fontSize: ms(12), fontWeight: '600' }}>
                        {slotLabel(item.roster_slot)}
                      </ThemedText>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={c.secondaryText} style={{ marginLeft: s(8) }} />
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </>
      )}

      {step === 'slot' && (
        <>
          <ThemedText style={[styles.slotHeader, { color: c.secondaryText }]}>
            Current: {slotLabel(selectedPlayer?.roster_slot ?? '')}
          </ThemedText>
          {availableSlots.length === 0 ? (
            <ThemedText style={[styles.empty, { color: c.secondaryText }]}>
              No other eligible slots.
            </ThemedText>
          ) : (
            <FlatList
              data={availableSlots}
              keyExtractor={(slot) => slot}
              renderItem={({ item: slot, index }) => (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`Move to ${slotLabel(slot)}`}
                  style={[styles.row, { borderBottomColor: c.border }, index === availableSlots.length - 1 && { borderBottomWidth: 0 }]}
                  onPress={() => handleMoveToSlot(slot)}
                  disabled={processing}
                >
                  <ThemedText style={{ fontWeight: '600' }}>{slotLabel(slot)}</ThemedText>
                </TouchableOpacity>
              )}
            />
          )}
        </>
      )}

      {processing && (
        <View style={styles.processingOverlay}>
          <LogoSpinner />
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: s(12), borderBottomWidth: StyleSheet.hairlineWidth },
  sub: { fontSize: ms(12), marginTop: s(2) },
  badge: { paddingHorizontal: s(5), paddingVertical: s(1), borderRadius: 4 },
  slotBadge: { paddingHorizontal: s(8), paddingVertical: s(3), borderRadius: 6 },
  slotHeader: { fontSize: ms(13), marginBottom: s(12) },
  empty: { textAlign: 'center', marginTop: s(24), fontSize: ms(14) },
  processingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center' },
});
