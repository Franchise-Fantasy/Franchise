import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { ArchiveTeamLogo } from '@/components/playoff-archive/ArchiveTeamLogo';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Fonts } from '@/constants/Colors';
import { useArchiveColors } from '@/hooks/useArchiveColors';
import {
  useArchiveAwards,
  useArchiveTeamRotation,
  useArchiveTeamRun,
} from '@/hooks/useArchivePlayoffs';
import type {
  ArchiveAwardEntry,
  ArchiveRotationPlayer,
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
  const router = useRouter();
  const { data, isLoading } = useArchiveTeamRun(season, franchiseId);
  const { data: awards } = useArchiveAwards(season);
  const { data: rotation } = useArchiveTeamRotation(season, franchiseId);

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
                  {isChampion
                    ? 'NBA CHAMPION'
                    : data.series.length > 0
                      ? 'PLAYOFF PATH'
                      : 'REGULAR SEASON'}
                </ThemedText>
                {data.series.length > 0 ? (
                  <View style={styles.pathChipRow}>
                    {data.series.map((sr) => {
                      const decided = !!sr.winner_franchise_id;
                      const isWin = sr.winner_franchise_id === franchiseId;
                      const myWins = sr.franchise_a_id === franchiseId ? sr.wins_a : sr.wins_b;
                      const oppWins = sr.franchise_a_id === franchiseId ? sr.wins_b : sr.wins_a;
                      const opponentId =
                        sr.franchise_a_id === franchiseId
                          ? sr.franchise_b_id
                          : sr.franchise_a_id;
                      // Pill style: secondary color border, faint fill, white
                      // text. Series this team lost (their elimination)
                      // gets a hollow look so the eye lands on losses fast.
                      const lost = decided && !isWin;
                      const fillColor = lost
                        ? 'transparent'
                        : (f.secondary_color ?? Brand.gold) + '33';
                      return (
                        <View
                          key={sr.id}
                          style={[
                            styles.pathChip,
                            {
                              borderColor: f.secondary_color ?? Brand.gold,
                              backgroundColor: fillColor,
                            },
                          ]}
                        >
                          <ThemedText style={[styles.pathChipTri, { color: '#FFFFFF' }]}>
                            {opponentId ?? '—'}
                          </ThemedText>
                          <ThemedText style={[styles.pathChipScore, { color: '#FFFFFF' }]}>
                            {myWins}–{oppWins}
                          </ThemedText>
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <ThemedText
                    style={[styles.heroSummary, { color: '#FFFFFF' }]}
                    numberOfLines={1}
                  >
                    {summary}
                  </ThemedText>
                )}
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

          {/* Link out to the full year-by-year franchise history page.
              Pulled out as a standalone row so it reads as a deliberate
              navigation, not just one more chip-strip element. */}
          <TouchableOpacity
            onPress={() => {
              if (!franchiseId) return;
              onClose();
              router.push(`/franchise/${franchiseId}` as never);
            }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`View ${f.city} ${f.name} franchise history`}
            style={[styles.historyLinkRow, { borderColor: c.border, backgroundColor: c.cardAlt }]}
          >
            <ThemedText
              type="varsitySmall"
              style={[styles.historyLinkLabel, { color: c.text }]}
            >
              FRANCHISE HISTORY
            </ThemedText>
            <Ionicons name="chevron-forward" size={ms(16)} color={c.secondaryText} />
          </TouchableOpacity>

          {/* Regular-season rotation — top players by VORP, filtered to
              mpg >= 15 and gp >= 25. Sticky-name layout: the name column
              is a fixed View on the left, the stats live inside a
              horizontal ScrollView on the right. Row heights are explicit
              so the two columns stay vertically aligned. */}
          {rotation && rotation.length > 0 && (
            <View style={styles.section}>
              <ThemedText
                type="varsity"
                style={[styles.sectionLabel, { color: c.text }]}
                accessibilityRole="header"
              >
                REGULAR SEASON ROTATION
              </ThemedText>
              <View style={[styles.rotationTable, { borderColor: c.border }]}>
                {/* Sticky name column */}
                <View style={[styles.rotationNameColumn, { borderRightColor: c.border }]}>
                  <View
                    style={[
                      styles.rotationNameCell,
                      styles.rotationHeaderCell,
                      { borderBottomColor: c.border },
                    ]}
                  >
                    <ThemedText
                      type="varsitySmall"
                      style={[styles.rotationColLabel, { color: c.secondaryText }]}
                    >
                      PLAYER
                    </ThemedText>
                  </View>
                  {rotation.map((p) => {
                    const displayName = abbreviateName(p.player_name);
                    return (
                      <View
                        key={p.bbref_player_id}
                        style={[styles.rotationNameCell, { borderBottomColor: c.border }]}
                      >
                        <View style={styles.rotationNameInner}>
                          {p.is_all_star && (
                            <Ionicons
                              name="star"
                              size={ms(11)}
                              color={c.gold}
                              style={styles.rotationStar}
                              accessibilityLabel="All-Star"
                            />
                          )}
                          <ThemedText
                            style={[styles.rotationName, { color: c.text }]}
                            numberOfLines={1}
                          >
                            {displayName}
                          </ThemedText>
                        </View>
                      </View>
                    );
                  })}
                </View>
                {/* Scrollable stats */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator
                  style={styles.rotationStatsScroll}
                >
                  <View>
                    <View
                      style={[
                        styles.rotationStatsRow,
                        styles.rotationHeaderCell,
                        { borderBottomColor: c.border },
                      ]}
                    >
                      {ROT_COLS.map((col) => (
                        <View
                          key={col.key}
                          style={[
                            styles.rotationStatCol,
                            col.wide && styles.rotationStatColWide,
                          ]}
                        >
                          <ThemedText
                            type="varsitySmall"
                            style={[styles.rotationColLabel, { color: c.secondaryText }]}
                          >
                            {col.label}
                          </ThemedText>
                        </View>
                      ))}
                    </View>
                    {rotation.map((p) => (
                      <View
                        key={p.bbref_player_id}
                        style={[styles.rotationStatsRow, { borderBottomColor: c.border }]}
                      >
                        <CompactStat value={p.gp} c={c} integer />
                        <CompactStat value={p.vorp} c={c} emphasize />
                        <CompactStat value={p.mpg} c={c} />
                        <CompactStat value={p.pts_per} c={c} />
                        <CompactStat value={p.reb_per} c={c} />
                        <CompactStat value={p.ast_per} c={c} />
                        <CompactStat value={p.stl_per} c={c} />
                        <CompactStat value={p.blk_per} c={c} />
                        <CompactStat value={p.fg_pct} c={c} pct wide />
                        <CompactStat value={p.tp_pct} c={c} pct wide />
                        <CompactStat value={p.ts_pct} c={c} pct wide />
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>
            </View>
          )}

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

// Column order: identity (name + GP) → headline (VORP) → counting →
// shooting. "wide" columns reserve a bit more horizontal space for
// 3-decimal percentages that don't fit in the standard cell width.
const ROT_COLS: { key: string; label: string; wide?: boolean }[] = [
  { key: 'gp', label: 'GP' },
  { key: 'vorp', label: 'VORP' },
  { key: 'mpg', label: 'MPG' },
  { key: 'pts', label: 'PTS' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
  { key: 'stl', label: 'STL' },
  { key: 'blk', label: 'BLK' },
  { key: 'fg', label: 'FG%', wide: true },
  { key: 'tp', label: '3P%', wide: true },
  { key: 'ts', label: 'TS%', wide: true },
];

// Trim a player's name down to "F. LastName" when the full version is too
// long for the rotation table's name column. Hyphenated first names like
// "Karl-Anthony" use the first letter only: "K. Towns". Single-word names
// pass through untouched. Threshold tuned so that:
//   - "LeBron James" / "Anthony Davis" / "Kawhi Leonard" stay full
//   - "Damian Lillard" / "Cade Cunningham" / "Donovan Mitchell" abbreviate
//   - "Shai Gilgeous-Alexander" collapses to "S. Gilgeous-Alexander"
function abbreviateName(name: string, threshold = 13): string {
  if (!name || name.length <= threshold) return name;
  const parts = name.split(/\s+/);
  if (parts.length < 2) return name;
  const first = parts[0];
  const rest = parts.slice(1).join(' ');
  return `${first[0]}. ${rest}`;
}

// Single stat cell — numeric value only, no label. Header row carries the
// labels. `pct` formats as ".XXX" (no leading zero, B-Ref style); integer
// keeps GP as a plain count; otherwise 1 decimal. `emphasize` bolds VORP.
function CompactStat({
  value,
  c,
  pct,
  integer,
  emphasize,
  wide,
}: {
  value: number | null;
  c: ReturnType<typeof useArchiveColors>;
  pct?: boolean;
  integer?: boolean;
  emphasize?: boolean;
  wide?: boolean;
}) {
  const display = (() => {
    if (value == null) return '—';
    const v = Number(value);
    if (!Number.isFinite(v)) return '—';
    if (pct) return v.toFixed(3).replace(/^0/, '');
    if (integer) return String(Math.round(v));
    return v.toFixed(1);
  })();
  return (
    <View style={[styles.rotationStatCol, wide && styles.rotationStatColWide]}>
      <ThemedText
        style={[
          styles.rotationStatValue,
          { color: c.text },
          emphasize && styles.rotationStatValueBold,
        ]}
        numberOfLines={1}
      >
        {display}
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

  historyLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: s(12),
    paddingVertical: s(10),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    marginBottom: s(16),
  },
  historyLinkLabel: {
    fontSize: ms(11),
    letterSpacing: 1.2,
    fontWeight: '700',
  },
  sectionLabel: {
    fontSize: ms(11),
    letterSpacing: 1.2,
    marginBottom: s(8),
  },

  // Inline chip strip rendered inside the hero — one chip per playoff
  // round, left-to-right as series progress. Chip uses the franchise's
  // secondary color for the border/fill so it sits on the colored hero
  // without fighting the team's identity. Losses render hollow.
  pathChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(6),
    marginTop: s(4),
  },
  pathChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
    paddingHorizontal: s(8),
    paddingVertical: s(3),
    borderRadius: 999,
    borderWidth: 1,
  },
  pathChipTri: {
    fontSize: ms(11),
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  pathChipScore: {
    fontFamily: Fonts.mono,
    fontSize: ms(11),
    fontWeight: '700',
  },

  // Regular-season rotation — sticky-name table. The outer container is
  // flex-row: name column on the left (fixed), stats scroll on the right.
  // Header + data rows share explicit heights (DATA_ROW_H / HEADER_ROW_H)
  // so both columns line up vertically as the user scrolls horizontally.
  rotationTable: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    overflow: 'hidden',
  },
  rotationNameColumn: {
    width: s(116),
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  rotationStatsScroll: {
    flex: 1,
  },
  rotationNameCell: {
    height: s(32),
    paddingHorizontal: s(6),
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rotationHeaderCell: {
    height: s(24),
  },
  rotationStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: s(32),
    paddingHorizontal: s(6),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rotationNameInner: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  rotationStar: {
    marginRight: s(3),
  },
  rotationName: {
    flexShrink: 1,
    fontSize: ms(12),
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  rotationStatCol: {
    width: s(40),
    alignItems: 'center',
  },
  // Slightly wider for ".XXX" shooting percentages so the leading dot
  // doesn't crowd the column edge.
  rotationStatColWide: {
    width: s(46),
  },
  rotationColLabel: {
    fontSize: ms(9),
    letterSpacing: 0.5,
  },
  rotationStatValue: {
    fontFamily: Fonts.mono,
    fontSize: ms(12),
    fontWeight: '500',
  },
  rotationStatValueBold: {
    fontWeight: '800',
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
