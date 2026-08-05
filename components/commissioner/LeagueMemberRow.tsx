import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, StyleSheet, TouchableOpacity, View } from 'react-native';

import { TeamLogo } from '@/components/team/TeamLogo';
import { Badge } from '@/components/ui/Badge';
import { ListRow } from '@/components/ui/ListRow';
import { ThemedText } from '@/components/ui/ThemedText';
import { useTextPrompt } from '@/context/ConfirmProvider';
import { useColors } from '@/hooks/useColors';
import { supabase } from '@/lib/supabase';
import { ms, s } from '@/utils/scale';

export type LeagueMember = {
  id: string;
  name: string;
  tricode?: string | null;
  is_commissioner?: boolean | null;
  logo_key?: string | null;
  user_id?: string | null;
  league_players?: { count: number }[] | null;
};

type Props = {
  team: LeagueMember;
  /** The signed-in user's own team — unlocks the inline name/tricode edits. */
  isMine: boolean;
  /**
   * Viewer is the commissioner of an IMPORTED league — unlocks the roster
   * import. A league built in-app fills its rosters by drafting, so an empty
   * team there is the normal pre-draft state, not something to import into.
   */
  canImportRoster: boolean;
  index: number;
  total: number;
  onImportRoster: (team: { id: string; name: string }) => void;
};

/** Meta line under the team name: roster size, plus ownership when vacant. */
function memberStatus(playerCount: number, isUnclaimed: boolean): string {
  const roster = playerCount === 1 ? '1 player' : `${playerCount} players`;
  return isUnclaimed ? `Unclaimed · ${roster}` : roster;
}

/**
 * One member of the league, as a two-line team-sheet entry: the name owns
 * the first line on its own (truncating, so it can never collide with the
 * Commish badge), and the tricode drops to a quiet mono meta line beside
 * the roster size — which is also where it stops repeating the initials
 * already shown in the logo next to it. In an imported league an empty roster
 * gets the import action as a trailing chip rather than a fourth thing
 * competing for the same line.
 */
export function LeagueMemberRow({
  team,
  isMine,
  canImportRoster,
  index,
  total,
  onImportRoster,
}: Props) {
  const c = useColors();
  const promptInput = useTextPrompt();
  const queryClient = useQueryClient();

  const playerCount = team.league_players?.[0]?.count ?? 0;

  const editName = () => {
    promptInput({
      title: 'Edit Team Name',
      message: 'Enter your new team name',
      defaultValue: team.name ?? '',
      maxLength: 30,
      action: {
        label: 'Save',
        onSubmit: async (value) => {
          const name = value.trim();
          if (!name) return;
          if (name.length > 30) { Alert.alert('Too long', 'Team name must be 30 characters or fewer.'); return; }
          const { error } = await supabase.from('teams').update({ name }).eq('id', team.id);
          if (error) { Alert.alert('Error', error.message); return; }
          queryClient.invalidateQueries({ queryKey: ['league'] });
        },
      },
    });
  };

  const editTricode = () => {
    promptInput({
      title: 'Edit Tricode',
      message: '2-3 characters (letters/numbers)',
      defaultValue: team.tricode ?? '',
      maxLength: 3,
      autoCapitalize: 'characters',
      action: {
        label: 'Save',
        onSubmit: async (value) => {
          const code = value.trim().toUpperCase();
          if (!code || code.length < 2 || code.length > 3 || !/^[A-Z0-9]+$/.test(code)) {
            Alert.alert('Invalid tricode', 'Must be 2-3 letters/numbers.');
            return;
          }
          const { error } = await supabase.from('teams').update({ tricode: code }).eq('id', team.id);
          if (error) { Alert.alert('Error', error.message); return; }
          queryClient.invalidateQueries({ queryKey: ['league'] });
        },
      },
    });
  };

  return (
    <ListRow index={index} total={total} style={styles.row}>
      <View style={styles.top}>
        <TeamLogo logoKey={team.logo_key} teamName={team.name} tricode={team.tricode ?? undefined} size="medium" />
        <View style={styles.identity}>
          <TouchableOpacity
            disabled={!isMine}
            activeOpacity={isMine ? 0.6 : 1}
            hitSlop={{ top: 8, bottom: 2, left: 4, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel={`Team name: ${team.name}${isMine ? ', tap to edit' : ''}`}
            onPress={isMine ? editName : undefined}
          >
            <View style={styles.nameRow}>
              <ThemedText style={styles.name} numberOfLines={1} ellipsizeMode="tail">
                {team.name}
              </ThemedText>
              {isMine && <Ionicons name="pencil" size={ms(10)} color={c.secondaryText} accessible={false} />}
            </View>
          </TouchableOpacity>
          <View style={styles.metaRow}>
            <TouchableOpacity
              disabled={!isMine}
              activeOpacity={isMine ? 0.6 : 1}
              hitSlop={{ top: 2, bottom: 8, left: 4, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={`Tricode: ${team.tricode ?? 'not set'}${isMine ? ', tap to edit' : ''}`}
              onPress={isMine ? editTricode : undefined}
            >
              <View style={styles.tricode}>
                <ThemedText type="mono" style={[styles.meta, { color: c.secondaryText }]}>
                  {team.tricode ?? (isMine ? 'Set tricode' : '—')}
                </ThemedText>
                {isMine && <Ionicons name="pencil" size={ms(9)} color={c.secondaryText} accessible={false} />}
              </View>
            </TouchableOpacity>
            <ThemedText
              type="mono"
              style={[styles.meta, styles.metaDot, { color: c.secondaryText }]}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              ·
            </ThemedText>
            <ThemedText
              type="mono"
              style={[styles.meta, styles.metaStatus, { color: c.secondaryText }]}
              numberOfLines={1}
            >
              {memberStatus(playerCount, !team.user_id)}
            </ThemedText>
          </View>
        </View>
        {team.is_commissioner && <Badge label="Commish" variant="turf" />}
      </View>
      {canImportRoster && playerCount === 0 && (
        <TouchableOpacity
          onPress={() => onImportRoster({ id: team.id, name: team.name })}
          accessibilityRole="button"
          accessibilityLabel={`Import roster for ${team.name}`}
          hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
          style={[styles.importBtn, { backgroundColor: c.cardAlt, borderColor: c.border }]}
        >
          <Ionicons name="cloud-upload-outline" size={ms(14)} color={c.heritageGold} accessible={false} />
          <ThemedText style={[styles.importText, { color: c.text }]}>Import Roster</ThemedText>
        </TouchableOpacity>
      )}
    </ListRow>
  );
}

const styles = StyleSheet.create({
  // ListRow defaults to a centered row; restack to a column so the import
  // action can sit under the identity block instead of beside it.
  row: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
  },
  identity: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(5),
  },
  name: {
    flexShrink: 1,
    fontSize: ms(15),
    lineHeight: ms(20),
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(5),
    minWidth: 0,
  },
  tricode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(3),
  },
  meta: {
    fontSize: ms(11),
  },
  metaDot: {
    flexShrink: 0,
  },
  // The status is the only meta segment safe to truncate — the tricode is a
  // tap target and must keep its full width.
  metaStatus: {
    flexShrink: 1,
  },
  // Indented to start under the team name (TeamLogo "medium" is 36 wide plus
  // the `top` gap) so the action reads as belonging to that member rather
  // than to the card. Gold icon + ink label on a bordered surface is the
  // same actionable-row language as league-info's own nav rows.
  importBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: s(6),
    marginTop: s(8),
    marginLeft: 36 + s(10),
    paddingHorizontal: s(10),
    paddingVertical: s(7),
    borderWidth: 1,
    borderRadius: 8,
  },
  importText: {
    fontSize: ms(12),
    fontWeight: '600',
  },
});
