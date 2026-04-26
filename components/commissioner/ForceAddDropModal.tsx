import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { BrandButton } from '@/components/ui/BrandButton';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { queryKeys } from '@/constants/queryKeys';
import { useConfirm } from '@/context/ConfirmProvider';
import { useActiveLeagueSport } from '@/hooks/useActiveLeagueSport';
import { useColors } from '@/hooks/useColors';
import { supabase } from '@/lib/supabase';
import { PlayerSeasonStats } from '@/types/player';
import { getInjuryBadge } from '@/utils/nba/injuryBadge';
import { ms, s } from '@/utils/scale';

interface Props {
  visible: boolean;
  leagueId: string;
  teams: { id: string; name: string }[];
  onClose: () => void;
}

type Step = 'team' | 'action' | 'player';

export function ForceAddDropModal({ visible, leagueId, teams, onClose }: Props) {
  const c = useColors();
  const confirm = useConfirm();
  const sport = useActiveLeagueSport(leagueId);
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>('team');
  const [selectedTeam, setSelectedTeam] = useState<{ id: string; name: string } | null>(null);
  const [action, setAction] = useState<'add' | 'drop' | null>(null);
  const [search, setSearch] = useState('');
  const [processing, setProcessing] = useState(false);

  function handleClose() {
    setStep('team');
    setSelectedTeam(null);
    setAction(null);
    setSearch('');
    onClose();
  }

  function goBack() {
    if (step === 'player') { setStep('action'); setSearch(''); }
    else if (step === 'action') { setStep('team'); setSelectedTeam(null); }
  }

  const { data: teamRoster, isLoading: rosterLoading } = useQuery<
    (PlayerSeasonStats & { roster_slot: string })[]
  >({
    queryKey: queryKeys.commishTeamRoster(selectedTeam?.id, leagueId),
    queryFn: async () => {
      const { data: lp, error: lpErr } = await supabase
        .from('league_players')
        .select('player_id, roster_slot')
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
      return (data ?? []).map((p: any) => ({ ...p, roster_slot: slotMap.get(p.player_id) ?? 'BE' }));
    },
    enabled: !!selectedTeam && action === 'drop' && step === 'player',
  });

  // Fetch free agents (for add). `pro_team IS NOT NULL` works year-round;
  // `games_played > 0` would hide everyone during the offseason.
  const { data: freeAgents, isLoading: faLoading } = useQuery<PlayerSeasonStats[]>({
    queryKey: [...queryKeys.commishFreeAgents(leagueId), sport],
    queryFn: async () => {
      const { data: rostered } = await supabase
        .from('league_players')
        .select('player_id')
        .eq('league_id', leagueId);
      const rosteredIds = (rostered ?? []).map((p) => p.player_id);

      let query = supabase
        .from('player_season_stats')
        .select('*')
        .eq('sport', sport)
        .not('pro_team', 'is', null)
        .order('avg_pts', { ascending: false });

      if (rosteredIds.length > 0) {
        query = query.not('player_id', 'in', `(${rosteredIds.join(',')})`);
      }

      const { data, error } = await query.limit(200);
      if (error) throw error;
      return (data ?? []) as PlayerSeasonStats[];
    },
    enabled: action === 'add' && step === 'player',
  });

  function handleSelectPlayer(player: PlayerSeasonStats) {
    const verb = action === 'add' ? 'add' : 'drop';
    const preposition = action === 'add' ? 'to' : 'from';
    confirm({
      title: `Force ${verb.charAt(0).toUpperCase() + verb.slice(1)}`,
      message: `${verb === 'add' ? 'Add' : 'Drop'} ${player.name} ${preposition} ${selectedTeam!.name}?`,
      action: {
        label: 'Confirm',
        destructive: true,
        onPress: () => executeAction(player),
      },
    });
  }

  async function executeAction(player: PlayerSeasonStats) {
    setProcessing(true);
    try {
      const body: any = {
        action: action === 'add' ? 'force_add' : 'force_drop',
        league_id: leagueId,
        team_id: selectedTeam!.id,
        player_id: player.player_id,
      };
      if (action === 'add') body.position = player.position;

      const { error } = await supabase.functions.invoke('commissioner-action', { body });
      if (error) throw new Error(error.message);

      Alert.alert('Done', `${player.name} ${action === 'add' ? 'added to' : 'dropped from'} ${selectedTeam!.name}.`);
      queryClient.invalidateQueries({ queryKey: ['allPlayers'] });
      queryClient.invalidateQueries({ queryKey: ['teamRoster'] });
      queryClient.invalidateQueries({ queryKey: ['rosterInfo'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['commishTeamRoster'] });
      queryClient.invalidateQueries({ queryKey: ['commishFreeAgents'] });
      handleClose();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setProcessing(false);
    }
  }

  const playerList = action === 'add' ? freeAgents : teamRoster;
  const loading = action === 'add' ? faLoading : rosterLoading;
  const filtered = (playerList ?? []).filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  const title =
    step === 'team'
      ? 'Select Team'
      : step === 'action'
        ? selectedTeam?.name ?? 'Action'
        : `${action === 'add' ? 'Add' : 'Drop'} Player`;

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
              onPress={() => { setSelectedTeam(item); setStep('action'); }}
            >
              <ThemedText>{item.name}</ThemedText>
              <Ionicons name="chevron-forward" size={18} color={c.secondaryText} />
            </TouchableOpacity>
          )}
        />
      )}

      {step === 'action' && (
        <View style={styles.actionButtons}>
          <BrandButton
            label="Add Player"
            variant="primary"
            size="large"
            icon="person-add"
            onPress={() => { setAction('add'); setStep('player'); }}
            fullWidth
          />
          <BrandButton
            label="Drop Player"
            variant="secondary"
            size="large"
            icon="person-remove"
            onPress={() => { setAction('drop'); setStep('player'); }}
            fullWidth
          />
        </View>
      )}

      {step === 'player' && (
        <>
          <TextInput
            accessibilityLabel="Search players"
            style={[styles.searchInput, { backgroundColor: c.cardAlt, color: c.text, borderColor: c.border }]}
            placeholder="Search players..."
            placeholderTextColor={c.secondaryText}
            value={search}
            onChangeText={setSearch}
          />
          {loading ? (
            <View style={{ marginTop: s(20) }}><LogoSpinner /></View>
          ) : filtered.length === 0 ? (
            <ThemedText style={[styles.empty, { color: c.secondaryText }]}>No players found.</ThemedText>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(p) => p.player_id}
              renderItem={({ item, index }) => {
                const badge = getInjuryBadge(item.status);
                return (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`${item.name}, ${item.position}, ${item.pro_team}`}
                    style={[styles.row, { borderBottomColor: c.border }, index === filtered.length - 1 && { borderBottomWidth: 0 }]}
                    onPress={() => handleSelectPlayer(item)}
                    disabled={processing}
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
                        {action === 'drop' && (item as any).roster_slot ? ` · ${(item as any).roster_slot}` : ''}
                      </ThemedText>
                    </View>
                    <ThemedText style={[styles.stat, { color: c.secondaryText }]}>
                      {(item as any).avg_pts?.toFixed(1) ?? '—'}
                    </ThemedText>
                  </TouchableOpacity>
                );
              }}
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
  actionButtons: { gap: s(12), marginTop: s(12) },
  searchInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: s(12), paddingVertical: s(10), fontSize: ms(14), marginBottom: s(8) },
  sub: { fontSize: ms(12), marginTop: s(2) },
  stat: { fontSize: ms(14), fontWeight: '500', marginLeft: s(8) },
  badge: { paddingHorizontal: s(5), paddingVertical: 1, borderRadius: 4 },
  empty: { textAlign: 'center', marginTop: s(24), fontSize: ms(14) },
  processingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center' },
});
