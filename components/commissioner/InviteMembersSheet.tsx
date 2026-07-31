import { useState } from 'react';
import { Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { InviteEmailField } from '@/components/commissioner/InviteEmailField';
import { SentInvitesList } from '@/components/commissioner/SentInvitesList';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import { useLeagueInvites } from '@/hooks/invites/useLeagueInvites';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

export interface SheetTeam {
  id: string;
  name: string;
  user_id: string | null;
}

interface Props {
  leagueId: string;
  /** Shown as the fallback for invitees who don't have an account yet. */
  inviteCode: string | null;
  /** Every team in the league. Ownerless ones become the reservation targets. */
  teams: SheetTeam[];
  /** `current_teams >= teams`. An open invite has nowhere to land when full. */
  leagueFull: boolean;
  visible: boolean;
  onClose: () => void;
}

/**
 * Commissioner surface to invite members by email. Invokes the generalized
 * send-league-invite edge fn, which persists an `invitations` record the
 * invitee's home card reads and fires a best-effort push. The persisted record
 * is what makes the invite survive a missed push. Also embeds the sent-invites
 * list (resend / cancel).
 *
 * Handing an existing team to a new owner runs through here too — pick the team
 * and the invite reserves it, replacing the old TransferOwnershipModal. That
 * modal wrote `teams.user_id` straight from an RPC: no acceptance, no
 * notification, and no guard against overwriting a team someone already owned.
 * To reassign a team that still has an owner, remove the member first (which
 * vacates the team) and then invite into it.
 */
export function InviteMembersSheet({
  leagueId,
  inviteCode,
  teams,
  leagueFull,
  visible,
  onClose,
}: Props) {
  const c = useColors();
  // Same query key as the embedded SentInvitesList, so React Query serves both
  // from one fetch.
  const { invites } = useLeagueInvites(leagueId, visible);

  // `undefined` means the picker is untouched and takes the default below;
  // `null` means the commissioner explicitly chose an open invite.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);

  // A pending invite already holds its team. Offering it again would send two
  // people to the same roster to race for it, and the loser would just get
  // "Team is already claimed" with no explanation.
  const reservedTeamIds = new Set(
    invites.filter((i) => i.status === 'pending' && i.team_id).map((i) => i.team_id as string),
  );
  const unclaimed = teams.filter((t) => !t.user_id);
  const teamNames = Object.fromEntries(teams.map((t) => [t.id, t.name]));

  // A full league can only absorb someone through an unclaimed team, so default
  // there rather than to an open invite the edge fn would reject as "League is full".
  const teamId = picked === undefined
    ? (leagueFull ? unclaimed.find((t) => !reservedTeamIds.has(t.id))?.id ?? null : null)
    : picked;

  // A team claimed or reserved since the sheet opened drops out here, which
  // falls the selection back to an open invite rather than sending a stale id.
  const selectedTeam = unclaimed.find((t) => t.id === teamId && !reservedTeamIds.has(t.id)) ?? null;

  const handleClose = () => {
    setPicked(undefined);
    onClose();
  };

  const handleShareCode = async () => {
    if (!inviteCode) return;
    await Share.share({
      message: `Join my league on Franchise! Use invite code: ${inviteCode}\n\nOr tap to join: franchisev2://join?code=${inviteCode}`,
    });
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={handleClose}
      title="Invite Members"
      subtitle="INVITE BY EMAIL"
      keyboardAvoiding
    >
      {unclaimed.length > 0 && (
        <>
          <ThemedText style={[styles.listHeader, styles.firstHeader, { color: c.secondaryText }]} accessibilityRole="header">
            INVITE TO
          </ThemedText>
          <View style={styles.chipRow} accessibilityRole="radiogroup">
            {!leagueFull && (
              <TeamChip
                label="New team"
                selected={teamId === null}
                onPress={() => setPicked(null)}
              />
            )}
            {unclaimed.map((t) => (
              <TeamChip
                key={t.id}
                label={t.name}
                selected={teamId === t.id}
                reserved={reservedTeamIds.has(t.id)}
                onPress={() => setPicked(t.id)}
              />
            ))}
          </View>
        </>
      )}

      <ThemedText style={[styles.desc, { color: c.secondaryText }]}>
        {selectedTeam
          ? `They'll get a notification and an invite card, and take over ${selectedTeam.name} once they accept.`
          : `Anyone with a Franchise account gets a notification and an invite card on their home screen.`}
      </ThemedText>

      <InviteEmailField
        leagueId={leagueId}
        teamId={selectedTeam?.id}
        targetLabel={selectedTeam?.name}
      />

      {/* The no-account path tells the commissioner to share their code, so it
          has to be reachable from this sheet rather than another screen. */}
      {inviteCode && (
        <>
          <ThemedText style={[styles.listHeader, { color: c.secondaryText }]} accessibilityRole="header">
            NO ACCOUNT YET?
          </ThemedText>
          <ThemedText style={[styles.desc, { color: c.secondaryText }]}>
            Share your league code — they can join once they sign up.
          </ThemedText>
          <TouchableOpacity
            style={[styles.codeRow, { borderColor: c.border, backgroundColor: c.cardAlt }]}
            onPress={handleShareCode}
            accessibilityRole="button"
            accessibilityLabel={`Share invite code ${inviteCode.split('').join(' ')}`}
          >
            <Text style={[styles.codeText, { color: c.text }]}>{inviteCode}</Text>
            <Text style={[styles.shareText, { color: c.accent }]}>Share</Text>
          </TouchableOpacity>
        </>
      )}

      <ThemedText style={[styles.listHeader, { color: c.secondaryText }]} accessibilityRole="header">
        SENT INVITES
      </ThemedText>
      <SentInvitesList leagueId={leagueId} teamNames={teamNames} />
    </BottomSheet>
  );
}

function TeamChip({
  label,
  selected,
  reserved,
  onPress,
}: {
  label: string;
  selected: boolean;
  reserved?: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <TouchableOpacity
      style={[
        styles.chip,
        {
          borderColor: selected ? c.accent : c.border,
          backgroundColor: selected ? c.activeCard : c.cardAlt,
        },
        reserved && styles.chipReserved,
      ]}
      onPress={onPress}
      disabled={reserved}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled: !!reserved }}
      accessibilityLabel={reserved ? `${label} — already reserved for a pending invite` : `Invite to ${label}`}
    >
      <Text style={[styles.chipText, { color: selected ? c.accent : c.text }]} numberOfLines={1}>
        {reserved ? `${label} · invited` : label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  desc: {
    fontSize: ms(13),
    lineHeight: ms(18),
    marginBottom: s(10),
  },
  listHeader: {
    fontSize: ms(11),
    letterSpacing: 1,
    fontWeight: '600',
    marginTop: s(16),
    marginBottom: s(4),
  },
  firstHeader: {
    marginTop: 0,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(6),
    marginBottom: s(10),
  },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: s(12),
    paddingVertical: s(7),
    maxWidth: '100%',
    minHeight: s(32),
    justifyContent: 'center',
  },
  chipReserved: {
    opacity: 0.45,
  },
  chipText: {
    fontSize: ms(13),
    fontWeight: '600',
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: s(14),
    paddingVertical: s(12),
    minHeight: s(44),
  },
  codeText: {
    fontSize: ms(17),
    // 'monospace' is an Android-only family name — on iOS it silently falls back
    // to the system face and the code loses its even, glyph-per-cell rhythm.
    fontFamily: Fonts.mono,
    letterSpacing: 3,
  },
  shareText: {
    fontSize: ms(14),
    fontWeight: '600',
  },
});
