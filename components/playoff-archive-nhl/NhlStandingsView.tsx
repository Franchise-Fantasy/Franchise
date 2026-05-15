import { useMemo } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { ArchiveTeamLogo } from '@/components/playoff-archive/ArchiveTeamLogo';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Fonts } from '@/constants/Colors';
import { useArchiveColors } from '@/hooks/useArchiveColors';
import type { NhlArchiveStanding } from '@/types/archiveNhlPlayoff';
import { ms, s } from '@/utils/scale';

/** How to lay out the conference standings — varies by era. */
export type StandingsDisplayMode =
  /** 2014+ wildcard format: top-3 per division + 2 wild cards per conference. */
  | 'modern_wildcard'
  /** 1994-2013 + 2020 bubble: 1-8 within each conference, no division grouping. */
  | 'conf_eight'
  /** 1980-1993 + 2020-21 Canadian-division season: top 4 per division per conf. */
  | 'divisional_top4';

interface Props {
  standings: NhlArchiveStanding[];
  displayMode: StandingsDisplayMode;
  onTeamTap: (franchiseId: string) => void;
}

interface ModernLayout {
  conference: string;
  divisions: { division: string; rows: NhlArchiveStanding[] }[]; // top 3 only
  wildcards: NhlArchiveStanding[]; // next 2 by conference seed
  outside: NhlArchiveStanding[];
}

interface ConfEightLayout {
  conference: string;
  rows: NhlArchiveStanding[]; // ordered by conf seed
  cutoff: number; // 8 (or fewer for partial standings)
}

interface DivisionalTop4Layout {
  conference: string;
  divisions: { division: string; rows: NhlArchiveStanding[] }[]; // top 4 + rest
}

function layoutModernWildcard(
  standings: NhlArchiveStanding[],
  conference: string,
): ModernLayout {
  const inConf = standings.filter((s) => s.conference === conference);
  const divNames = [...new Set(inConf.map((s) => s.division))].sort();
  const divisions = divNames.map((division) => ({
    division,
    rows: inConf
      .filter((s) => s.division === division)
      .sort((a, b) => a.division_seed - b.division_seed)
      .slice(0, 3),
  }));
  const autoIds = new Set(divisions.flatMap((d) => d.rows.map((r) => r.franchise_id)));
  const remaining = inConf
    .filter((s) => !autoIds.has(s.franchise_id))
    .sort((a, b) => a.conference_seed - b.conference_seed);
  return {
    conference,
    divisions,
    wildcards: remaining.slice(0, 2),
    outside: remaining.slice(2),
  };
}

function layoutConfEight(
  standings: NhlArchiveStanding[],
  conference: string,
): ConfEightLayout {
  const rows = standings
    .filter((s) => s.conference === conference)
    .sort((a, b) => a.conference_seed - b.conference_seed);
  return { conference, rows, cutoff: 8 };
}

function layoutDivisionalTop4(
  standings: NhlArchiveStanding[],
  conference: string,
): DivisionalTop4Layout {
  const inConf = standings.filter((s) => s.conference === conference);
  const divNames = [...new Set(inConf.map((s) => s.division))].sort();
  const divisions = divNames.map((division) => ({
    division,
    rows: inConf
      .filter((s) => s.division === division)
      .sort((a, b) => a.division_seed - b.division_seed),
  }));
  return { conference, divisions };
}

export function NhlStandingsView({ standings, displayMode, onTeamTap }: Props) {
  const c = useArchiveColors();

  // Conferences are derived from the data so old eras with non-standard
  // conf names ('Wales', 'Campbell') and the bubble year render correctly.
  const conferences = useMemo(() => {
    const names = [...new Set(standings.map((s) => s.conference).filter(Boolean))].sort();
    // East before West when both present.
    return names;
  }, [standings]);

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      {conferences.map((conf, i) => {
        const label = conferenceDisplayLabel(conf);
        if (displayMode === 'modern_wildcard') {
          return (
            <View key={conf}>
              {i > 0 && <View style={styles.spacer} />}
              <ModernConferenceColumn
                label={label}
                layout={layoutModernWildcard(standings, conf)}
                onTeamTap={onTeamTap}
                c={c}
              />
            </View>
          );
        }
        if (displayMode === 'conf_eight') {
          return (
            <View key={conf}>
              {i > 0 && <View style={styles.spacer} />}
              <ConfEightColumn
                label={label}
                layout={layoutConfEight(standings, conf)}
                onTeamTap={onTeamTap}
                c={c}
              />
            </View>
          );
        }
        return (
          <View key={conf}>
            {i > 0 && <View style={styles.spacer} />}
            <DivisionalTop4Column
              label={label}
              layout={layoutDivisionalTop4(standings, conf)}
              onTeamTap={onTeamTap}
              c={c}
            />
          </View>
        );
      })}
    </ScrollView>
  );
}

function conferenceDisplayLabel(conf: string): string {
  if (conf === 'East') return 'Eastern Conference';
  if (conf === 'West') return 'Western Conference';
  return conf;
}

function ConferenceHeader({
  label,
  c,
}: {
  label: string;
  c: ReturnType<typeof useArchiveColors>;
}) {
  return (
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
      <ThemedText style={[styles.colHeaderText, { color: c.secondaryText }]}>GP</ThemedText>
      <ThemedText style={[styles.colHeaderText, { color: c.secondaryText }]}>W</ThemedText>
      <ThemedText style={[styles.colHeaderText, { color: c.secondaryText }]}>L</ThemedText>
      <ThemedText style={[styles.colHeaderText, { color: c.secondaryText }]}>OTL</ThemedText>
      <ThemedText style={[styles.colHeaderText, { color: c.secondaryText }]}>PTS</ThemedText>
    </View>
  );
}

function ModernConferenceColumn({
  label,
  layout,
  onTeamTap,
  c,
}: {
  label: string;
  layout: ModernLayout;
  onTeamTap: (franchiseId: string) => void;
  c: ReturnType<typeof useArchiveColors>;
}) {
  return (
    <View>
      <ConferenceHeader label={label} c={c} />

      {layout.divisions.map((dg) => (
        <Section key={dg.division} title={dg.division} c={c}>
          {dg.rows.map((row, i) => (
            <StandingRow
              key={row.franchise_id}
              row={row}
              displaySeed={i + 1}
              variant="playoff"
              onPress={() => onTeamTap(row.franchise_id)}
              c={c}
            />
          ))}
        </Section>
      ))}

      {layout.wildcards.length > 0 && (
        <Section title="Wild Card" c={c}>
          {layout.wildcards.map((row, i) => (
            <StandingRow
              key={row.franchise_id}
              row={row}
              displaySeed={`WC${i + 1}`}
              variant="playoff"
              onPress={() => onTeamTap(row.franchise_id)}
              c={c}
            />
          ))}
        </Section>
      )}

      {layout.outside.length > 0 && (
        <Section title="Out of Playoffs" c={c}>
          {layout.outside.map((row) => (
            <StandingRow
              key={row.franchise_id}
              row={row}
              displaySeed={row.conference_seed}
              variant="lottery"
              onPress={() => onTeamTap(row.franchise_id)}
              c={c}
            />
          ))}
        </Section>
      )}
    </View>
  );
}

// 1994-2013 + 2020 bubble: just 1-8 inside the conference, no division
// grouping. Top 8 highlighted with a "Playoffs" / "Out" divider.
function ConfEightColumn({
  label,
  layout,
  onTeamTap,
  c,
}: {
  label: string;
  layout: ConfEightLayout;
  onTeamTap: (franchiseId: string) => void;
  c: ReturnType<typeof useArchiveColors>;
}) {
  const playoff = layout.rows.slice(0, layout.cutoff);
  const outside = layout.rows.slice(layout.cutoff);
  return (
    <View>
      <ConferenceHeader label={label} c={c} />
      <Section title="Playoffs" c={c}>
        {playoff.map((row, i) => (
          <StandingRow
            key={row.franchise_id}
            row={row}
            displaySeed={i + 1}
            variant="playoff"
            onPress={() => onTeamTap(row.franchise_id)}
            c={c}
          />
        ))}
      </Section>
      {outside.length > 0 && (
        <Section title="Out of Playoffs" c={c}>
          {outside.map((row, i) => (
            <StandingRow
              key={row.franchise_id}
              row={row}
              displaySeed={layout.cutoff + i + 1}
              variant="lottery"
              onPress={() => onTeamTap(row.franchise_id)}
              c={c}
            />
          ))}
        </Section>
      )}
    </View>
  );
}

// 1980-1993 + 2020-21 Canadian-division season: top 4 per division per
// conference make the playoffs (no wildcards). Divisions stacked.
function DivisionalTop4Column({
  label,
  layout,
  onTeamTap,
  c,
}: {
  label: string;
  layout: DivisionalTop4Layout;
  onTeamTap: (franchiseId: string) => void;
  c: ReturnType<typeof useArchiveColors>;
}) {
  return (
    <View>
      <ConferenceHeader label={label} c={c} />
      {layout.divisions.map((dg) => (
        <Section key={dg.division} title={dg.division} c={c}>
          {dg.rows.map((row, i) => (
            <StandingRow
              key={row.franchise_id}
              row={row}
              displaySeed={i + 1}
              variant={i < 4 ? 'playoff' : 'lottery'}
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
  displaySeed,
  variant,
  onPress,
  c,
}: {
  row: NhlArchiveStanding;
  displaySeed: number | string;
  variant: 'playoff' | 'lottery';
  onPress: () => void;
  c: ReturnType<typeof useArchiveColors>;
}) {
  const inPlayoffs = variant === 'playoff';
  const teamColor = inPlayoffs ? c.text : c.secondaryText;
  const seedBg = inPlayoffs ? c.primary : c.border;
  const seedFg = inPlayoffs ? Brand.ecru : c.secondaryText;
  const gp = row.wins + row.losses + row.otl;
  const seedLabel = String(displaySeed);

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${row.city} ${row.name}, ${seedLabel}, ${row.points} points`}
      style={[styles.row, { borderBottomColor: c.border }]}
    >
      <View style={styles.seedCol}>
        <View style={[styles.seedBadge, { backgroundColor: seedBg }]}>
          <ThemedText style={[styles.seedText, { color: seedFg }]}>
            {seedLabel}
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
          sport="nhl"
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
  seedCol: { width: s(36), alignItems: 'flex-start' },
  seedBadge: {
    minWidth: s(28),
    height: s(22),
    paddingHorizontal: s(5),
    borderRadius: s(11),
    alignItems: 'center',
    justifyContent: 'center',
  },
  seedText: { fontFamily: Fonts.mono, fontSize: ms(10), fontWeight: '700' },

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
