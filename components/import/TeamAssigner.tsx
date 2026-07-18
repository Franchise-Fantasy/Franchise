import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { AppTextInput } from '@/components/ui/AppTextInput';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { queryKeys } from '@/constants/queryKeys';
import { useToast } from '@/context/ToastProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { ms, s } from '@/utils/scale';

interface TeamAssignerProps {
  leagueId: string;
}

interface ImportedTeam {
  id: string;
  name: string;
  user_id: string | null;
  sleeper_roster_id: number | null;
}

export function TeamAssigner({ leagueId }: TeamAssignerProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [assigning, setAssigning] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<ImportedTeam | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [sendingInvite, setSendingInvite] = useState(false);

  // Fetch teams with user_id and sleeper_roster_id
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.importedTeams(leagueId),
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
  // Members who joined the league (have a team with user_id set, no sleeper_roster_id = they created their own team via join)
  const availableMembers = allTeams.filter(t => t.user_id !== null && t.sleeper_roster_id === null);

  if (isLoading) return <View style={{ padding: 16 }}><LogoSpinner /></View>;
  if (unclaimedTeams.length === 0) return null;

  const handleAssign = async (importedTeam: ImportedTeam, memberTeam: ImportedTeam) => {
    setAssigning(true);
    try {
      // The member can't take over the imported roster by receiving its players
      // (they'd have no roster space), so instead the imported TEAM becomes
      // theirs and their empty placeholder team is retired.
      //
      // This was four writes with the error checked on only the first — so the
      // usual failure stamped the member's user_id on the imported team and then
      // silently failed to delete the placeholder, leaving the member owning TWO
      // teams while the UI reported success. Now one transaction.
      const { error } = await supabase.rpc('assign_imported_team', {
        p_league_id: leagueId,
        p_imported_team_id: importedTeam.id,
        p_member_team_id: memberTeam.id,
      });
      if (error) throw error;

      showToast('success', `${memberTeam.name} assigned to ${importedTeam.name}`);
      queryClient.invalidateQueries({ queryKey: queryKeys.importedTeams(leagueId) });
      queryClient.invalidateQueries({ queryKey: ['league'] });
      setSelectedTeam(null);
    } catch (err: any) {
      Alert.alert('Assignment failed', err.message);
    } finally {
      setAssigning(false);
    }
  };

  const closeModal = () => {
    setSelectedTeam(null);
    setInviteEmail('');
  };

  // Invite the owner by email. Phase 1: if they already have an account they get
  // a push that deep-links into the claim flow; if not, we tell the commissioner
  // to share the invite code (emailed download invites are Phase 2).
  const handleSendInvite = async () => {
    const email = inviteEmail.trim();
    if (!email || !selectedTeam) return;
    setSendingInvite(true);
    try {
      const { data: result, error } = await supabase.functions.invoke('send-league-invite', {
        body: { league_id: leagueId, team_id: selectedTeam.id, email },
      });
      if (error) {
        // Surface the edge function's specific message (already claimed, already
        // a member, etc.) rather than the generic non-2xx wrapper.
        let msg = error.message ?? 'Something went wrong.';
        try {
          const body = await error.context?.json?.();
          if (body?.error) msg = body.error;
        } catch {
          // fall through with the generic message
        }
        Alert.alert('Invite failed', msg);
        return;
      }
      if (result?.status === 'no_account') {
        Alert.alert(
          'No account found',
          `No Franchise account is registered to ${email}. Share your league invite code so they can sign up, then assign their team here. (Emailed invites are coming soon.)`,
        );
        return;
      }
      showToast('success', `Invite sent to ${email}`);
      closeModal();
    } catch (err: any) {
      Alert.alert('Invite failed', err.message ?? 'Something went wrong.');
    } finally {
      setSendingInvite(false);
    }
  };

  return (
    <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border, borderLeftWidth: 3, borderLeftColor: c.link }]}>
      <ThemedText type="defaultSemiBold" style={styles.sectionTitle} accessibilityRole="header">
        Assign Imported Teams
      </ThemedText>
      <ThemedText style={[styles.desc, { color: c.secondaryText }]}>
        {unclaimedTeams.length} imported team{unclaimedTeams.length !== 1 ? 's' : ''} need{unclaimedTeams.length === 1 ? 's' : ''} to be assigned to members.
        Have members join the league first, then assign them here.
      </ThemedText>

      {unclaimedTeams.map((team, idx) => (
        <TouchableOpacity
          key={team.id}
          style={[styles.teamRow, { borderBottomColor: c.border }, idx === unclaimedTeams.length - 1 && { borderBottomWidth: 0 }]}
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
        onRequestClose={closeModal}
      >
        <Pressable
          style={styles.backdrop}
          onPress={closeModal}
          accessibilityLabel="Close assign team"
        >
          <Pressable
            style={[styles.modal, { backgroundColor: c.background, borderColor: c.border }]}
            onPress={e => e.stopPropagation()}
            accessibilityViewIsModal
          >
            <ThemedText type="defaultSemiBold" style={styles.modalTitle} accessibilityRole="header">
              Assign "{selectedTeam?.name}" to:
            </ThemedText>

            {/* Invite by email — reaches the owner directly (push if they have an
                account, otherwise the commissioner shares the code). */}
            <ThemedText style={[styles.inviteLabel, { color: c.secondaryText }]}>
              INVITE BY EMAIL
            </ThemedText>
            <View style={styles.inviteRow}>
              <AppTextInput
                style={[styles.emailInput, { color: c.text, borderColor: c.border, backgroundColor: c.cardAlt }]}
                value={inviteEmail}
                onChangeText={setInviteEmail}
                placeholder="name@email.com"
                placeholderTextColor={c.secondaryText}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                editable={!sendingInvite}
                returnKeyType="send"
                onSubmitEditing={handleSendInvite}
                accessibilityLabel="Invitee email address"
              />
              <TouchableOpacity
                style={[
                  styles.sendBtn,
                  { backgroundColor: c.accent },
                  (!inviteEmail.trim() || sendingInvite) && { opacity: 0.5 },
                ]}
                onPress={handleSendInvite}
                disabled={!inviteEmail.trim() || sendingInvite}
                accessibilityRole="button"
                accessibilityLabel={`Send invite to ${selectedTeam?.name}`}
              >
                {sendingInvite ? (
                  <LogoSpinner size={16} />
                ) : (
                  <Text style={[styles.sendBtnText, { color: c.statusText }]}>Send</Text>
                )}
              </TouchableOpacity>
            </View>

            {availableMembers.length > 0 && (
              <>
                <ThemedText style={[styles.orDivider, { color: c.secondaryText }]}>
                  or pick a member who already joined
                </ThemedText>
                <ScrollView style={styles.memberList} bounces={false}>
                  {availableMembers.map((member, idx) => (
                    <TouchableOpacity
                      key={member.id}
                      style={[styles.memberRow, { borderBottomColor: c.border }, idx === availableMembers.length - 1 && { borderBottomWidth: 0 }]}
                      onPress={() => selectedTeam && handleAssign(selectedTeam, member)}
                      disabled={assigning}
                      accessibilityRole="button"
                      accessibilityLabel={`Assign to ${member.name}`}
                    >
                      <ThemedText style={styles.memberName}>{member.name}</ThemedText>
                      {assigning ? (
                        <LogoSpinner size={18} />
                      ) : (
                        <Ionicons name="arrow-forward-circle" size={22} color={c.accent} accessible={false} />
                      )}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}

            <TouchableOpacity
              onPress={closeModal}
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
    padding: s(16),
  },
  sectionTitle: {
    fontSize: ms(16),
    marginBottom: s(8),
  },
  desc: {
    fontSize: ms(13),
    lineHeight: ms(18),
    marginBottom: s(12),
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: s(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  teamInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    flex: 1,
  },
  teamName: {
    fontSize: ms(15),
    fontWeight: '500',
  },
  assignBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
  },
  assignText: {
    fontSize: ms(14),
    fontWeight: '600',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    paddingHorizontal: s(24),
  },
  modal: {
    borderRadius: 14,
    borderWidth: 1,
    padding: s(20),
    maxHeight: '60%',
  },
  modalTitle: {
    fontSize: ms(17),
    marginBottom: s(16),
  },
  inviteLabel: {
    fontSize: ms(11),
    letterSpacing: 1,
    fontWeight: '600',
    marginBottom: s(8),
  },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  emailInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: s(12),
    paddingVertical: s(10),
    fontSize: ms(14),
  },
  sendBtn: {
    paddingHorizontal: s(16),
    paddingVertical: s(11),
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: s(60),
  },
  sendBtnText: {
    fontSize: ms(14),
    fontWeight: '600',
  },
  orDivider: {
    fontSize: ms(12),
    fontWeight: '600',
    textAlign: 'center',
    marginTop: s(18),
    marginBottom: s(6),
  },
  memberList: {
    maxHeight: s(220),
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: s(14),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  memberName: {
    fontSize: ms(15),
    fontWeight: '500',
  },
  cancelBtn: {
    marginTop: s(16),
    paddingVertical: s(12),
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: ms(15),
    fontWeight: '600',
  },
});
