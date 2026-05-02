import { useMemo } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { ArchiveTeamLogo } from '@/components/playoff-archive/ArchiveTeamLogo';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Fonts } from '@/constants/Colors';
import { useArchiveColors } from '@/hooks/useArchiveColors';
import type { NhlArchiveStanding } from '@/types/archiveNhlPlayoff';
import { ms, s } from '@/utils/scale';

interface Props {
  standings: NhlArchiveStanding[];
  /** Number of teams per conference that make the playoffs.
   *  Modern NHL: top 3 in each of 2 divisions = 6 outright + 2 wild cards = 8 total per conference.
   *  Use 8 for the modern era. */
  playoffSeedCutoff: number;
  onTeamTap: (franchiseId: string) => void;
}

// Group rows by conference, then by division within each conference, then
// sort by division seed within each group. NHL standings are most legible
// laid out as four mini-tables (one per division) under each conference.
type DivisionGroup = {
  division: string;
  rows: NhlArchiveStanding[];
};

type ConferenceGroup = {
  conference: string;
  divisions: DivisionGroup[];
};

function groupByConferenceDivision(
  standings: NhlArchiveStanding[],
): ConferenceGroup[] {
  const conferences = new Map<string, Map<string, NhlArchiveStanding[]>>();
  for (const row of standings) {
    if (!conferences.has(row.conference)) {
      conferences.set(row.conference, new Map());
    }
    const divs = conferences.get(row.conference)!;
    if (!divs.has(row.division)) divs.set(row.division, []);
    divs.get(row.division)!.push(row);
  }

  const result: ConferenceGroup[] = [];
  for (const [conference, divsMap] of conferences) {
    const divisions: DivisionGroup[] = [];
    for (const [division, rows] of divsMap) {
      rows.sort((a, b) => a.division_seed - b.division_seed);
      divisions.push({ division, rows });
    }
    divisions.sort((a, b) => a.division.localeCompare(b.division));
    result.push({ conference, divisions });
  }
  // Eastern before Western when both present.
  result.sort((a, b) => a.conference.localeCompare(b.conference));
  return result;
}

export function NhlStandingsView({
  standings,
  playoffSeedCutoff,
  onTeamTap,
}: Props) {
  const c = useArchiveColors();

  const groups = useMemo(
    () => groupByConferenceDivision(standings),
    [standings],
  );

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      {groups.map((cg, i) => (
        <View key={cg.conference}>
          <ConferenceHeader label={`${cg.conference}ern Conference`} c={c} />
          {cg.divisions.map((dg) => (
            <DivisionTable
              key={`${cg.conference}-${dg.division}`}
              label={dg.division}
              rows={dg.rows}
              playoffSeedCutoff={playoffSeedCutoff}
              onTeamTap={onTeamTap}
              c={c}
            />
          ))}
          {i < groups.length - 1 && <View style={styles.spacer} />}
        </View>
      ))}
    </ScrollView>
  );
}

function ConferenceHeader({
  label,
  c,
}: {
  label: string;
  c: ReturnType<typeof useArchiveColors>;
}) {
  return (
    <View style={styles.headerRow}>
      <View style={[styles.headerRule, { backgroundColor: c.heritageGold }]} />
      <ThemedText
        type="varsity"
        style={[styles.headerLabel, { color: c.text }]}
        accessibilityRole="header"
      >
        {label}
      </ThemedText>
    </View>
  );
}

function DivisionTable({
  label,
  rows,
  playoffSeedCutoff,
  onTeamTap,
  c,
}: {
  label: string;
  rows: NhlArchiveStanding[];
  playoffSeedCutoff: number;
  onTeamTap: (franchiseId: string) => void;
  c: ReturnType<typeof useArchiveColors>;
}) {
  return (
    <View style={styles.divisionBlock}>
      <ThemedText
        type="varsitySmall"
        style={[styles.divisionLabel, { color: c.heritageGold }]}
      >
        {label}
      </ThemedText>

      <View style={[styles.columnHeader, { borderBottomColor: c.border }]}>
        <View style={styles.seedCol} />
        <View style={styles.teamCol} />
        <ThemedText style={[styles.colHeaderText, { color: c.secondaryText }]}>GP</ThemedText>
        <ThemedText style={[styles.colHeaderText, { color: c.secondaryText }]}>W</ThemedText>
        <ThemedText style={[styles.colHeaderText, { color: c.secondaryText }]}>L</ThemedText>
        <ThemedText style={[styles.colHeaderText, { color: c.secondaryText }]}>OTL</ThemedText>
        <ThemedText style={[styles.colHeaderText, { color: c.secondaryText }]}>PTS</ThemedText>
      </View>

      {rows.map((row) => {
        const inPlayoffs = row.conference_seed <= playoffSeedCutoff;
        const teamColor = inPlayoffs ? c.text : c.secondaryText;
        const seedBg = inPlayoffs ? c.primary : c.border;
        const seedFg = inPlayoffs ? Brand.ecru : c.secondaryText;
        const gp = row.wins + row.losses + row.otl;

        return (
          <TouchableOpacity
            key={row.franchise_id}
            onPress={() => onTeamTap(row.franchise_id)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`${row.city} ${row.name}, division seed ${row.division_seed}, ${row.points} points`}
            style={[styles.row, { borderBottomColor: c.border }]}
          >
            <View style={styles.seedCol}>
              <View style={[styles.seedBadge, { backgroundColor: seedBg }]}>
                <ThemedText style={[styles.seedText, { color: seedFg }]}>
                  {row.division_seed}
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
                </ThemedText>
              </View>
            </View>

            <ThemedText style={[styles.statText, { color: teamColor }]}>{gp}</ThemedText>
            <ThemedText style={[styles.statText, { color: teamColor }]}>{row.wins}</ThemedText>
            <ThemedText style={[styles.statText, { color: teamColor }]}>{row.losses}</ThemedText>
            <ThemedText style={[styles.statText, { color: teamColor }]}>{row.otl}</ThemedText>
            <ThemedText style={[styles.statText, { color: teamColor, fontWeight: '700' }]}>
              {row.points}
            </ThemedText>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: s(40) },
  spacer: { height: s(20) },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    marginBottom: s(8),
    marginTop: s(8),
  },
  headerRule: { height: 2, width: s(18) },
  headerLabel: { fontSize: ms(12) },

  divisionBlock: { marginBottom: s(14) },
  divisionLabel: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(10),
    letterSpacing: 1.4,
    marginBottom: s(4),
    paddingHorizontal: s(2),
  },

  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(6),
    paddingHorizontal: s(2),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  colHeaderText: {
    fontFamily: Fonts.mono,
    fontSize: ms(10),
    width: s(30),
    textAlign: 'right',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(8),
    paddingHorizontal: s(2),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  seedCol: { width: s(28), alignItems: 'flex-start' },
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
    width: s(30),
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
});
