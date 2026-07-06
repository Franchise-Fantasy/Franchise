import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { PickConditionRow } from '@/components/draft-hub/PickConditionRow';
import { TeamLogo } from '@/components/team/TeamLogo';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors, cardShadow } from '@/constants/Colors';
import { queryKeys } from '@/constants/queryKeys';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { calcLotteryPoolSize, generateDefaultOdds } from '@/utils/league/lottery';
import { ms, s } from '@/utils/scale';


interface Props {
  leagueId: string;
  playoffTeams: number;
  lotteryOdds: number[] | null;
  rookieDraftOrder: string;
  offseasonStep: string;
  /** Active league season — during the offseason `advance-season` has already
   *  flipped this to the upcoming season, which is the one the rookie draft
   *  (and the lottery that seeds it) is keyed to. Used to scope the post-lottery
   *  draft-pick query so we never bleed in future-season picks. Mirrors the
   *  offset-0 season window in useDraftHub. */
  season: string;
}

interface OrderRow {
  position: number;
  teamId: string | null;
  teamName: string;
  tricode: string | null;
  logoKey: string | null;
  wins: number;
  losses: number;
  oddsPct: string;
  // Pre-lottery pick conveyance/conditions, overlaid from draft_picks/pick_swaps
  // so the home card matches the draft hub instead of looking untraded.
  isTraded?: boolean;
  ownerTricode?: string | null;
  // Receiving team identity, so a straight-up traded pick can LEAD with the
  // team that actually gets it (logo + full name) rather than the origin.
  ownerName?: string | null;
  ownerLogoKey?: string | null;
  protectionThreshold?: number | null;
  // Protection owner (keeps the pick if it lands within threshold) — used to
  // lead a protected pick with its projected holder, matching the draft hub.
  protOwnerId?: string | null;
  protOwnerName?: string | null;
  protOwnerLogoKey?: string | null;
  protOwnerTricode?: string | null;
  swapPartnerTricode?: string | null;
  // Post-lottery only: the origin team's tricode for a pick that changed hands,
  // shown as "via TRI" so the resolved order ties back to the lottery slot.
  viaTricode?: string | null;
}

/**
 * Offseason replacement for StandingsSection — shows either lottery odds
 * (pre-lottery) or the locked-in rookie draft order (post-lottery).
 *
 * Styling mirrors StandingsSection exactly: same sectionLabel header,
 * same card padding, left-aligned rank + team logo + flex name col,
 * stat columns on the right in mono, footer "See All →" routing to
 * the draft hub. Keeps the home-screen list-card rhythm consistent.
 */
export function OffseasonLotteryOrder({
  leagueId,
  playoffTeams,
  lotteryOdds,
  rookieDraftOrder,
  offseasonStep,
  season,
}: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();

  const lotteryComplete =
    offseasonStep === 'lottery_complete' ||
    offseasonStep === 'rookie_draft_pending' ||
    offseasonStep === 'rookie_draft_complete' ||
    offseasonStep === 'ready_for_new_season';
  const isLotteryLeague = rookieDraftOrder === 'lottery';

  const { data, isLoading } = useQuery<OrderRow[]>({
    queryKey: queryKeys.offseasonLotteryOrder(leagueId, offseasonStep, season),
    queryFn: async () => {
      // Post-lottery the rookie draft order is locked into draft_picks
      // (slot_number). This query is self-contained — it joins team identity
      // directly and never touches team_seasons — so it MUST run BEFORE the
      // team_seasons fetch below. An imported league seeded straight to the
      // rookie-draft point often has NO archived team_seasons (history import is
      // optional / fuzzy-matched), and gating this behind that fetch made a
      // league with a set order fall through to the "order available once the
      // season ends" empty state.
      //
      // NOTE: do NOT filter on draft_id — once the commissioner clicks "Done"
      // (create-rookie-draft) the picks get linked to the new draft, so an
      // `.is('draft_id', null)` filter would return nothing and silently fall
      // through to the reverse-standings overlay, showing the WRONG (pre-lottery)
      // order. season + round + unused (player_id null) is enough to scope it.
      if (lotteryComplete) {
        const { data: picks } = await supabase
          .from('draft_picks')
          .select('slot_number, current_team_id, original_team_id, team:teams!draft_picks_current_team_id_fkey(id, name, tricode, logo_key), origin:teams!draft_picks_original_team_id_fkey(tricode, name)')
          .eq('league_id', leagueId)
          .eq('season', season)
          .eq('round', 1)
          .is('player_id', null)
          .order('slot_number', { ascending: true });

        const ordered = (picks ?? []).filter((p: any) => p.slot_number != null);
        if (ordered.length > 0) {
          return ordered.map((p: any, i: number) => {
            const traded = !!p.original_team_id && !!p.current_team_id && p.original_team_id !== p.current_team_id;
            const originTri = p.origin?.tricode ?? p.origin?.name?.slice(0, 3).toUpperCase() ?? null;
            return {
              position: p.slot_number ?? i + 1,
              teamId: p.team?.id ?? null,
              teamName: p.team?.name ?? 'Unknown',
              tricode: p.team?.tricode ?? null,
              logoKey: p.team?.logo_key ?? null,
              wins: 0,
              losses: 0,
              oddsPct: '—',
              // Resolved pick that changed hands — name the slot's origin so the
              // order visibly ties back to the lottery (slot 2 = "MID via BF").
              viaTricode: traded ? originTri : null,
            };
          });
        }
      }

      // Pre-lottery (or lottery flagged complete but picks not yet ordered): the
      // order is reverse-standings from the most recent archived season, with
      // round-1 pick conveyance overlaid.
      const { data: allArchived } = await supabase
        .from('team_seasons')
        .select('team_id, wins, losses, points_for, final_standing, season, team:teams!team_seasons_team_id_fkey(id, name, tricode, logo_key)')
        .eq('league_id', leagueId)
        .order('season', { ascending: false });

      if (!allArchived || allArchived.length === 0) return [];
      const latestSeason = (allArchived[0] as any).season;
      const rows = allArchived.filter((r: any) => r.season === latestSeason);

      // Sort: worst record first (reverse standings)
      rows.sort((a: any, b: any) => {
        if (a.final_standing != null && b.final_standing != null) {
          return b.final_standing - a.final_standing;
        }
        if (a.wins !== b.wins) return a.wins - b.wins;
        return Number(a.points_for) - Number(b.points_for);
      });

      const totalTeams = rows.length;
      const poolSize = isLotteryLeague ? calcLotteryPoolSize(totalTeams, playoffTeams) : 0;
      const odds = lotteryOdds ?? (poolSize > 0 ? generateDefaultOdds(poolSize) : []);

      // Overlay round-1 pick ownership so traded/protected/swapped picks show
      // their conveyance + condition, matching the draft hub (the standings
      // rows are otherwise blind to where each pick is headed).
      const teamMeta = new Map<string, { name: string; tricode: string | null; logoKey: string | null }>();
      for (const r of rows as any[]) {
        if (r.team?.id) teamMeta.set(r.team.id, { name: r.team.name, tricode: r.team.tricode, logoKey: r.team.logo_key ?? null });
      }
      const tri = (id: string | null | undefined): string | null => {
        if (!id) return null;
        const m = teamMeta.get(id);
        return m?.tricode ?? m?.name?.slice(0, 3).toUpperCase() ?? null;
      };

      const { data: r1picks } = await supabase
        .from('draft_picks')
        .select('original_team_id, current_team_id, protection_threshold, protection_owner_id')
        .eq('league_id', leagueId)
        .eq('season', season)
        .eq('round', 1)
        .is('player_id', null);
      const condByOrig = new Map<string, { ownerId: string | null; threshold: number | null; protOwnerId: string | null }>();
      for (const p of r1picks ?? []) {
        if (p.original_team_id) {
          condByOrig.set(p.original_team_id, {
            ownerId: p.current_team_id,
            threshold: p.protection_threshold,
            protOwnerId: p.protection_owner_id,
          });
        }
      }

      const { data: swapRows } = await supabase
        .from('pick_swaps')
        .select('beneficiary_team_id, counterparty_team_id')
        .eq('league_id', leagueId)
        .eq('season', season)
        .eq('round', 1)
        .eq('resolved', false);
      const swapPartner = new Map<string, string>();
      for (const sw of swapRows ?? []) {
        if (sw.beneficiary_team_id) swapPartner.set(sw.beneficiary_team_id, sw.counterparty_team_id);
        if (sw.counterparty_team_id) swapPartner.set(sw.counterparty_team_id, sw.beneficiary_team_id);
      }

      return rows.map((r: any, i: number) => {
        const teamId = r.team?.id ?? null;
        const cond = teamId ? condByOrig.get(teamId) : undefined;
        const ownerId = cond?.ownerId ?? null;
        const isTraded = !!ownerId && ownerId !== teamId;
        const ownerMeta = ownerId ? teamMeta.get(ownerId) : undefined;
        const protOwnerId = cond?.protOwnerId ?? null;
        const protOwnerMeta = protOwnerId ? teamMeta.get(protOwnerId) : undefined;
        const partnerId = teamId ? swapPartner.get(teamId) : undefined;
        return {
          position: i + 1,
          teamId,
          teamName: r.team?.name ?? 'Unknown',
          tricode: r.team?.tricode ?? null,
          logoKey: r.team?.logo_key ?? null,
          wins: r.wins ?? 0,
          losses: r.losses ?? 0,
          oddsPct: isLotteryLeague && i < poolSize && odds[i] != null ? `${odds[i]}%` : '—',
          isTraded,
          ownerTricode: isTraded ? tri(ownerId) : null,
          ownerName: isTraded ? (ownerMeta?.name ?? null) : null,
          ownerLogoKey: isTraded ? (ownerMeta?.logoKey ?? null) : null,
          protectionThreshold: cond?.threshold ?? null,
          // Protection owner = the team that KEEPS the pick if it lands within
          // threshold (may differ from both the origin and the convey target).
          protOwnerId,
          protOwnerName: protOwnerMeta?.name ?? null,
          protOwnerLogoKey: protOwnerMeta?.logoKey ?? null,
          protOwnerTricode: tri(protOwnerId),
          swapPartnerTricode: partnerId ? tri(partnerId) : null,
        };
      });
    },
    staleTime: 1000 * 60 * 2,
  });

  const outerLabel = lotteryComplete
    ? 'Rookie Draft Order'
    : isLotteryLeague
      ? 'Lottery Odds'
      : 'Rookie Draft Order';
  const showRecord = !lotteryComplete;
  const showOdds = isLotteryLeague && !lotteryComplete;

  // First team we can open a roster for — anchors the "Rosters" header pill.
  // The team-roster page carries its own switcher, so landing on any team
  // gives access to every roster in the league. During the offseason this is
  // the only surface listing all teams (StandingsSection is swapped out), so
  // without this the rosters are effectively unreachable.
  const firstTeamId = data?.find((r) => r.teamId)?.teamId ?? null;

  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <View style={styles.labelLeft}>
          <View style={[styles.labelRule, { backgroundColor: c.gold }]} />
          <ThemedText type="sectionLabel" style={{ color: c.text }}>
            {outerLabel}
          </ThemedText>
        </View>
        {firstTeamId && (
          <TouchableOpacity
            style={[styles.headerPill, { backgroundColor: c.cardAlt, borderColor: c.border }]}
            onPress={() => router.push(`/team-roster/${firstTeamId}` as never)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Browse team rosters"
            hitSlop={8}
          >
            <IconSymbol name="person.3.fill" size={14} color={c.gold} />
            <ThemedText type="varsitySmall" style={[styles.headerPillText, { color: c.text }]}>
              Rosters
            </ThemedText>
          </TouchableOpacity>
        )}
      </View>

      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border, ...cardShadow }]}>
        <View style={styles.list}>
          {isLoading ? (
            <View style={styles.loading}>
              <LogoSpinner />
            </View>
          ) : !data || data.length === 0 ? (
            <ThemedText style={[styles.empty, { color: c.secondaryText }]}>
              Order will be available once the season ends.
            </ThemedText>
          ) : (
            <>
              <View style={[styles.headerRow, { borderBottomColor: c.border }]}>
                <ThemedText type="varsitySmall" style={[styles.rank, { color: c.secondaryText }]}>#</ThemedText>
                <View style={{ width: s(26) }} />
                <ThemedText type="varsitySmall" style={[styles.teamCol, { color: c.secondaryText }]}>
                  Team
                </ThemedText>
                {showRecord && (
                  <ThemedText type="varsitySmall" style={[styles.record, { color: c.secondaryText }]}>
                    W-L
                  </ThemedText>
                )}
                {showOdds && (
                  <ThemedText type="varsitySmall" style={[styles.odds, { color: c.secondaryText }]}>
                    Odds
                  </ThemedText>
                )}
              </View>
              {data.slice(0, 14).map((row, i, arr) => {
                const isLast = i === arr.length - 1;
                // A straight-up trade (no protection, no swap) leads with the
                // team that actually receives the pick — showing the origin's
                // logo + full name reads as if they keep it. Protected/swapped
                // picks stay origin-led because the destination is conditional.
                const straightTraded =
                  !lotteryComplete && !!row.isTraded && !row.protectionThreshold && !row.swapPartnerTricode;
                const isProtected = !lotteryComplete && row.protectionThreshold != null;
                const originTri = row.tricode ?? row.teamName.slice(0, 3).toUpperCase();
                // Live projection for a protected pick: would it hold at its
                // current (reverse-standings) slot? Pre-draw this can swing, so
                // it's framed as "Projected".
                const wouldHold = isProtected && row.position <= row.protectionThreshold!;
                // A protected pick leads with its PROJECTED holder (keeper if
                // within threshold, else the convey target) — matching the draft
                // hub — and shows "from ORIGIN" unless that holder IS the origin.
                const protHolderName = wouldHold ? row.protOwnerName : row.ownerName;
                const protHolderLogoKey = wouldHold ? row.protOwnerLogoKey : row.ownerLogoKey;
                const protHolderTricode = wouldHold ? row.protOwnerTricode : row.ownerTricode;
                const protHolderIsOrigin = wouldHold && row.protOwnerId === row.teamId;
                const primaryName = straightTraded
                  ? (row.ownerName ?? row.teamName)
                  : isProtected
                    ? (protHolderName ?? row.teamName)
                    : row.teamName;
                const primaryLogoKey = straightTraded
                  ? row.ownerLogoKey
                  : isProtected
                    ? protHolderLogoKey
                    : row.logoKey;
                const primaryTricode = straightTraded
                  ? row.ownerTricode
                  : isProtected
                    ? protHolderTricode
                    : row.tricode;
                return (
                  <TouchableOpacity
                    key={`${row.position}-${row.teamId ?? row.teamName}`}
                    style={[
                      styles.row,
                      { borderBottomColor: c.border },
                      isLast && { borderBottomWidth: 0 },
                    ]}
                    onPress={() =>
                      row.teamId ? router.push(`/team-roster/${row.teamId}` as never) : undefined
                    }
                    disabled={!row.teamId}
                    activeOpacity={0.6}
                    accessibilityRole={row.teamId ? 'button' : undefined}
                    accessibilityHint={row.teamId ? 'View team roster' : undefined}
                    accessibilityLabel={
                      `${primaryName}, pick ${row.position}` +
                      (straightTraded
                        ? `, traded from ${originTri}`
                        : row.viaTricode
                          ? `, from ${row.viaTricode}`
                          : isProtected && !protHolderIsOrigin
                            ? `, from ${originTri}`
                            : row.isTraded && row.ownerTricode && !isProtected
                              ? `, traded to ${row.ownerTricode}`
                              : '') +
                      (row.protectionThreshold
                        ? `, top-${row.protectionThreshold} protected, projected ${wouldHold ? 'keeps' : 'conveys'}`
                        : '') +
                      (row.swapPartnerTricode ? `, pick swap with ${row.swapPartnerTricode}` : '')
                    }
                  >
                    <View style={styles.rowTop}>
                      <ThemedText type="mono" style={[styles.rank, { color: c.secondaryText }]}>
                        {row.position}
                      </ThemedText>
                      <TeamLogo
                        logoKey={primaryLogoKey}
                        teamName={primaryName}
                        tricode={primaryTricode ?? undefined}
                        size="small"
                      />
                      <View style={styles.nameWrap}>
                        <ThemedText
                          style={[styles.teamName, { color: c.text }]}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                        >
                          {primaryName}
                        </ThemedText>
                        {straightTraded ? (
                          <View style={styles.conveyance}>
                            <ThemedText type="varsitySmall" style={[styles.fromTri, { color: c.secondaryText }]}>
                              from {originTri}
                            </ThemedText>
                          </View>
                        ) : row.viaTricode ? (
                          <View style={styles.conveyance}>
                            <ThemedText type="varsitySmall" style={[styles.fromTri, { color: c.secondaryText }]}>
                              from {row.viaTricode}
                            </ThemedText>
                          </View>
                        ) : isProtected && !protHolderIsOrigin ? (
                          <View style={styles.conveyance}>
                            <ThemedText type="varsitySmall" style={[styles.fromTri, { color: c.secondaryText }]}>
                              from {originTri}
                            </ThemedText>
                          </View>
                        ) : row.isTraded && row.ownerTricode && !isProtected ? (
                          <View style={styles.conveyance}>
                            <Ionicons name="arrow-forward" size={ms(10)} color={c.gold} accessible={false} />
                            <ThemedText type="varsitySmall" style={[styles.ownerTri, { color: c.text }]}>
                              {row.ownerTricode}
                            </ThemedText>
                          </View>
                        ) : null}
                      </View>
                      {showRecord && (
                        <ThemedText type="mono" style={[styles.record, { color: c.secondaryText }]}>
                          {row.wins}-{row.losses}
                        </ThemedText>
                      )}
                      {showOdds && (
                        <ThemedText type="mono" style={[styles.odds, { color: c.gold }]}>
                          {row.oddsPct}
                        </ThemedText>
                      )}
                    </View>
                    {!lotteryComplete && (row.protectionThreshold || row.swapPartnerTricode) ? (
                      <View style={styles.conditionLine}>
                        <PickConditionRow
                          kind={
                            row.swapPartnerTricode
                              ? 'swap'
                              : wouldHold
                                ? 'protection_held'
                                : 'protection_missed'
                          }
                          badgeLabel={row.swapPartnerTricode ? row.swapPartnerTricode : `TOP-${row.protectionThreshold}`}
                          storyText={
                            row.swapPartnerTricode
                              ? `Pick swap with ${row.swapPartnerTricode}`
                              : wouldHold
                                ? `Projected No. ${row.position} — kept by ${row.protOwnerTricode ?? '—'}; conveys to ${row.ownerTricode ?? '—'} if it slips past Top-${row.protectionThreshold}`
                                : `Projected No. ${row.position} — conveys to ${row.ownerTricode ?? '—'}; kept by ${row.protOwnerTricode ?? '—'} if it climbs to Top-${row.protectionThreshold}`
                          }
                        />
                      </View>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: s(4),
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: s(10),
  },
  labelLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
  },
  labelRule: {
    height: 2,
    width: s(18),
  },
  // Mirrors StandingsSection's "See All" pill so the offseason card reads
  // as an entry point into rosters, not a static odds table.
  headerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(5),
    paddingHorizontal: s(10),
    paddingVertical: s(5),
    borderRadius: 8,
    borderWidth: 1,
  },
  headerPillText: {
    fontSize: ms(9.5),
  },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: s(14),
    paddingTop: s(10),
    paddingBottom: s(8),
    marginBottom: s(16),
    overflow: 'hidden',
  },
  list: {},
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(6),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    paddingVertical: s(9),
    paddingHorizontal: s(4),
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginHorizontal: -s(4),
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  nameWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: s(8),
    gap: s(6),
  },
  conveyance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(2),
  },
  ownerTri: {
    fontSize: ms(11),
  },
  fromTri: {
    fontSize: ms(11),
  },
  conditionLine: {
    marginLeft: s(50),
    marginTop: s(5),
  },
  rank: {
    width: s(18),
    fontSize: ms(12),
    textAlign: 'left',
  },
  teamCol: {
    flex: 1,
    fontSize: ms(13),
    marginLeft: s(8),
  },
  teamName: {
    flexShrink: 1,
    fontSize: ms(13),
    fontWeight: '500',
  },
  record: {
    width: s(44),
    textAlign: 'center',
    fontSize: ms(12),
  },
  odds: {
    width: s(52),
    textAlign: 'right',
    fontSize: ms(12),
  },
  empty: {
    fontSize: ms(13),
    textAlign: 'center',
    paddingVertical: s(20),
  },
  loading: {
    paddingVertical: s(20),
  },
});
