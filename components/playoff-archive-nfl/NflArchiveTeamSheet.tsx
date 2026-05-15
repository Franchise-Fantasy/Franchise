import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ArchiveTeamLogo } from '@/components/playoff-archive/ArchiveTeamLogo';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Fonts } from '@/constants/Colors';
import { useArchiveColors } from '@/hooks/useArchiveColors';
import {
  useNflArchiveAwards,
  useNflArchiveTeamRun,
} from '@/hooks/useNflArchivePlayoffs';
import type {
  NflArchiveAwardEntry,
  NflArchiveSeries,
  NflAwardType,
} from '@/types/archiveNflPlayoff';
import { ms, s } from '@/utils/scale';

interface Props {
  season: number | null;
  franchiseId: string | null;
  onClose: () => void;
}

const ROUND_NAME: Record<number, string> = {
  1: 'Wild Card',
  2: 'Divisional Round',
  3: 'Conference Championship',
  4: 'Super Bowl',
};

// "Lost in Divisional Round to KC 27-24" — short summary line for the
// franchise's playoff path.
function summarize(
  series: NflArchiveSeries[],
  franchiseId: string,
  champion: boolean,
): string {
  if (champion) return 'Super Bowl Champions';
  const lossSeries = series
    .filter((s) => s.winner_franchise_id && s.winner_franchise_id !== franchiseId)
    .sort((a, b) => b.round - a.round)[0];
  if (lossSeries) {
    const opponentId =
      lossSeries.franchise_a_id === franchiseId
        ? lossSeries.franchise_b_id
        : lossSeries.franchise_a_id;
    return `Eliminated in ${ROUND_NAME[lossSeries.round]} by ${opponentId ?? '—'}`;
  }
  if (series.length > 0) return 'Active in playoffs';
  return 'Missed the playoffs';
}

// Display order for franchise-scoped awards in the Team Sheet. Solo awards
// first, then All-Pro tiers (split by unit in the data; we surface offense +
// defense rows generically).
const TEAM_AWARD_ORDER: { type: NflAwardType; label: string }[] = [
  { type: 'mvp',            label: 'MVP' },
  { type: 'opoy',           label: 'Offensive POY' },
  { type: 'dpoy',           label: 'Defensive POY' },
  { type: 'oroy',           label: 'Offensive Rookie' },
  { type: 'droy',           label: 'Defensive Rookie' },
  { type: 'comeback',       label: 'Comeback POY' },
  { type: 'coty',           label: 'Coach of the Year' },
  { type: 'walter_payton',  label: 'Walter Payton MoY' },
  { type: 'sb_mvp',         label: 'Super Bowl MVP' },
  { type: 'all_pro_first',  label: 'All-Pro First Team' },
  { type: 'all_pro_second', label: 'All-Pro Second Team' },
];

export function NflArchiveTeamSheet({ season, franchiseId, onClose }: Props) {
  const c = useArchiveColors();
  const { data, isLoading } = useNflArchiveTeamRun(season, franchiseId);
  const { data: awards } = useNflArchiveAwards(season);

  const teamAwards = useMemo(() => {
    if (!awards || !franchiseId) return [];
    const out: { type: NflAwardType; label: string; entry: NflArchiveAwardEntry }[] = [];
    for (const { type, label } of TEAM_AWARD_ORDER) {
      const rows = awards[type];
      if (!rows) continue;
      for (const entry of rows) {
        if (entry.franchise_id === franchiseId) out.push({ type, label, entry });
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
    data?.series && franchiseId ? summarize(data.series, franchiseId, isChampion) : '';

  // W-L-T or W-L depending on whether ties matter this season.
  const recordLine = standing
    ? standing.ties > 0
      ? `${standing.wins}-${standing.losses}-${standing.ties}`
      : `${standing.wins}-${standing.losses}`
    : '';

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={f ? `${f.city} ${f.name}` : 'Team'}
      subtitle={
        standing
          ? `${standing.conference.toUpperCase()} ${standing.conference_seed} SEED · ${recordLine}`
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
          {/* Hero strip */}
          <View
            style={[styles.hero, { backgroundColor: f.primary_color ?? c.primary }]}
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
                sport="nfl"
              />
              <View style={styles.heroLabels}>
                <ThemedText
                  type="varsitySmall"
                  style={[styles.heroEyebrow, { color: f.secondary_color ?? Brand.ecru }]}
                >
                  {isChampion ? 'SUPER BOWL CHAMPION' : 'PLAYOFF RUN'}
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
                const opponentId =
                  sr.franchise_a_id === franchiseId
                    ? sr.franchise_b_id
                    : sr.franchise_a_id;
                const decided = !!sr.winner_franchise_id;
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
                        {(ROUND_NAME[sr.round] ?? `ROUND ${sr.round}`).toUpperCase()}
                      </ThemedText>
                      <ThemedText
                        style={[
                          styles.seriesOpponent,
                          { color: c.text, fontWeight: '500' },
                        ]}
                      >
                        {!decided ? 'vs' : isWin ? 'def.' : 'lost to'} {opponentId ?? '—'}
                      </ThemedText>
                    </View>
                    <View
                      style={[
                        styles.scoreBadge,
                        {
                          backgroundColor: !decided
                            ? c.cardAlt
                            : isWin
                              ? Brand.turfGreen
                              : c.cardAlt,
                        },
                      ]}
                    >
                      <ThemedText
                        style={[
                          styles.scoreText,
                          { color: isWin && decided ? Brand.ecru : c.text },
                        ]}
                      >
                        {decided ? (isWin ? 'W' : 'L') : '—'}
                      </ThemedText>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Top playoff performers — sorted by Approximate Value */}
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
                  key={p.pfr_player_id}
                  style={[styles.playerRow, { borderBottomColor: c.border }]}
                >
                  <ThemedText
                    style={[styles.playerName, { color: c.text }]}
                    numberOfLines={1}
                  >
                    {p.player_name}
                    {p.position && (
                      <ThemedText style={[styles.posTag, { color: c.heritageGold }]}>
                        {`  ${p.position}`}
                      </ThemedText>
                    )}
                  </ThemedText>
                  {p.stat_line ? (
                    <ThemedText
                      style={[styles.playerStat, { color: c.secondaryText }]}
                      numberOfLines={1}
                    >
                      {p.stat_line}
                    </ThemedText>
                  ) : (
                    <ThemedText style={[styles.playerStat, { color: c.secondaryText }]}>
                      {p.gp} GP
                    </ThemedText>
                  )}
                </View>
              ))}
            </View>
          )}

          {/* Season awards earned by this franchise's players */}
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
                  key={`${type}-${entry.unit}-${entry.rank}-${entry.player_name}`}
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
                      {entry.position && (
                        <ThemedText style={[styles.posTag, { color: c.heritageGold }]}>
                          {`  ${entry.position}`}
                        </ThemedText>
                      )}
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

const styles = StyleSheet.create({
  loading: { paddingVertical: s(40), alignItems: 'center' },

  hero: { borderRadius: 12, overflow: 'hidden', marginBottom: s(16) },
  heroRule: { height: 2, marginHorizontal: s(16), marginTop: s(8) },
  heroBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(12),
    padding: s(14),
  },
  heroLabels: { flex: 1, minWidth: 0 },
  heroEyebrow: {
    fontSize: ms(10),
    letterSpacing: 1.4,
    marginBottom: s(2),
  },
  heroSummary: { fontSize: ms(13), lineHeight: ms(17) },

  section: { marginBottom: s(16) },
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
  seriesLabelCol: { flex: 1, minWidth: 0 },
  seriesRound: { fontSize: ms(9), letterSpacing: 1.0, marginBottom: 1 },
  seriesOpponent: { fontSize: ms(13) },
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
  playerName: { flex: 1, fontSize: ms(13), minWidth: 0 },
  playerStat: { fontSize: ms(11), maxWidth: '50%', textAlign: 'right' },
  posTag: { fontSize: ms(9), fontWeight: '700', letterSpacing: 0.4 },

  awardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(8),
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: s(8),
  },
  awardLabelCol: { flex: 1, minWidth: 0 },
  awardLabel: { fontSize: ms(10), letterSpacing: 0.6 },
  awardPlayerCol: { alignItems: 'flex-end', maxWidth: '60%' },
  awardPlayer: {
    fontSize: ms(13),
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  awardStat: { fontSize: ms(10), letterSpacing: 0.2, marginTop: 2 },
});
