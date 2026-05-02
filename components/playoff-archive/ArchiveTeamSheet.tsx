import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ArchiveTeamLogo } from '@/components/playoff-archive/ArchiveTeamLogo';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Fonts } from '@/constants/Colors';
import { useArchiveColors } from '@/hooks/useArchiveColors';
import { useArchiveAwards, useArchiveTeamRun } from '@/hooks/useArchivePlayoffs';
import type {
  ArchiveAwardEntry,
  ArchiveSeries,
  AwardType,
} from '@/types/archivePlayoff';
import { ms, s } from '@/utils/scale';

interface Props {
  season: number | null;
  franchiseId: string | null;
  /** Whether the year had an official play-in tournament. Drives whether we
   *  describe a non-playoff team as "Made the play-in" vs "Missed the
   *  playoffs" when they don't appear in any series. */
  hasPlayIn: boolean;
  onClose: () => void;
}

const ROUND_NAME: Record<number, string> = {
  1: 'Round 1',
  2: 'Conference Semifinals',
  3: 'Conference Finals',
  4: 'NBA Finals',
};

// "Lost in Conference Finals to OKC 4-2" — short summary line for the
// franchise's playoff path. Falls back through three states when the team
// has no playoff-series record:
//   • play-in season + seed 7-10 → "Made the play-in"
//   • otherwise → "Missed the playoffs"
function summarize(
  series: ArchiveSeries[],
  franchiseId: string,
  champion: boolean,
  standing: { conference_seed: number } | null,
  hasPlayIn: boolean,
): string {
  if (champion) return 'NBA Champions';
  const lossSeries = series
    .filter((s) => s.winner_franchise_id && s.winner_franchise_id !== franchiseId)
    .sort((a, b) => b.round - a.round)[0];
  if (lossSeries) {
    const opponentId =
      lossSeries.franchise_a_id === franchiseId
        ? lossSeries.franchise_b_id
        : lossSeries.franchise_a_id;
    const myWins =
      lossSeries.franchise_a_id === franchiseId ? lossSeries.wins_a : lossSeries.wins_b;
    const oppWins =
      lossSeries.franchise_a_id === franchiseId ? lossSeries.wins_b : lossSeries.wins_a;
    return `Eliminated in ${ROUND_NAME[lossSeries.round]} by ${opponentId} ${oppWins}–${myWins}`;
  }
  // No series record — they were eliminated before/in the play-in or they
  // didn't qualify at all. The seed (7-10 in a play-in year) tells us which.
  const seed = standing?.conference_seed ?? null;
  if (hasPlayIn && seed != null && seed >= 7 && seed <= 10) {
    return 'Made the play-in';
  }
  return 'Missed the playoffs';
}

// Display order for franchise-scoped awards in the Team Sheet. Solo awards
// first, then All-NBA tiers. We don't surface All-Defense / All-Rookie here
// to keep the section dense and high-signal — they're available in the
// Standings view's "More" disclosure.
const TEAM_AWARD_ORDER: { type: AwardType; label: string }[] = [
  { type: 'mvp', label: 'MVP' },
  { type: 'dpoy', label: 'DPOY' },
  { type: 'roy', label: 'Rookie of the Year' },
  { type: 'sixth_man', label: 'Sixth Man' },
  { type: 'mip', label: 'Most Improved' },
  { type: 'all_nba_first', label: 'All-NBA First Team' },
  { type: 'all_nba_second', label: 'All-NBA Second Team' },
  { type: 'all_nba_third', label: 'All-NBA Third Team' },
];

export function ArchiveTeamSheet({ season, franchiseId, hasPlayIn, onClose }: Props) {
  const c = useArchiveColors();
  const { data, isLoading } = useArchiveTeamRun(season, franchiseId);
  const { data: awards } = useArchiveAwards(season);

  // Flatten franchise-scoped awards in display order.
  const teamAwards = useMemo(() => {
    if (!awards || !franchiseId) return [];
    const out: { type: AwardType; label: string; entry: ArchiveAwardEntry }[] = [];
    for (const { type, label } of TEAM_AWARD_ORDER) {
      const rows = awards[type];
      if (!rows) continue;
      for (const entry of rows) {
        if (entry.franchise_id === franchiseId) {
          out.push({ type, label, entry });
        }
      }
    }
    return out;
  }, [awards, franchiseId]);

  const visible = !!franchiseId && !!season;

  const isChampion = useMemo(() => {
    if (!data?.series || !franchiseId) return false;
    const finals = data.series.find((sr) => sr.round === 4);
    return finals?.winner_franchise_id === franchiseId;
  }, [data?.series, franchiseId]);

  const f = data?.franchise ?? null;
  const standing = data?.standing ?? null;
  const summary =
    data?.series && franchiseId
      ? summarize(data.series, franchiseId, isChampion, data.standing, hasPlayIn)
      : '';

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={f ? `${f.city} ${f.name}` : 'Team'}
      subtitle={
        standing
          ? `${standing.conference.toUpperCase()} ${standing.conference_seed} SEED · ${standing.wins}–${standing.losses}`
          : undefined
      }
      height="62%"
    >
      {isLoading || !data || !f ? (
        <View style={styles.loading}>
          <LogoSpinner />
        </View>
      ) : (
        <View>
          {/* Hero strip — colored by primary, tricode disc + summary */}
          <View
            style={[
              styles.hero,
              { backgroundColor: f.primary_color ?? c.primary },
            ]}
          >
            <View style={[styles.heroRule, { backgroundColor: f.secondary_color ?? Brand.gold }]} />
            <View style={styles.heroBody}>
              <ArchiveTeamLogo
                franchiseId={f.franchise_id}
                tricode={f.tricode}
                primaryColor={f.secondary_color}
                secondaryColor={f.primary_color}
                logoKey={f.logo_key}
                size={s(60)}
              />
              <View style={styles.heroLabels}>
                <ThemedText
                  type="varsitySmall"
                  style={[styles.heroEyebrow, { color: f.secondary_color ?? Brand.ecru }]}
                >
                  {isChampion ? 'NBA CHAMPION' : 'PLAYOFF RUN'}
                </ThemedText>
                <ThemedText
                  style={[styles.heroSummary, { color: '#FFFFFF' }]}
                  numberOfLines={2}
                >
                  {summary}
                </ThemedText>
              </View>
              {isChampion && (
                <Ionicons
                  name="trophy"
                  size={ms(28)}
                  color={f.secondary_color ?? Brand.gold}
                  accessible={false}
                />
              )}
            </View>
          </View>

          {/* Series list — round-by-round path */}
          <View style={styles.section}>
            <ThemedText
              type="varsity"
              style={[styles.sectionLabel, { color: c.text }]}
              accessibilityRole="header"
            >
              PLAYOFF PATH
            </ThemedText>
            <View style={[styles.seriesList, { borderColor: c.border }]}>
              {data.series.length === 0 && (
                <ThemedText style={[styles.emptyText, { color: c.secondaryText }]}>
                  Did not make the playoffs.
                </ThemedText>
              )}
              {data.series.map((sr) => {
                const isWin = sr.winner_franchise_id === franchiseId;
                const myWins = sr.franchise_a_id === franchiseId ? sr.wins_a : sr.wins_b;
                const oppWins = sr.franchise_a_id === franchiseId ? sr.wins_b : sr.wins_a;
                const opponentId =
                  sr.franchise_a_id === franchiseId
                    ? sr.franchise_b_id
                    : sr.franchise_a_id;
                return (
                  <View
                    key={sr.id}
                    style={[styles.seriesRow, { borderBottomColor: c.border }]}
                  >
                    <View style={styles.seriesLabelCol}>
                      <ThemedText
                        type="varsitySmall"
                        style={[styles.seriesRound, { color: c.secondaryText }]}
                      >
                        {ROUND_NAME[sr.round].toUpperCase()}
                      </ThemedText>
                      <ThemedText
                        style={[
                          styles.seriesOpponent,
                          { color: c.text, fontWeight: '500' },
                        ]}
                      >
                        {isWin ? 'def.' : 'lost to'} {opponentId ?? '—'}
                      </ThemedText>
                    </View>
                    <View
                      style={[
                        styles.scoreBadge,
                        {
                          backgroundColor: isWin ? Brand.turfGreen : c.cardAlt,
                        },
                      ]}
                    >
                      <ThemedText
                        style={[
                          styles.scoreText,
                          { color: isWin ? Brand.ecru : c.text },
                        ]}
                      >
                        {myWins}–{oppWins}
                      </ThemedText>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Top players — only when stats are present (skipped in v1 import) */}
          {data.top_players.length > 0 && (
            <View style={styles.section}>
              <ThemedText
                type="varsity"
                style={[styles.sectionLabel, { color: c.text }]}
                accessibilityRole="header"
              >
                TOP PLAYOFF PERFORMERS
              </ThemedText>
              {data.top_players.map((p) => (
                <View
                  key={p.bbref_player_id}
                  style={[styles.playerRow, { borderBottomColor: c.border }]}
                >
                  <ThemedText
                    style={[styles.playerName, { color: c.text }]}
                    numberOfLines={1}
                  >
                    {p.player_name}
                  </ThemedText>
                  <View style={styles.playerStats}>
                    <PlayerStat label="PPG" value={p.pts_per} c={c} />
                    <PlayerStat label="RPG" value={p.reb_per} c={c} />
                    <PlayerStat label="APG" value={p.ast_per} c={c} />
                    <PlayerStat label="GP" value={p.gp} c={c} integer />
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Season awards earned by this franchise's players. Skipped when
              we haven't curated awards for the season or no rows match. */}
          {teamAwards.length > 0 && (
            <View style={styles.section}>
              <ThemedText
                type="varsity"
                style={[styles.sectionLabel, { color: c.text }]}
                accessibilityRole="header"
              >
                AWARDS THIS SEASON
              </ThemedText>
              {teamAwards.map(({ type, label, entry }) => (
                <View
                  key={`${type}-${entry.rank}-${entry.player_name}`}
                  style={[styles.awardRow, { borderBottomColor: c.border }]}
                >
                  <View style={styles.awardLabelCol}>
                    <ThemedText
                      type="varsitySmall"
                      style={[styles.awardLabel, { color: c.secondaryText }]}
                      numberOfLines={1}
                    >
                      {label}
                    </ThemedText>
                  </View>
                  <View style={styles.awardPlayerCol}>
                    <ThemedText
                      style={[styles.awardPlayer, { color: c.text }]}
                      numberOfLines={1}
                    >
                      {entry.player_name}
                    </ThemedText>
                    {entry.stat_line && (
                      <ThemedText
                        style={[styles.awardStat, { color: c.secondaryText }]}
                        numberOfLines={1}
                      >
                        {entry.stat_line}
                      </ThemedText>
                    )}
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </BottomSheet>
  );
}

function PlayerStat({
  label,
  value,
  c,
  integer,
}: {
  label: string;
  value: number | null;
  c: ReturnType<typeof useArchiveColors>;
  integer?: boolean;
}) {
  return (
    <View style={styles.statBlock}>
      <ThemedText style={[styles.statValue, { color: c.text }]}>
        {value == null ? '—' : integer ? value : Number(value).toFixed(1)}
      </ThemedText>
      <ThemedText
        type="varsitySmall"
        style={[styles.statLabel, { color: c.secondaryText }]}
      >
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    paddingVertical: s(40),
    alignItems: 'center',
  },

  hero: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: s(16),
  },
  heroRule: {
    height: 2,
    marginHorizontal: s(16),
    marginTop: s(8),
  },
  heroBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(12),
    padding: s(14),
  },
  heroLabels: {
    flex: 1,
    minWidth: 0,
  },
  heroEyebrow: {
    fontSize: ms(10),
    letterSpacing: 1.4,
    marginBottom: s(2),
  },
  heroSummary: {
    fontSize: ms(13),
    lineHeight: ms(17),
  },

  section: {
    marginBottom: s(16),
  },
  sectionLabel: {
    fontSize: ms(11),
    letterSpacing: 1.2,
    marginBottom: s(8),
  },

  seriesList: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    overflow: 'hidden',
  },
  emptyText: {
    fontSize: ms(13),
    textAlign: 'center',
    paddingVertical: s(20),
  },
  seriesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(10),
    paddingHorizontal: s(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  seriesLabelCol: {
    flex: 1,
    minWidth: 0,
  },
  seriesRound: {
    fontSize: ms(9),
    letterSpacing: 1.0,
    marginBottom: 1,
  },
  seriesOpponent: {
    fontSize: ms(13),
  },
  scoreBadge: {
    paddingHorizontal: s(10),
    paddingVertical: s(4),
    borderRadius: 6,
    minWidth: s(46),
    alignItems: 'center',
  },
  scoreText: {
    fontFamily: Fonts.mono,
    fontSize: ms(13),
    fontWeight: '700',
  },

  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(8),
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: s(10),
  },
  playerName: {
    flex: 1,
    fontSize: ms(13),
    minWidth: 0,
  },
  playerStats: {
    flexDirection: 'row',
    gap: s(10),
  },

  awardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(8),
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: s(8),
  },
  awardLabelCol: {
    flex: 1,
    minWidth: 0,
  },
  awardLabel: {
    fontSize: ms(10),
    letterSpacing: 0.6,
  },
  awardPlayerCol: {
    alignItems: 'flex-end',
    maxWidth: '60%',
  },
  awardPlayer: {
    fontSize: ms(13),
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  awardStat: {
    fontSize: ms(10),
    letterSpacing: 0.2,
    marginTop: 2,
  },
  statBlock: {
    alignItems: 'center',
    minWidth: s(36),
  },
  statValue: {
    fontFamily: Fonts.mono,
    fontSize: ms(13),
    fontWeight: '700',
  },
  statLabel: {
    fontSize: ms(8),
    letterSpacing: 0.8,
    marginTop: 1,
  },
});
