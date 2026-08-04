import { useQuery } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { TeamLogo } from '@/components/team/TeamLogo';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { queryKeys } from '@/constants/queryKeys';
import { useColors } from '@/hooks/useColors';
import { supabase } from '@/lib/supabase';
import { ms, s } from '@/utils/scale';

interface LobbyDraftOrderProps {
  draftId: string;
  leagueId: string;
  /** The viewing member's team, badged in the list. */
  myTeamId: string | undefined;
  isRookieDraft: boolean;
  /** Snake drafts reverse every other round — worth saying above the list. */
  isSnake: boolean;
}

interface OrderRow {
  slot: number;
  teamId: string;
  name: string;
  tricode: string | null;
  logoKey: string | null;
  /** Set when the slot's pick has been traded — the original owner's tricode. */
  viaTricode: string | null;
}

/** Ready = every slot has an owner. Pending carries the reason it doesn't. */
type LobbyOrder =
  | { ready: true; rows: OrderRow[] }
  | { ready: false; reason: 'manual' | 'not-built' }
  | { ready: false; reason: 'undrawn'; joined: number; size: number };

type PickRow = {
  slot_number: number;
  current_team_id: string | null;
  original_team_id: string | null;
  current_team: { id: string; name: string; tricode: string | null; logo_key: string | null } | null;
  original_team: { tricode: string | null } | null;
};

/** PostgREST returns an embedded to-one as an object, but types it as an array. */
function one<T>(embed: T | T[] | null): T | null {
  return Array.isArray(embed) ? (embed[0] ?? null) : embed;
}

function pendingCopy(pending: Extract<LobbyOrder, { ready: false }>): string {
  switch (pending.reason) {
    case 'manual':
      return 'The commissioner sets this order by hand. It shows up here as soon as they set it.';
    case 'not-built':
      return 'The board hasn’t been set up yet. The order shows here once it is.';
    case 'undrawn':
      return pending.joined < pending.size
        ? `Slots are drawn once every team has joined — ${pending.joined} of ${pending.size} in so far.`
        : 'Slots haven’t been drawn yet. They’ll be set before the board opens.';
  }
}

/**
 * The round-1 slot order, shown in the pre-draft lobby so managers know where
 * they're picking from before the board opens.
 *
 * A PARTIAL order is deliberately not rendered: `join_league_team` tentatively
 * claims a slot for each joiner, and `assign_initial_draft_slots` reshuffles
 * everyone the moment the league fills — so a half-assigned board is a
 * placeholder, not a preview, and showing it would promise a slot that moves.
 */
export function LobbyDraftOrder({
  draftId,
  leagueId,
  myTeamId,
  isRookieDraft,
  isSnake,
}: LobbyDraftOrderProps) {
  const colors = useColors();

  const { data, isLoading } = useQuery<LobbyOrder>({
    queryKey: queryKeys.draftLobbyOrder(draftId),
    queryFn: async () => {
      const { data: picks, error } = await supabase
        .from('draft_picks')
        .select(
          `
          slot_number,
          current_team_id,
          original_team_id,
          current_team:current_team_id ( id, name, tricode, logo_key ),
          original_team:original_team_id ( tricode )
        `,
        )
        .eq('draft_id', draftId)
        .eq('round', 1)
        .order('slot_number', { ascending: true });
      if (error) throw error;

      const rows = ((picks ?? []) as unknown as PickRow[]).flatMap((p) => {
        const team = one(p.current_team);
        if (!team) return [];
        const original = one(p.original_team);
        return [
          {
            slot: p.slot_number,
            teamId: team.id,
            name: team.name,
            tricode: team.tricode,
            logoKey: team.logo_key,
            viaTricode:
              p.original_team_id && p.original_team_id !== p.current_team_id
                ? (original?.tricode ?? null)
                : null,
          },
        ];
      });

      if (picks && picks.length > 0 && rows.length === picks.length) {
        return { ready: true, rows };
      }

      if (!picks || picks.length === 0) return { ready: false, reason: 'not-built' };

      // Only reached when the order isn't settled — the league row is what
      // distinguishes "commissioner hasn't set it" from "still filling up".
      const { data: league } = await supabase
        .from('leagues')
        .select('initial_draft_order, teams, current_teams')
        .eq('id', leagueId)
        .single();

      if (!isRookieDraft && league?.initial_draft_order === 'manual') {
        return { ready: false, reason: 'manual' };
      }
      return {
        ready: false,
        reason: 'undrawn',
        joined: league?.current_teams ?? 0,
        size: league?.teams ?? 0,
      };
    },
    // Poll only while the order is still unsettled — a team joining or the
    // commissioner saving a manual order both land it without a re-entry.
    refetchInterval: (query) => (query.state.data?.ready ? false : 30_000),
  });

  const ready = data?.ready ? data.rows : null;
  // Null on a failed fetch — which must NOT read as "no order exists".
  const pending = data && !data.ready ? data : null;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.header}>
        <ThemedText
          type="varsitySmall"
          style={[styles.eyebrow, { color: colors.gold }]}
          accessibilityRole="header"
        >
          Draft Order
        </ThemedText>
        {ready && isSnake && (
          <ThemedText type="varsitySmall" style={[styles.headerNote, { color: colors.secondaryText }]}>
            Reverses Each Round
          </ThemedText>
        )}
      </View>

      {isLoading ? (
        <View style={styles.loading}>
          <LogoSpinner size={28} />
        </View>
      ) : ready ? (
        ready.map((row, i) => {
          const isMine = !!myTeamId && row.teamId === myTeamId;
          return (
            <View key={`${row.slot}-${row.teamId}`}>
              {i > 0 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
              {/* `accessible` groups the slot number, logo, name, via badge
                  and You pill into one swipe target — without it VoiceOver
                  reads five fragments per row. */}
              <View
                style={styles.row}
                accessible
                accessibilityLabel={
                  `Pick ${row.slot}, ${row.name}` +
                  (row.viaTricode ? `, from ${row.viaTricode}` : '') +
                  (isMine ? ', your team' : '')
                }
              >
                <ThemedText type="mono" style={[styles.slot, { color: colors.secondaryText }]}>
                  {row.slot}
                </ThemedText>
                <TeamLogo
                  logoKey={row.logoKey}
                  teamName={row.name}
                  tricode={row.tricode ?? undefined}
                  size="small"
                />
                <ThemedText
                  style={[styles.name, { color: colors.text }]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {row.name}
                </ThemedText>
                {(row.viaTricode || isMine) && (
                  <View style={styles.trailing}>
                    {row.viaTricode && (
                      <ThemedText type="varsitySmall" style={[styles.via, { color: colors.secondaryText }]}>
                        via {row.viaTricode}
                      </ThemedText>
                    )}
                    {isMine && (
                      <View style={[styles.youPill, { backgroundColor: colors.goldMuted }]}>
                        <ThemedText type="varsitySmall" style={[styles.youText, { color: colors.gold }]}>
                          You
                        </ThemedText>
                      </View>
                    )}
                  </View>
                )}
              </View>
            </View>
          );
        })
      ) : (
        <ThemedText style={[styles.pending, { color: colors.secondaryText }]}>
          {pending
            ? pendingCopy(pending)
            : 'Couldn’t load the draft order. It’ll retry on its own.'}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: s(16),
    paddingHorizontal: s(16),
    paddingBottom: s(6),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: s(14),
    paddingBottom: s(8),
  },
  eyebrow: {
    fontSize: ms(13),
    letterSpacing: 1,
  },
  headerNote: {
    fontSize: ms(11),
    letterSpacing: 0.5,
  },
  loading: {
    alignItems: 'center',
    paddingVertical: s(20),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    paddingVertical: s(10),
  },
  slot: {
    fontSize: ms(13),
    minWidth: s(18),
    textAlign: 'right',
  },
  name: {
    fontSize: ms(15),
    flexShrink: 1,
  },
  // Right-aligned group so the "via" badge and the You pill share one edge
  // instead of each floating to a different spot depending on the other.
  trailing: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  via: {
    fontSize: ms(11),
    letterSpacing: 0.5,
  },
  youPill: {
    borderRadius: s(6),
    paddingHorizontal: s(7),
    paddingVertical: s(2),
  },
  youText: {
    fontSize: ms(10),
    letterSpacing: 1,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  pending: {
    fontSize: ms(13),
    lineHeight: ms(19),
    paddingBottom: s(14),
  },
});
