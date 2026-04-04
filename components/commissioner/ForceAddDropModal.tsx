import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { queryKeys } from '@/constants/queryKeys';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { ms, s } from '@/utils/scale';
import { PlayerSeasonStats } from '@/types/player';
import { getInjuryBadge } from '@/utils/injuryBadge';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

interface Props {
  visible: boolean;
  leagueId: string;
  teams: Array<{ id: string; name: string }>;
  onClose: () => void;
}

type Step = 'team' | 'action' | 'player';

export function ForceAddDropModal({ visible, leagueId, teams, onClose }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
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
    else handleClose();
  }

  // Fetch team roster (for drop)
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

  // Fetch free agents (for add)
  const { data: freeAgents, isLoading: faLoading } = useQuery<PlayerSeasonStats[]>({
    queryKey: queryKeys.commishFreeAgents(leagueId),
    queryFn: async () => {
      const { data: rostered } = await supabase
        .from('league_players')
        .select('player_id')
        .eq('league_id', leagueId);
      const rosteredIds = (rostered ?? []).map((p) => p.player_id);

      let query = supabase
        .from('player_season_stats')
        .select('*')
        .gt('games_played', 0)
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
    Alert.alert(
      `Force ${verb.charAt(0).toUpperCase() + verb.slice(1)}`,
      `${verb === 'add' ? 'Add' : 'Drop'} ${player.name} ${preposition} ${selectedTeam!.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          style: 'destructive',
          onPress: () => executeAction(player),
        },
      ]
    );
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

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={[styles.content, { backgroundColor: c.card }]} accessibilityViewIsModal={true}>
          <View style={styles.header}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={step === 'team' ? 'Close' : 'Go back'} onPress={goBack}>
              <Ionicons name={step === 'team' ? 'close' : 'arrow-back'} size={24} color={c.text} />
            </TouchableOpacity>
            <ThemedText accessibilityRole="header" type="subtitle">
              {step === 'team' ? 'Select Team' : step === 'action' ? selectedTeam?.name : `${action === 'add' ? 'Add' : 'Drop'} Player`}
            </ThemedText>
            <View style={{ width: s(24) }} />
          </View>

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
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Add player"
                style={[styles.actionBtn, { backgroundColor: c.accent }]}
                onPress={() => { setAction('add'); setStep('player'); }}
              >
                <Ionicons name="person-add" size={20} color={c.accentText} />
                <Text style={{ color: c.accentText, fontWeight: '600', marginLeft: s(8) }}>Add Player</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Drop player"
                style={[styles.actionBtn, { backgroundColor: c.danger }]}
                onPress={() => { setAction('drop'); setStep('player'); }}
              >
                <Ionicons name="person-remove" size={20} color={c.statusText} />
                <Text style={{ color: c.statusText, fontWeight: '600', marginLeft: s(8) }}>Drop Player</Text>
              </TouchableOpacity>
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
                <ActivityIndicator style={{ marginTop: s(20) }} />
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
                        accessibilityLabel={`${item.name}, ${item.position}, ${item.nba_team}`}
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
                            {item.position} · {item.nba_team}
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
              <ActivityIndicator size="large" />
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  content: { borderTopLeftRadius: 14, borderTopRightRadius: 14, padding: s(20), paddingBottom: s(32), minHeight: '60%', maxHeight: '92%', overflow: 'hidden' as const },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: s(16) },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: s(12), borderBottomWidth: StyleSheet.hairlineWidth },
  actionButtons: { gap: s(12), marginTop: s(12) },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: s(14), borderRadius: 10 },
  searchInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: s(12), paddingVertical: s(10), fontSize: ms(14), marginBottom: s(8) },
  sub: { fontSize: ms(12), marginTop: s(2) },
  stat: { fontSize: ms(14), fontWeight: '500', marginLeft: s(8) },
  badge: { paddingHorizontal: s(5), paddingVertical: 1, borderRadius: 4 },
  empty: { textAlign: 'center', marginTop: s(24), fontSize: ms(14) },
  processingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center', borderRadius: 16 },
});
