import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { useToast } from '@/context/ToastProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

interface TeamAssignerProps {
  leagueId: string;
}

interface ImportedTeam {
  id: string;
  name: string;
  user_id: string | null;
  sleeper_roster_id: number | null;
}

interface LeagueMember {
  id: string;
  name: string;
  user_id: string;
}

export function TeamAssigner({ leagueId }: TeamAssignerProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [assigning, setAssigning] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<ImportedTeam | null>(null);

  // Fetch teams with user_id and sleeper_roster_id
  const { data, isLoading } = useQuery({
    queryKey: ['imported-teams', leagueId],
    queryFn: async () => {
      const { data: teams, error } = await supabase
        .from('teams')
        .select('id, name, user_id, sleeper_roster_id')
        .eq('league_id', leagueId)
        .order('name');

      if (error) throw error;
      return teams as ImportedTeam[];
    },
    enabled: !!leagueId,
  });

  const allTeams = data ?? [];
  const unclaimedTeams = allTeams.filter(t => t.sleeper_roster_id !== null && t.user_id === null);
  const claimedTeams = allTeams.filter(t => t.user_id !== null);
  // Members who joined the league (have a team with user_id set, no sleeper_roster_id = they created their own team via join)
  const availableMembers = allTeams.filter(t => t.user_id !== null && t.sleeper_roster_id === null);

  if (isLoading) return <ActivityIndicator style={{ padding: 16 }} />;
  if (unclaimedTeams.length === 0) return null;

  const handleAssign = async (importedTeam: ImportedTeam, memberTeam: ImportedTeam) => {
    setAssigning(true);
    try {
      // Transfer all league_players from imported team to the member's newly created team won't work
      // because the member doesn't have roster space. Instead, we assign the imported team to the member.
      // Set the user_id on the imported team and delete the member's empty team.

      // 1. Set user_id on the imported team
      const { error: updateError } = await supabase
        .from('teams')
        .update({ user_id: memberTeam.user_id })
        .eq('id', importedTeam.id);

      if (updateError) throw updateError;

      // 2. Transfer waiver_priority if exists
      await supabase
        .from('waiver_priority')
        .update({ team_id: importedTeam.id })
        .eq('team_id', memberTeam.id)
        .eq('league_id', leagueId);

      // 3. Delete the member's empty placeholder team
      await supabase
        .from('teams')
        .delete()
        .eq('id', memberTeam.id);

      // 4. Decrement current_teams since we merged two teams into one
      // Actually we're just reassigning, count should stay the same
      // The member joined (current_teams++), and now we're deleting their empty team (current_teams--)
      // Net effect: imported team gets their user_id
      await supabase.rpc('increment_team_count', {
        league_id_input: leagueId,
        increment_by: -1,
      });

      // 5. Clear sleeper_roster_id since assignment is done
      await supabase
        .from('teams')
        .update({ sleeper_roster_id: null })
        .eq('id', importedTeam.id);

      showToast('success', `${memberTeam.name} assigned to ${importedTeam.name}`);
      queryClient.invalidateQueries({ queryKey: ['imported-teams', leagueId] });
      queryClient.invalidateQueries({ queryKey: ['league'] });
      setSelectedTeam(null);
    } catch (err: any) {
      Alert.alert('Assignment failed', err.message);
    } finally {
      setAssigning(false);
    }
  };

  return (
    <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border, borderLeftWidth: 3, borderLeftColor: '#007AFF' }]}>
      <ThemedText type="defaultSemiBold" style={styles.sectionTitle} accessibilityRole="header">
        Assign Imported Teams
      </ThemedText>
      <ThemedText style={[styles.desc, { color: c.secondaryText }]}>
        {unclaimedTeams.length} imported team{unclaimedTeams.length !== 1 ? 's' : ''} need{unclaimedTeams.length === 1 ? 's' : ''} to be assigned to members.
        Have members join the league first, then assign them here.
      </ThemedText>

      {unclaimedTeams.map((team) => (
        <TouchableOpacity
          key={team.id}
          style={[styles.teamRow, { borderBottomColor: c.border }]}
          onPress={() => setSelectedTeam(team)}
          disabled={availableMembers.length === 0}
          accessibilityRole="button"
          accessibilityLabel={`Assign ${team.name}`}
          accessibilityState={{ disabled: availableMembers.length === 0 }}
        >
          <View style={styles.teamInfo}>
            <Ionicons name="person-circle-outline" size={22} color={c.secondaryText} accessible={false} />
            <ThemedText style={styles.teamName}>{team.name}</ThemedText>
          </View>
          <View style={styles.assignBadge}>
            <Text style={[styles.assignText, { color: c.accent }]}>
              {availableMembers.length > 0 ? 'Assign' : 'No members'}
            </Text>
            {availableMembers.length > 0 && (
              <Ionicons name="chevron-forward" size={16} color={c.accent} accessible={false} />
            )}
          </View>
        </TouchableOpacity>
      ))}

      {/* Member picker modal */}
      <Modal
        visible={selectedTeam !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedTeam(null)}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => setSelectedTeam(null)}
          accessibilityLabel="Close member picker"
        >
          <Pressable
            style={[styles.modal, { backgroundColor: c.background, borderColor: c.border }]}
            onPress={e => e.stopPropagation()}
            accessibilityViewIsModal
          >
            <ThemedText type="defaultSemiBold" style={styles.modalTitle} accessibilityRole="header">
              Assign "{selectedTeam?.name}" to:
            </ThemedText>

            {availableMembers.length === 0 ? (
              <ThemedText style={[styles.emptyText, { color: c.secondaryText }]}>
                No unassigned members. Have more people join the league first.
              </ThemedText>
            ) : (
              <ScrollView style={styles.memberList} bounces={false}>
                {availableMembers.map((member) => (
                  <TouchableOpacity
                    key={member.id}
                    style={[styles.memberRow, { borderBottomColor: c.border }]}
                    onPress={() => selectedTeam && handleAssign(selectedTeam, member)}
                    disabled={assigning}
                    accessibilityRole="button"
                    accessibilityLabel={`Assign to ${member.name}`}
                  >
                    <ThemedText style={styles.memberName}>{member.name}</ThemedText>
                    {assigning ? (
                      <ActivityIndicator size="small" />
                    ) : (
                      <Ionicons name="arrow-forward-circle" size={22} color={c.accent} accessible={false} />
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            <TouchableOpacity
              onPress={() => setSelectedTeam(null)}
              style={[styles.cancelBtn, { borderColor: c.border }]}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={[styles.cancelText, { color: c.text }]}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 16,
    marginBottom: 8,
  },
  desc: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  teamInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  teamName: {
    fontSize: 15,
    fontWeight: '500',
  },
  assignBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  assignText: {
    fontSize: 14,
    fontWeight: '600',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modal: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 20,
    maxHeight: '60%',
  },
  modalTitle: {
    fontSize: 17,
    marginBottom: 16,
  },
  emptyText: {
    textAlign: 'center',
    paddingVertical: 20,
    fontSize: 14,
  },
  memberList: {
    maxHeight: 300,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  memberName: {
    fontSize: 15,
    fontWeight: '500',
  },
  cancelBtn: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
