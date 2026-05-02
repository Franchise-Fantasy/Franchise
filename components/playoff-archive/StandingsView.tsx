import { useMemo } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { ArchiveTeamLogo } from '@/components/playoff-archive/ArchiveTeamLogo';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Fonts } from '@/constants/Colors';
import { useArchiveColors } from '@/hooks/useArchiveColors';
import type { ArchiveStanding } from '@/types/archivePlayoff';
import { ms, s } from '@/utils/scale';

interface Props {
  standings: ArchiveStanding[];
  /** True for seasons 2020–21+ when the play-in tournament officially
   *  determined the 7/8 seeds. Pre-play-in years collapse 7–8 into the
   *  outright playoff band and 9–15 into the lottery band. */
  hasPlayIn: boolean;
  /** Number of teams per conference that made the playoffs outright.
   *  6 for the 1977-1983 12-team format, 8 for the 1984-2019 era, and
   *  6 again for 2020+ (with seeds 7-10 going through the play-in). */
  playoffSeedCutoff: number;
  onTeamTap: (franchiseId: string) => void;
}

function bandFor(
  seed: number,
  hasPlayIn: boolean,
  cutoff: number,
): 'playoff' | 'play_in' | 'lottery' {
  if (hasPlayIn) {
    if (seed <= cutoff) return 'playoff';
    if (seed <= 10) return 'play_in';
    return 'lottery';
  }
  if (seed <= cutoff) return 'playoff';
  return 'lottery';
}

export function StandingsView({ standings, hasPlayIn, playoffSeedCutoff, onTeamTap }: Props) {
  const c = useArchiveColors();

  const { east, west } = useMemo(() => {
    const east: ArchiveStanding[] = [];
    const west: ArchiveStanding[] = [];
    for (const row of standings) {
      (row.conference === 'East' ? east : west).push(row);
    }
    east.sort((a, b) => a.conference_seed - b.conference_seed);
    west.sort((a, b) => a.conference_seed - b.conference_seed);
    return { east, west };
  }, [standings]);

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      <ConferenceTable label="Eastern Conference" rows={east} hasPlayIn={hasPlayIn} playoffSeedCutoff={playoffSeedCutoff} onTeamTap={onTeamTap} c={c} />
      <View style={styles.spacer} />
      <ConferenceTable label="Western Conference" rows={west} hasPlayIn={hasPlayIn} playoffSeedCutoff={playoffSeedCutoff} onTeamTap={onTeamTap} c={c} />
    </ScrollView>
  );
}

function ConferenceTable({
  label,
  rows,
  hasPlayIn,
  playoffSeedCutoff,
  onTeamTap,
  c,
}: {
  label: string;
  rows: ArchiveStanding[];
  hasPlayIn: boolean;
  playoffSeedCutoff: number;
  onTeamTap: (franchiseId: string) => void;
  c: ReturnType<typeof useArchiveColors>;
}) {
  return (
    <View>
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

      {/* Column header */}
      <View style={[styles.columnHeader, { borderBottomColor: c.border }]}>
        <View style={styles.seedCol} />
        <View style={styles.teamCol} />
        <ThemedText style={[styles.colHeaderText, { color: c.secondaryText }]}>W</ThemedText>
        <ThemedText style={[styles.colHeaderText, { color: c.secondaryText }]}>L</ThemedText>
        <ThemedText style={[styles.colHeaderText, { color: c.secondaryText }]}>PCT</ThemedText>
      </View>

      {rows.map((row) => {
        const band = bandFor(row.conference_seed, hasPlayIn, playoffSeedCutoff);
        const isPlayoff = band === 'playoff';
        const isPlayIn = band === 'play_in';
        const pct = row.wins / Math.max(1, row.wins + row.losses);

        const seedBg =
          band === 'playoff'
            ? c.primary
            : band === 'play_in'
              ? c.heritageGold
              : c.border;
        const seedFg = band === 'lottery' ? c.secondaryText : Brand.ecru;
        const teamColor = band === 'lottery' ? c.secondaryText : c.text;

        return (
          <TouchableOpacity
            key={row.franchise_id}
            onPress={() => onTeamTap(row.franchise_id)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`${row.city} ${row.name}, seed ${row.conference_seed}, ${row.wins} and ${row.losses}`}
            style={[styles.row, { borderBottomColor: c.border }]}
          >
            <View style={[styles.seedCol]}>
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
              />
              <View style={styles.teamLabels}>
                <ThemedText
                  style={[
                    styles.teamCity,
                    {
                      color: teamColor,
                      fontWeight: isPlayoff ? '700' : '500',
                    },
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
                  {isPlayIn && '  ·  Play-In'}
                </ThemedText>
              </View>
            </View>

            <ThemedText style={[styles.statText, { color: teamColor }]}>{row.wins}</ThemedText>
            <ThemedText style={[styles.statText, { color: teamColor }]}>{row.losses}</ThemedText>
            <ThemedText style={[styles.statText, { color: teamColor }]}>
              {pct.toFixed(3).replace(/^0/, '')}
            </ThemedText>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: s(40),
  },
  spacer: { height: s(20) },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    marginBottom: s(8),
  },
  headerRule: {
    height: 2,
    width: s(18),
  },
  headerLabel: {
    fontSize: ms(12),
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
    width: s(36),
    textAlign: 'right',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(8),
    paddingHorizontal: s(2),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  seedCol: {
    width: s(32),
    alignItems: 'flex-start',
  },
  seedBadge: {
    minWidth: s(22),
    height: s(22),
    paddingHorizontal: s(4),
    borderRadius: s(11),
    alignItems: 'center',
    justifyContent: 'center',
  },
  seedText: {
    fontFamily: Fonts.mono,
    fontSize: ms(11),
    fontWeight: '700',
  },

  teamCol: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    minWidth: 0,
  },
  teamLabels: {
    flex: 1,
    minWidth: 0,
  },
  teamCity: {
    fontSize: ms(13),
    lineHeight: ms(15),
  },
  teamName: {
    fontSize: ms(10),
    lineHeight: ms(12),
    marginTop: 1,
  },

  statText: {
    fontFamily: Fonts.mono,
    fontSize: ms(13),
    width: s(36),
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
});
