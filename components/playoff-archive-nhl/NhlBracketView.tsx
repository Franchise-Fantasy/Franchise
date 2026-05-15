import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ArchiveTeamLogo } from '@/components/playoff-archive/ArchiveTeamLogo';
import { NhlSeriesDetailCard } from '@/components/playoff-archive-nhl/NhlSeriesDetailCard';
import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import { useArchiveColors } from '@/hooks/useArchiveColors';
import type {
  NhlArchiveBracket,
  NhlArchiveFranchiseSeason,
  NhlArchiveSeries,
} from '@/types/archiveNhlPlayoff';
import { prefetchSeasonLogos } from '@/utils/playoffArchive';
import { ms, s } from '@/utils/scale';

interface Props {
  bracket: NhlArchiveBracket;
  onTeamTap?: (franchiseId: string) => void;
}

// ── Bracket indexing ────────────────────────────────────────────────────────
// NHL playoff bracket maps onto a 4-R1 / 2-semi / 1-CF per-conference layout
// regardless of era — divisional (1980-93, 2014+) and conference (1994-2013)
// brackets both flatten to the same visual shape.
//
// For divisional bracket eras: series.division identifies which division
// (Atlantic/Metro/Central/Pacific in modern era; Adams/Patrick/Norris/Smythe
// pre-94; North/East/Central/West in the 2021 Canadian-division season).
// We slot R1 by division-then-position-within-division.
//
// For conference bracket era (incl. 2020 bubble): series.division is null
// and bracket_position is 0..3 directly within (conference, round=1). We
// slot R1 by bracket_position alone.
interface ConferenceBracket {
  /** R1 slots 0..3. */
  r1: (NhlArchiveSeries | undefined)[];
  /** R2 slots 0..1. */
  semi: (NhlArchiveSeries | undefined)[];
  cf: NhlArchiveSeries | null;
}

interface IndexedBracket {
  franchiseMap: Map<string, NhlArchiveFranchiseSeason>;
  east: ConferenceBracket;
  west: ConferenceBracket;
  scf: NhlArchiveSeries | null;
}

function indexBracket(bracket: NhlArchiveBracket): IndexedBracket {
  const franchiseMap = new Map<string, NhlArchiveFranchiseSeason>();
  for (const f of bracket.franchises) franchiseMap.set(f.franchise_id, f);

  const buildConf = (confName: 'East' | 'West'): ConferenceBracket => {
    const r1: (NhlArchiveSeries | undefined)[] = new Array(4).fill(undefined);
    const semi: (NhlArchiveSeries | undefined)[] = new Array(2).fill(undefined);

    // Detect divisional vs conference bracket era by checking R1 series for
    // a non-null division. If divisional, slot by alphabetical division
    // index × 2 + bracket_position. Otherwise slot by bracket_position.
    const r1Series = bracket.series.filter(
      (sr) => sr.round === 1 && sr.conference === confName,
    );
    const r2Series = bracket.series.filter(
      (sr) => sr.round === 2 && sr.conference === confName,
    );
    const isDivisional = r1Series.some((sr) => !!sr.division);

    if (isDivisional) {
      const divNames = [
        ...new Set(r1Series.map((sr) => sr.division).filter(Boolean) as string[]),
      ].sort();
      for (const sr of r1Series) {
        const di = divNames.indexOf(sr.division ?? '');
        if (di === -1) continue;
        const idx = di * 2 + sr.bracket_position;
        if (idx >= 0 && idx < 4) r1[idx] = sr;
      }
      for (const sr of r2Series) {
        const di = divNames.indexOf(sr.division ?? '');
        if (di !== -1) semi[di] = sr;
      }
    } else {
      // Conference bracket era (1994-2013, 2020). API gives the 4 R1 series
      // in order: 1v8, 2v7, 3v6, 4v5 (positions 0-3). NBA-style bracket
      // layout interleaves them so the 1-seed and 2-seed only meet in the
      // conference final: top-half = 1v8 (0) + 4v5 (3); bottom = 2v7 (1) +
      // 3v6 (2). This makes the bracket visually correct even though all
      // rounds reseed in this era.
      const visualOrder = [0, 3, 1, 2];
      for (const sr of r1Series) {
        const visual = visualOrder.indexOf(sr.bracket_position);
        if (visual !== -1) r1[visual] = sr;
      }
      for (const sr of r2Series) {
        if (sr.bracket_position >= 0 && sr.bracket_position < 2) {
          semi[sr.bracket_position] = sr;
        }
      }
    }

    const cf =
      bracket.series.find(
        (sr) => sr.round === 3 && sr.conference === confName,
      ) ?? null;
    return { r1, semi, cf };
  };

  return {
    franchiseMap,
    east: buildConf('East'),
    west: buildConf('West'),
    scf:
      bracket.series.find((sr) => sr.round === 4 && sr.conference === 'Final') ??
      null,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

export function NhlBracketView({ bracket, onTeamTap }: Props) {
  const idx = useMemo(() => indexBracket(bracket), [bracket]);

  useEffect(() => {
    // expo-image dedupes; firing per-bracket is cheap.
    prefetchSeasonLogos(bracket.franchises, 'nhl');
  }, [bracket.franchises]);

  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(
    () => idx.scf?.id ?? null,
  );

  // Reset selection when season changes.
  useEffect(() => {
    if (
      selectedSeriesId &&
      bracket.series.some((sr) => sr.id === selectedSeriesId)
    ) {
      return;
    }
    setSelectedSeriesId(idx.scf?.id ?? null);
  }, [bracket.series, idx.scf, selectedSeriesId]);

  const selectedSeries = useMemo(
    () => bracket.series.find((sr) => sr.id === selectedSeriesId) ?? null,
    [bracket.series, selectedSeriesId],
  );
  const selectedGames = useMemo(
    () =>
      selectedSeriesId
        ? bracket.games.filter((g) => g.series_id === selectedSeriesId)
        : [],
    [bracket.games, selectedSeriesId],
  );
  const selectedTotalGames = selectedGames.length;

  return (
    <View style={styles.outer}>
      <View style={styles.bracketArea}>
        {/* Top half: West R1[0,1] → West semi[0]    East semi[0] ← East R1[0,1] */}
        <HalfRow
          westR1={[idx.west.r1[0], idx.west.r1[1]]}
          westSemi={idx.west.semi[0] ?? null}
          eastSemi={idx.east.semi[0] ?? null}
          eastR1={[idx.east.r1[0], idx.east.r1[1]]}
          franchiseMap={idx.franchiseMap}
          selectedSeriesId={selectedSeriesId}
          onSelectSeries={setSelectedSeriesId}
        />

        {/* Center band: West CF | SCF | East CF */}
        <View style={styles.centerRow}>
          <View style={[styles.col, styles.r1Col]} />
          <View style={[styles.col, styles.cfCol]}>
            {idx.west.cf ? (
              <BracketCard
                series={idx.west.cf}
                franchiseMap={idx.franchiseMap}
                compact
                selected={selectedSeriesId === idx.west.cf.id}
                onSelect={setSelectedSeriesId}
              />
            ) : (
              <EmptyBracketCard compact />
            )}
          </View>
          <View style={[styles.col, styles.finalsCol]}>
            {idx.scf ? (
              <FinalsCard
                series={idx.scf}
                franchiseMap={idx.franchiseMap}
                selected={selectedSeriesId === idx.scf.id}
                onSelect={setSelectedSeriesId}
              />
            ) : (
              <EmptyFinalsCard />
            )}
          </View>
          <View style={[styles.col, styles.cfCol]}>
            {idx.east.cf ? (
              <BracketCard
                series={idx.east.cf}
                franchiseMap={idx.franchiseMap}
                compact
                selected={selectedSeriesId === idx.east.cf.id}
                onSelect={setSelectedSeriesId}
              />
            ) : (
              <EmptyBracketCard compact />
            )}
          </View>
          <View style={[styles.col, styles.r1Col]} />
        </View>

        {/* Bottom half: West R1[2,3] → West semi[1]   East semi[1] ← East R1[2,3] */}
        <HalfRow
          westR1={[idx.west.r1[2], idx.west.r1[3]]}
          westSemi={idx.west.semi[1] ?? null}
          eastSemi={idx.east.semi[1] ?? null}
          eastR1={[idx.east.r1[2], idx.east.r1[3]]}
          franchiseMap={idx.franchiseMap}
          selectedSeriesId={selectedSeriesId}
          onSelectSeries={setSelectedSeriesId}
        />
      </View>

      {/* Series detail card — sits below the bracket, expands upward over
          the bracket on tap. Same chrome as the NBA card. */}
      <NhlSeriesDetailCard
        series={selectedSeries}
        franchiseMap={idx.franchiseMap}
        games={selectedGames}
        totalGames={selectedTotalGames}
        onTeamTap={onTeamTap ?? (() => {})}
        connSmythe={
          bracket.year?.conn_smythe_player_name
            ? {
                playerName: bracket.year.conn_smythe_player_name,
                franchiseId: bracket.year.conn_smythe_franchise_id,
                statLine: bracket.year.conn_smythe_stat_line,
              }
            : null
        }
      />
    </View>
  );
}

// ── Half row ────────────────────────────────────────────────────────────────

function HalfRow({
  westR1,
  westSemi,
  eastSemi,
  eastR1,
  franchiseMap,
  selectedSeriesId,
  onSelectSeries,
}: {
  westR1: (NhlArchiveSeries | undefined)[];
  westSemi: NhlArchiveSeries | null;
  eastSemi: NhlArchiveSeries | null;
  eastR1: (NhlArchiveSeries | undefined)[];
  franchiseMap: Map<string, NhlArchiveFranchiseSeason>;
  selectedSeriesId: string | null;
  onSelectSeries: (id: string) => void;
}) {
  const renderR1Slot = (sr: NhlArchiveSeries | undefined, key: string, i: number) => (
    <View key={key} style={i === 0 ? styles.cardSpaceTop : styles.cardSpaceBottom}>
      {sr ? (
        <BracketCard
          series={sr}
          franchiseMap={franchiseMap}
          selected={selectedSeriesId === sr.id}
          onSelect={onSelectSeries}
        />
      ) : (
        <EmptyBracketCard />
      )}
    </View>
  );

  return (
    <View style={styles.halfRow}>
      <View style={[styles.col, styles.r1Col]}>
        {[0, 1].map((i) => renderR1Slot(westR1[i], `west-r1-${i}`, i))}
      </View>
      <View style={[styles.col, styles.cfCol, styles.semiCenter]}>
        {westSemi ? (
          <BracketCard
            series={westSemi}
            franchiseMap={franchiseMap}
            compact
            selected={selectedSeriesId === westSemi.id}
            onSelect={onSelectSeries}
          />
        ) : (
          <EmptyBracketCard compact />
        )}
      </View>
      <View style={[styles.col, styles.finalsCol]} />
      <View style={[styles.col, styles.cfCol, styles.semiCenter]}>
        {eastSemi ? (
          <BracketCard
            series={eastSemi}
            franchiseMap={franchiseMap}
            compact
            selected={selectedSeriesId === eastSemi.id}
            onSelect={onSelectSeries}
          />
        ) : (
          <EmptyBracketCard compact />
        )}
      </View>
      <View style={[styles.col, styles.r1Col]}>
        {[0, 1].map((i) => renderR1Slot(eastR1[i], `east-r1-${i}`, i))}
      </View>
    </View>
  );
}

// ── Cards ───────────────────────────────────────────────────────────────────

function BracketCard({
  series,
  franchiseMap,
  compact,
  selected,
  onSelect,
}: {
  series: NhlArchiveSeries;
  franchiseMap: Map<string, NhlArchiveFranchiseSeason>;
  compact?: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const c = useArchiveColors();
  const teamA = series.franchise_a_id ? franchiseMap.get(series.franchise_a_id) ?? null : null;
  const teamB = series.franchise_b_id ? franchiseMap.get(series.franchise_b_id) ?? null : null;
  const winnerId = series.winner_franchise_id;

  return (
    <TouchableOpacity
      onPress={() => onSelect(series.id)}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={
        teamA && teamB ? `${teamA.tricode} vs ${teamB.tricode} series` : 'Series card'
      }
      style={[
        styles.card,
        { backgroundColor: c.card, borderColor: selected ? c.gold : c.border },
        compact && styles.cardCompact,
      ]}
    >
      <TeamRow
        franchise={teamA}
        seed={series.seed_a}
        wins={series.wins_a}
        isWinner={!!winnerId && winnerId === series.franchise_a_id}
        compact={compact}
      />
      <View style={[styles.cardDivider, { backgroundColor: c.border }]} />
      <TeamRow
        franchise={teamB}
        seed={series.seed_b}
        wins={series.wins_b}
        isWinner={!!winnerId && winnerId === series.franchise_b_id}
        compact={compact}
      />
    </TouchableOpacity>
  );
}

function TeamRow({
  franchise,
  seed,
  wins,
  isWinner,
  compact,
}: {
  franchise: NhlArchiveFranchiseSeason | null;
  seed: number | null;
  wins: number;
  isWinner: boolean;
  compact?: boolean;
}) {
  const c = useArchiveColors();
  const logoSize = compact ? s(22) : s(26);

  return (
    <View
      style={[
        styles.teamRow,
        compact && styles.teamRowCompact,
        isWinner && { backgroundColor: c.goldMuted },
      ]}
    >
      {franchise ? (
        <ArchiveTeamLogo
          franchiseId={franchise.franchise_id}
          tricode={franchise.tricode}
          primaryColor={franchise.primary_color}
          secondaryColor={franchise.secondary_color}
          logoKey={franchise.logo_key}
          size={logoSize}
          sport="nhl"
        />
      ) : (
        <View style={{ width: logoSize, height: logoSize }} />
      )}
      {seed != null && (
        <ThemedText
          style={[styles.seed, compact && styles.seedCompact, { color: c.secondaryText }]}
        >
          {seed}
        </ThemedText>
      )}
      {!franchise && (
        <ThemedText
          style={[styles.seed, compact && styles.seedCompact, { color: c.secondaryText }]}
        >
          TBD
        </ThemedText>
      )}
      <View style={styles.spacer} />
      <ThemedText
        style={[
          styles.wins,
          compact && styles.winsCompact,
          { color: isWinner ? c.gold : c.secondaryText, fontWeight: isWinner ? '700' : '500' },
        ]}
      >
        {franchise ? wins : ''}
      </ThemedText>
    </View>
  );
}

function EmptyBracketCard({ compact }: { compact?: boolean }) {
  const c = useArchiveColors();
  const logoSize = compact ? s(22) : s(26);
  return (
    <View
      style={[
        styles.card,
        styles.emptyCard,
        compact && styles.cardCompact,
        { borderColor: c.border, backgroundColor: c.cardAlt },
      ]}
      accessibilityLabel="Series to be determined"
    >
      <View style={[styles.teamRow, compact && styles.teamRowCompact]}>
        <View style={{ width: logoSize, height: logoSize }} />
        <View style={styles.spacer} />
      </View>
      <View style={[styles.cardDivider, { backgroundColor: c.border }]} />
      <View style={[styles.teamRow, compact && styles.teamRowCompact]}>
        <View style={{ width: logoSize, height: logoSize }} />
        <View style={styles.spacer} />
      </View>
    </View>
  );
}

function FinalsCard({
  series,
  franchiseMap,
  selected,
  onSelect,
}: {
  series: NhlArchiveSeries;
  franchiseMap: Map<string, NhlArchiveFranchiseSeason>;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const c = useArchiveColors();
  const teamA = series.franchise_a_id ? franchiseMap.get(series.franchise_a_id) ?? null : null;
  const teamB = series.franchise_b_id ? franchiseMap.get(series.franchise_b_id) ?? null : null;
  const winnerId = series.winner_franchise_id;

  return (
    <TouchableOpacity
      onPress={() => onSelect(series.id)}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel="Stanley Cup series"
      style={[
        styles.finalsCard,
        {
          backgroundColor: c.card,
          borderColor: selected ? c.heritageGold : c.gold,
          borderWidth: 2,
        },
      ]}
    >
      <View style={styles.finalsHeader}>
        <Ionicons name="trophy-outline" size={ms(11)} color={c.gold} accessible={false} />
        <ThemedText
          type="varsitySmall"
          style={[styles.finalsLabel, { color: c.gold }]}
        >
          STANLEY CUP
        </ThemedText>
      </View>
      <TeamRow
        franchise={teamA}
        seed={series.seed_a}
        wins={series.wins_a}
        isWinner={!!winnerId && winnerId === series.franchise_a_id}
        compact
      />
      <View style={[styles.cardDivider, { backgroundColor: c.gold, opacity: 0.4 }]} />
      <TeamRow
        franchise={teamB}
        seed={series.seed_b}
        wins={series.wins_b}
        isWinner={!!winnerId && winnerId === series.franchise_b_id}
        compact
      />
    </TouchableOpacity>
  );
}

function EmptyFinalsCard() {
  const c = useArchiveColors();
  return (
    <View
      style={[
        styles.finalsCard,
        styles.emptyCard,
        { borderColor: c.gold, backgroundColor: c.cardAlt, borderWidth: 2 },
      ]}
      accessibilityLabel="Stanley Cup to be determined"
    >
      <View style={styles.finalsHeader}>
        <Ionicons name="trophy-outline" size={ms(11)} color={c.gold} accessible={false} />
        <ThemedText
          type="varsitySmall"
          style={[styles.finalsLabel, { color: c.gold }]}
        >
          STANLEY CUP
        </ThemedText>
      </View>
      <View style={[styles.teamRow, styles.teamRowCompact]}>
        <View style={{ width: s(22), height: s(22) }} />
        <View style={styles.spacer} />
      </View>
      <View style={[styles.cardDivider, { backgroundColor: c.gold, opacity: 0.4 }]} />
      <View style={[styles.teamRow, styles.teamRowCompact]}>
        <View style={{ width: s(22), height: s(22) }} />
        <View style={styles.spacer} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // No outer gap — the detail card supplies its own COLLAPSED_TOP_GAP via
  // animatedCardStyle. Matches NBA OverviewView.
  outer: { flex: 1, paddingTop: s(8), paddingBottom: s(24) },
  bracketArea: { position: 'relative', paddingHorizontal: s(2) },

  halfRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  centerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(8),
  },

  col: { justifyContent: 'flex-start' },
  r1Col: { flex: 24 },
  cfCol: { flex: 22 },
  finalsCol: { flex: 24, paddingHorizontal: s(3) },

  semiCenter: { justifyContent: 'center' },

  cardSpaceTop: { marginBottom: s(4) },
  cardSpaceBottom: {},

  card: {
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
  },
  cardCompact: { borderRadius: 6 },
  emptyCard: { borderStyle: 'dashed', opacity: 0.65 },
  cardDivider: { height: StyleSheet.hairlineWidth },

  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: s(6),
    paddingVertical: s(6),
    gap: s(4),
  },
  teamRowCompact: { paddingVertical: s(4), gap: s(3) },
  spacer: { flex: 1 },
  seed: {
    fontFamily: Fonts.mono,
    fontSize: ms(10),
    fontWeight: '600',
  },
  seedCompact: { fontSize: ms(9) },
  wins: {
    fontFamily: Fonts.mono,
    fontSize: ms(15),
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  winsCompact: { fontSize: ms(13) },

  finalsCard: {
    borderRadius: 10,
    overflow: 'hidden',
    paddingTop: s(4),
  },
  finalsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(4),
    paddingBottom: s(2),
  },
  finalsLabel: {
    fontSize: ms(8),
    letterSpacing: 1.0,
  },

});
