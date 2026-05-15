import { useMemo } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { ArchiveTeamLogo } from '@/components/playoff-archive/ArchiveTeamLogo';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Fonts } from '@/constants/Colors';
import { useArchiveColors } from '@/hooks/useArchiveColors';
import type {
  NflArchiveStanding,
  NflPlayoffFormat,
} from '@/types/archiveNflPlayoff';
import { ms, s } from '@/utils/scale';

interface Props {
  standings: NflArchiveStanding[];
  /** Bracket-format era. Drives the playoff-seed cutoff (4/5/6/7 teams per
   *  conf making the playoffs) and whether ties column is rendered. */
  format: NflPlayoffFormat | null;
  onTeamTap: (franchiseId: string) => void;
}

// Number of teams per conference that make the playoffs in each era.
// Maps directly to the conference_seed cutoff for the "in" / "out" line.
const PLAYOFF_CUTOFF: Record<NflPlayoffFormat, number> = {
  pre_merger_1966_1969: 1, // each league sends only its champion to the SB
  four_team_1970_1977:  4,
  five_team_1978_1989:  5,
  six_team_1990_2001:   6,
  six_team_2002_2019:   6,
  modern_seven_2020:    7,
};

// Which seeds get the wild card label (between the division winners and the
// "out of playoffs" cutoff). 2002+ = seeds 5..cutoff are wild cards;
// pre-2002 div alignment was different but the same numerical band holds.
function isWildCardSeed(seed: number, format: NflPlayoffFormat): boolean {
  const cutoff = PLAYOFF_CUTOFF[format];
  return seed >= 5 && seed <= cutoff;
}

function bandFor(
  seed: number,
  format: NflPlayoffFormat,
): 'division_winner' | 'wild_card' | 'out' {
  if (seed <= 4) return 'division_winner';
  if (isWildCardSeed(seed, format)) return 'wild_card';
  return 'out';
}

export function NflStandingsView({ standings, format, onTeamTap }: Props) {
  const c = useArchiveColors();
  const fmt: NflPlayoffFormat = format ?? 'modern_seven_2020';

  // Conferences derived from the data so old eras (AFL/NFL pre-merger,
  // AFC/NFC post-merger) render correctly without hard-coding.
  const conferences = useMemo(() => {
    const names = [...new Set(standings.map((s) => s.conference).filter(Boolean))];
    // AFC before NFC, AFL before NFL — alphabetical happens to do this.
    return names.sort();
  }, [standings]);

  const showTies = useMemo(() => standings.some((s) => s.ties > 0), [standings]);

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      {conferences.map((conf, i) => (
        <View key={conf}>
          {i > 0 && <View style={styles.spacer} />}
          <ConferenceTable
            label={conferenceDisplayLabel(conf)}
            rows={standings.filter((s) => s.conference === conf)}
            format={fmt}
            showTies={showTies}
            onTeamTap={onTeamTap}
            c={c}
          />
        </View>
      ))}
    </ScrollView>
  );
}

function conferenceDisplayLabel(conf: string): string {
  if (conf === 'AFC') return 'American Football Conference';
  if (conf === 'NFC') return 'National Football Conference';
  if (conf === 'AFL') return 'American Football League';
  if (conf === 'NFL') return 'National Football League';
  return conf;
}

function ConferenceTable({
  label,
  rows,
  format,
  showTies,
  onTeamTap,
  c,
}: {
  label: string;
  rows: NflArchiveStanding[];
  format: NflPlayoffFormat;
  showTies: boolean;
  onTeamTap: (franchiseId: string) => void;
  c: ReturnType<typeof useArchiveColors>;
}) {
  // Group by division. Order divisions alphabetically (East/North/South/West
  // sorts cleanly modern, AFL East/West likewise). Within division, order by
  // division_seed.
  const divisions = useMemo(() => {
    const names = [...new Set(rows.map((r) => r.division))].sort();
    return names.map((division) => ({
      division,
      rows: rows
        .filter((r) => r.division === division)
        .sort((a, b) => a.division_seed - b.division_seed),
    }));
  }, [rows]);

  return (
    <View>
      <View style={[styles.headerRow, { borderBottomColor: c.border }]}>
        <View style={[styles.headerRule, { backgroundColor: c.heritageGold }]} />
        <ThemedText
          type="varsity"
          style={[styles.headerLabel, { color: c.text }]}
          accessibilityRole="header"
        >
          {label}
        </ThemedText>
        <View style={styles.headerSpacer} />
        <ThemedText style={[styles.colHeaderText, { color: c.secondaryText }]}>W</ThemedText>
        <ThemedText style={[styles.colHeaderText, { color: c.secondaryText }]}>L</ThemedText>
        {showTies && (
          <ThemedText style={[styles.colHeaderText, { color: c.secondaryText }]}>T</ThemedText>
        )}
        <ThemedText style={[styles.colHeaderText, { color: c.secondaryText }]}>PF</ThemedText>
        <ThemedText style={[styles.colHeaderText, { color: c.secondaryText }]}>PA</ThemedText>
      </View>

      {divisions.map((dg) => (
        <Section key={dg.division} title={dg.division} c={c}>
          {dg.rows.map((row) => (
            <StandingRow
              key={row.franchise_id}
              row={row}
              band={bandFor(row.conference_seed, format)}
              showTies={showTies}
              onPress={() => onTeamTap(row.franchise_id)}
              c={c}
            />
          ))}
        </Section>
      ))}
    </View>
  );
}

function Section({
  title,
  children,
  c,
}: {
  title: string;
  children: React.ReactNode;
  c: ReturnType<typeof useArchiveColors>;
}) {
  return (
    <View style={styles.divisionBlock}>
      <ThemedText
        type="varsitySmall"
        style={[styles.divisionLabel, { color: c.heritageGold }]}
      >
        {title}
      </ThemedText>
      {children}
    </View>
  );
}

function StandingRow({
  row,
  band,
  showTies,
  onPress,
  c,
}: {
  row: NflArchiveStanding;
  band: 'division_winner' | 'wild_card' | 'out';
  showTies: boolean;
  onPress: () => void;
  c: ReturnType<typeof useArchiveColors>;
}) {
  const inPlayoffs = band !== 'out';
  const teamColor = inPlayoffs ? c.text : c.secondaryText;
  const seedBg =
    band === 'division_winner'
      ? c.primary
      : band === 'wild_card'
        ? c.heritageGold
        : c.border;
  const seedFg = band === 'out' ? c.secondaryText : Brand.ecru;

  const tiesLabel =
    row.ties > 0 ? `, ${row.ties} ties` : '';

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${row.city} ${row.name}, conference seed ${row.conference_seed}, ${row.wins} and ${row.losses}${tiesLabel}`}
      style={[styles.row, { borderBottomColor: c.border }]}
    >
      <View style={styles.seedCol}>
        <View style={[styles.seedBadge, { backgroundColor: seedBg }]}>
          <ThemedText style={[styles.seedText, { color: seedFg }]}>
            {row.conference_seed}
          </ThemedText>
        </View>
      </View>

      <View style={styles.teamCol}>
        <ArchiveTeamLogo
          franchiseId={row.franchise_id}
          tricode={row.tricode}
          primaryColor={row.primary_color}
          secondaryColor={row.secondary_color}
          logoKey={row.logo_key}
          size={s(28)}
          sport="nfl"
        />
        <View style={styles.teamLabels}>
          <ThemedText
            style={[
              styles.teamCity,
              { color: teamColor, fontWeight: inPlayoffs ? '700' : '500' },
            ]}
            numberOfLines={1}
          >
            {row.city}
          </ThemedText>
          <ThemedText
            style={[styles.teamName, { color: c.secondaryText }]}
            numberOfLines={1}
          >
            {row.name}
            {band === 'wild_card' && '  ·  Wild Card'}
          </ThemedText>
        </View>
      </View>

      <ThemedText style={[styles.statText, { color: teamColor }]}>{row.wins}</ThemedText>
      <ThemedText style={[styles.statText, { color: teamColor }]}>{row.losses}</ThemedText>
      {showTies && (
        <ThemedText style={[styles.statText, { color: teamColor }]}>{row.ties}</ThemedText>
      )}
      <ThemedText style={[styles.statText, { color: teamColor }]}>
        {row.points_for ?? '—'}
      </ThemedText>
      <ThemedText style={[styles.statText, { color: teamColor }]}>
        {row.points_against ?? '—'}
      </ThemedText>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: s(40) },
  spacer: { height: s(20) },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    marginBottom: s(4),
    marginTop: s(8),
    paddingBottom: s(6),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerRule: { height: 2, width: s(18) },
  headerLabel: { fontSize: ms(12) },
  headerSpacer: { flex: 1, minWidth: 0 },

  divisionBlock: { marginBottom: s(14) },
  divisionLabel: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(10),
    letterSpacing: 1.4,
    marginBottom: s(4),
    paddingHorizontal: s(2),
  },

  colHeaderText: {
    fontFamily: Fonts.mono,
    fontSize: ms(10),
    width: s(28),
    textAlign: 'right',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(8),
    paddingHorizontal: s(2),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  seedCol: { width: s(32), alignItems: 'flex-start' },
  seedBadge: {
    minWidth: s(22),
    height: s(22),
    paddingHorizontal: s(4),
    borderRadius: s(11),
    alignItems: 'center',
    justifyContent: 'center',
  },
  seedText: { fontFamily: Fonts.mono, fontSize: ms(11), fontWeight: '700' },

  teamCol: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    minWidth: 0,
  },
  teamLabels: { flex: 1, minWidth: 0 },
  teamCity: { fontSize: ms(13), lineHeight: ms(15) },
  teamName: { fontSize: ms(10), lineHeight: ms(12), marginTop: 1 },

  statText: {
    fontFamily: Fonts.mono,
    fontSize: ms(12),
    width: s(28),
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
});
