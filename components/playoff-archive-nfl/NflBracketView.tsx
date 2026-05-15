import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ArchiveTeamLogo } from '@/components/playoff-archive/ArchiveTeamLogo';
import { NflSeriesDetailCard } from '@/components/playoff-archive-nfl/NflSeriesDetailCard';
import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import { useArchiveColors } from '@/hooks/useArchiveColors';
import type {
  NflArchiveBracket,
  NflArchiveFranchiseSeason,
  NflArchiveGame,
  NflArchiveSeries,
} from '@/types/archiveNflPlayoff';
import { prefetchSeasonLogos } from '@/utils/playoffArchive';
import { ms, s } from '@/utils/scale';

interface Props {
  bracket: NflArchiveBracket;
  onTeamTap: (franchiseId: string) => void;
}

type ByeInfo = { franchise: NflArchiveFranchiseSeason; seed: number } | undefined;
type WcSlot = NflArchiveSeries | undefined; // undefined = no card rendered

// ─── Bracket indexing ──────────────────────────────────────────────────────
// NFL post-merger has up to 3 Wild Card games per conf, 2 Divisional, 1
// Conference Championship, plus the Super Bowl. Pre-merger has just AFL
// Championship + NFL Championship + Super Bowl.
//
// Byes work like NBA pre-1984: a team that appears in Round 2 (Div) but
// didn't play in Round 1 (WC) had a bye. Show a "BYE" card in the WC slot
// position. Modern NFL: #1 seed bye. 1990-2019 6-team era: #1 and #2 seed
// byes. 1978-1989 5-team era: #1 seed bye (only 1 WC game).

interface IndexedBracket {
  franchiseMap: Map<string, NflArchiveFranchiseSeason>;
  isPreMerger: boolean;
  /** Top half: r1 slots feeding Div[0]. Length 2 when era has ≥2 R1 things,
   *  shorter when fewer (e.g. 5-team era top half has only 1 thing — bye).
   *  Indexed visually top-to-bottom. */
  afcTop: { r1: WcSlot[]; r1Byes: ByeInfo[] };
  afcBot: { r1: WcSlot[]; r1Byes: ByeInfo[] };
  nfcTop: { r1: WcSlot[]; r1Byes: ByeInfo[] };
  nfcBot: { r1: WcSlot[]; r1Byes: ByeInfo[] };
  afcDiv: [NflArchiveSeries | null, NflArchiveSeries | null];
  nfcDiv: [NflArchiveSeries | null, NflArchiveSeries | null];
  afcCc: NflArchiveSeries | null;
  nfcCc: NflArchiveSeries | null;
  // Pre-merger: AFL CG, NFL CG, SB
  aflCc: NflArchiveSeries | null;
  nflCc: NflArchiveSeries | null;
  sb: NflArchiveSeries | null;
  gameForSeries: Map<string, NflArchiveGame>;
}

// Detect bye teams: teams in Div round that didn't play in any WC game.
// Returns sorted by seed (lowest first = highest seed-quality).
function detectByes(
  wc: NflArchiveSeries[],
  div: NflArchiveSeries[],
  fmap: Map<string, NflArchiveFranchiseSeason>,
): ByeInfo[] {
  const wcTeams = new Set<string>();
  for (const w of wc) {
    if (w.franchise_a_id) wcTeams.add(w.franchise_a_id);
    if (w.franchise_b_id) wcTeams.add(w.franchise_b_id);
  }
  const byes: { franchise: NflArchiveFranchiseSeason; seed: number }[] = [];
  for (const d of div) {
    for (const side of ['a', 'b'] as const) {
      const fid = side === 'a' ? d.franchise_a_id : d.franchise_b_id;
      const seed = side === 'a' ? d.seed_a : d.seed_b;
      if (!fid || seed == null) continue;
      // True bye: didn't play in WC AND has a real seed (1-7)
      if (!wcTeams.has(fid)) {
        const f = fmap.get(fid);
        if (f && !byes.some((b) => b.franchise.franchise_id === fid)) {
          byes.push({ franchise: f, seed });
        }
      }
    }
  }
  byes.sort((a, b) => a.seed - b.seed);
  return byes;
}

// Compute R1 slot layout for one conference. Always 4 fixed slots top-to-bottom:
//   Slot 0: #1 BYE
//   Slot 1: #4 vs #5
//   Slot 2: #2 BYE (legacy 6-team eras) OR #2 vs #7 (modern 7-team)
//   Slot 3: #3 vs #6
// Top half = slots 0+1, bottom half = slots 2+3. This matches NBA pre-1984
// bracket placement except slots 2 and 3 are swapped (user preference: #2
// directly above #3 vs #6).
function layoutConf(
  wc: NflArchiveSeries[],
  byes: ByeInfo[],
): {
  top: { r1: WcSlot[]; r1Byes: ByeInfo[] };
  bot: { r1: WcSlot[]; r1Byes: ByeInfo[] };
} {
  const findWc = (sa: number, sb: number) =>
    wc.find(
      (w) =>
        (w.seed_a === sa && w.seed_b === sb) ||
        (w.seed_a === sb && w.seed_b === sa),
    );
  const findBye = (seed: number) => byes.find((b) => !!b && b.seed === seed);

  const slot0Bye = findBye(1);
  const slot1Wc = findWc(4, 5);
  const slot2Bye = findBye(2);
  const slot2Wc = findWc(2, 7); // modern only
  const slot3Wc = findWc(3, 6);
  const slot3Bye = findBye(3); // 5-team era #3 had a bye through WC too

  // 4-team era / pre-merger fallback: all slots empty.
  if (!slot0Bye && !slot1Wc && !slot2Bye && !slot2Wc && !slot3Wc && !slot3Bye) {
    return { top: { r1: [], r1Byes: [] }, bot: { r1: [], r1Byes: [] } };
  }

  return {
    top: {
      r1: [undefined, slot1Wc],
      r1Byes: [slot0Bye, undefined],
    },
    bot: {
      r1: [slot2Wc, slot3Wc],
      r1Byes: [slot2Bye, slot3Bye],
    },
  };
}

function indexBracket(bracket: NflArchiveBracket): IndexedBracket {
  const fmap = new Map<string, NflArchiveFranchiseSeason>();
  for (const f of bracket.franchises) fmap.set(f.franchise_id, f);

  const isPreMerger = bracket.year?.format === 'pre_merger_1966_1969';

  const afcWcArr = bracket.series
    .filter((s) => s.round === 1 && s.conference === 'AFC')
    .sort((a, b) => a.bracket_position - b.bracket_position);
  const nfcWcArr = bracket.series
    .filter((s) => s.round === 1 && s.conference === 'NFC')
    .sort((a, b) => a.bracket_position - b.bracket_position);
  const afcDivArr = bracket.series
    .filter((s) => s.round === 2 && s.conference === 'AFC')
    .sort((a, b) => a.bracket_position - b.bracket_position);
  const nfcDivArr = bracket.series
    .filter((s) => s.round === 2 && s.conference === 'NFC')
    .sort((a, b) => a.bracket_position - b.bracket_position);
  const afcCc = bracket.series.find((s) => s.round === 3 && s.conference === 'AFC') ?? null;
  const nfcCc = bracket.series.find((s) => s.round === 3 && s.conference === 'NFC') ?? null;
  const aflCc = bracket.series.find((s) => s.round === 3 && s.conference === 'AFL') ?? null;
  const nflCc = bracket.series.find((s) => s.round === 3 && s.conference === 'NFL') ?? null;
  const sb = bracket.series.find((s) => s.round === 4) ?? null;

  const afcByes = isPreMerger ? [] : detectByes(afcWcArr, afcDivArr, fmap);
  const nfcByes = isPreMerger ? [] : detectByes(nfcWcArr, nfcDivArr, fmap);

  // Order Div games so the one containing a bye team (the highest-seed bye
  // = #1) is the "top" Div game. This makes the top half of the bracket
  // (bye + WC slot → Div[0]) visually correct.
  function orderDiv(div: NflArchiveSeries[], byes: ByeInfo[]): NflArchiveSeries[] {
    if (div.length < 2 || byes.length === 0) return div;
    const lowestSeedBye = byes[0]?.seed; // lowest seed number = best
    const idx = div.findIndex(
      (d) =>
        d.seed_a === lowestSeedBye || d.seed_b === lowestSeedBye,
    );
    if (idx <= 0) return div;
    return [div[idx], ...div.filter((_, i) => i !== idx)];
  }
  const afcDivOrdered = orderDiv(afcDivArr, afcByes);
  const nfcDivOrdered = orderDiv(nfcDivArr, nfcByes);

  const afcLayout = layoutConf(afcWcArr, afcByes);
  const nfcLayout = layoutConf(nfcWcArr, nfcByes);

  const gameForSeries = new Map<string, NflArchiveGame>();
  for (const g of bracket.games) {
    if (!gameForSeries.has(g.series_id)) gameForSeries.set(g.series_id, g);
  }

  return {
    franchiseMap: fmap,
    isPreMerger,
    afcTop: afcLayout.top,
    afcBot: afcLayout.bot,
    nfcTop: nfcLayout.top,
    nfcBot: nfcLayout.bot,
    afcDiv: [afcDivOrdered[0] ?? null, afcDivOrdered[1] ?? null],
    nfcDiv: [nfcDivOrdered[0] ?? null, nfcDivOrdered[1] ?? null],
    afcCc,
    nfcCc,
    aflCc,
    nflCc,
    sb,
    gameForSeries,
  };
}

// ─── Main view ─────────────────────────────────────────────────────────────
export function NflBracketView({ bracket, onTeamTap }: Props) {
  const c = useArchiveColors();
  const idx = useMemo(() => indexBracket(bracket), [bracket]);
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);

  useEffect(() => {
    if (bracket.franchises?.length) {
      prefetchSeasonLogos(bracket.franchises, 'nfl');
    }
  }, [bracket.franchises]);

  const defaultSelected = idx.sb?.id ?? idx.afcCc?.id ?? null;
  useEffect(() => {
    if (selectedSeriesId && bracket.series.some((sr) => sr.id === selectedSeriesId)) return;
    setSelectedSeriesId(defaultSelected);
  }, [bracket.series, defaultSelected, selectedSeriesId]);

  if (bracket.series.length === 0) {
    return (
      <View style={styles.empty}>
        <ThemedText style={{ color: c.secondaryText, textAlign: 'center' }}>
          Bracket data not yet curated for this season.
        </ThemedText>
      </View>
    );
  }

  // Pre-merger: single row with AFL CG | SB | NFL CG
  if (idx.isPreMerger) {
    return (
      <View style={styles.outer}>
        <View style={styles.bracketArea}>
          <View style={styles.centerRow}>
            <View style={[styles.col, styles.cfCol]}>
              {idx.aflCc ? (
                <BracketCard
                  series={idx.aflCc}
                  franchiseMap={idx.franchiseMap}
                  gameForSeries={idx.gameForSeries}
                  selected={selectedSeriesId === idx.aflCc.id}
                  onSelect={setSelectedSeriesId}
                />
              ) : <EmptyBracketCard />}
            </View>
            <View style={[styles.col, styles.finalsCol]}>
              {idx.sb ? (
                <FinalsCard
                  series={idx.sb}
                  franchiseMap={idx.franchiseMap}
                  gameForSeries={idx.gameForSeries}
                  selected={selectedSeriesId === idx.sb.id}
                  onSelect={setSelectedSeriesId}
                />
              ) : <EmptyFinalsCard />}
            </View>
            <View style={[styles.col, styles.cfCol]}>
              {idx.nflCc ? (
                <BracketCard
                  series={idx.nflCc}
                  franchiseMap={idx.franchiseMap}
                  gameForSeries={idx.gameForSeries}
                  selected={selectedSeriesId === idx.nflCc.id}
                  onSelect={setSelectedSeriesId}
                />
              ) : <EmptyBracketCard />}
            </View>
          </View>
        </View>
        <NflSeriesDetailCard
          series={bracket.series.find((s) => s.id === selectedSeriesId) ?? null}
          game={
            selectedSeriesId
              ? idx.gameForSeries.get(selectedSeriesId) ?? null
              : null
          }
          franchiseMap={idx.franchiseMap}
          onTeamTap={onTeamTap}
          sbMvp={
            bracket.year?.sb_mvp_player_name
              ? {
                  playerName: bracket.year.sb_mvp_player_name,
                  franchiseId: bracket.year.sb_mvp_franchise_id,
                  statLine: bracket.year.sb_mvp_stat_line,
                }
              : null
          }
        />
      </View>
    );
  }

  // Post-merger 5-column tree (matches NBA OverviewView structure exactly).
  return (
    <View style={styles.outer}>
      <View style={styles.bracketArea}>
        <HalfRow
          afcR1={idx.afcTop.r1}
          afcR1Byes={idx.afcTop.r1Byes}
          afcDiv={idx.afcDiv[0]}
          nfcR1={idx.nfcTop.r1}
          nfcR1Byes={idx.nfcTop.r1Byes}
          nfcDiv={idx.nfcDiv[0]}
          franchiseMap={idx.franchiseMap}
          gameForSeries={idx.gameForSeries}
          selectedSeriesId={selectedSeriesId}
          onSelectSeries={setSelectedSeriesId}
        />

        <View style={styles.centerRow}>
          <View style={[styles.col, styles.r1Col]} />
          <View style={[styles.col, styles.cfCol]}>
            {idx.afcCc ? (
              <BracketCard
                series={idx.afcCc}
                franchiseMap={idx.franchiseMap}
                gameForSeries={idx.gameForSeries}
                compact
                selected={selectedSeriesId === idx.afcCc.id}
                onSelect={setSelectedSeriesId}
                topTeamId={idx.afcDiv[0]?.winner_franchise_id ?? null}
              />
            ) : (
              <EmptyBracketCard compact />
            )}
          </View>
          <View style={[styles.col, styles.finalsCol]}>
            {idx.sb ? (
              <FinalsCard
                series={idx.sb}
                franchiseMap={idx.franchiseMap}
                gameForSeries={idx.gameForSeries}
                selected={selectedSeriesId === idx.sb.id}
                onSelect={setSelectedSeriesId}
              />
            ) : (
              <EmptyFinalsCard />
            )}
          </View>
          <View style={[styles.col, styles.cfCol]}>
            {idx.nfcCc ? (
              <BracketCard
                series={idx.nfcCc}
                franchiseMap={idx.franchiseMap}
                gameForSeries={idx.gameForSeries}
                compact
                selected={selectedSeriesId === idx.nfcCc.id}
                onSelect={setSelectedSeriesId}
                topTeamId={idx.nfcDiv[0]?.winner_franchise_id ?? null}
              />
            ) : (
              <EmptyBracketCard compact />
            )}
          </View>
          <View style={[styles.col, styles.r1Col]} />
        </View>

        <HalfRow
          afcR1={idx.afcBot.r1}
          afcR1Byes={idx.afcBot.r1Byes}
          afcDiv={idx.afcDiv[1]}
          nfcR1={idx.nfcBot.r1}
          nfcR1Byes={idx.nfcBot.r1Byes}
          nfcDiv={idx.nfcDiv[1]}
          franchiseMap={idx.franchiseMap}
          gameForSeries={idx.gameForSeries}
          selectedSeriesId={selectedSeriesId}
          onSelectSeries={setSelectedSeriesId}
        />
      </View>

      <NflSeriesDetailCard
        series={bracket.series.find((s) => s.id === selectedSeriesId) ?? null}
        game={
          selectedSeriesId
            ? idx.gameForSeries.get(selectedSeriesId) ?? null
            : null
        }
        franchiseMap={idx.franchiseMap}
        onTeamTap={onTeamTap}
        sbMvp={
          bracket.year?.sb_mvp_player_name
            ? {
                playerName: bracket.year.sb_mvp_player_name,
                franchiseId: bracket.year.sb_mvp_franchise_id,
                statLine: bracket.year.sb_mvp_stat_line,
              }
            : null
        }
      />
    </View>
  );
}

// ─── Half row ──────────────────────────────────────────────────────────────
function HalfRow({
  afcR1,
  afcR1Byes,
  afcDiv,
  nfcR1,
  nfcR1Byes,
  nfcDiv,
  franchiseMap,
  gameForSeries,
  selectedSeriesId,
  onSelectSeries,
}: {
  afcR1: WcSlot[];
  afcR1Byes: ByeInfo[];
  afcDiv: NflArchiveSeries | null;
  nfcR1: WcSlot[];
  nfcR1Byes: ByeInfo[];
  nfcDiv: NflArchiveSeries | null;
  franchiseMap: Map<string, NflArchiveFranchiseSeason>;
  gameForSeries: Map<string, NflArchiveGame>;
  selectedSeriesId: string | null;
  onSelectSeries: (id: string) => void;
}) {
  const renderR1Slot = (
    sr: WcSlot,
    bye: ByeInfo,
    key: string,
    i: number,
  ) => (
    <View key={key} style={i === 0 ? styles.cardSpaceTop : styles.cardSpaceBottom}>
      {sr ? (
        <BracketCard
          series={sr}
          franchiseMap={franchiseMap}
          gameForSeries={gameForSeries}
          selected={selectedSeriesId === sr.id}
          onSelect={onSelectSeries}
        />
      ) : bye ? (
        <ByeCard franchise={bye.franchise} seed={bye.seed} />
      ) : null /* truly empty slot — render nothing */}
    </View>
  );

  return (
    <View style={styles.halfRow}>
      <View style={[styles.col, styles.r1Col]}>
        {afcR1.map((sr, i) => renderR1Slot(sr, afcR1Byes[i], `afc-r1-${i}`, i))}
      </View>
      <View style={[styles.col, styles.cfCol, styles.semiCenter]}>
        {afcDiv ? (
          <BracketCard
            series={afcDiv}
            franchiseMap={franchiseMap}
            gameForSeries={gameForSeries}
            compact
            selected={selectedSeriesId === afcDiv.id}
            onSelect={onSelectSeries}
          />
        ) : (
          <EmptyBracketCard compact />
        )}
      </View>
      <View style={[styles.col, styles.finalsCol]} />
      <View style={[styles.col, styles.cfCol, styles.semiCenter]}>
        {nfcDiv ? (
          <BracketCard
            series={nfcDiv}
            franchiseMap={franchiseMap}
            gameForSeries={gameForSeries}
            compact
            selected={selectedSeriesId === nfcDiv.id}
            onSelect={onSelectSeries}
          />
        ) : (
          <EmptyBracketCard compact />
        )}
      </View>
      <View style={[styles.col, styles.r1Col]}>
        {nfcR1.map((sr, i) => renderR1Slot(sr, nfcR1Byes[i], `nfc-r1-${i}`, i))}
      </View>
    </View>
  );
}

// ─── Bracket card ─────────────────────────────────────────────────────────
function BracketCard({
  series,
  franchiseMap,
  gameForSeries,
  compact,
  selected,
  onSelect,
  topTeamId,
}: {
  series: NflArchiveSeries;
  franchiseMap: Map<string, NflArchiveFranchiseSeason>;
  gameForSeries: Map<string, NflArchiveGame>;
  compact?: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
  /** Override which team appears on top of the card. Defaults to higher
   *  seed (lower seed number) for WC/Div, franchise_a otherwise. */
  topTeamId?: string | null;
}) {
  const c = useArchiveColors();
  const teamA = series.franchise_a_id ? franchiseMap.get(series.franchise_a_id) ?? null : null;
  const teamB = series.franchise_b_id ? franchiseMap.get(series.franchise_b_id) ?? null : null;
  const game = gameForSeries.get(series.id) ?? null;
  const aIsHome = !!game && !!teamA && game.home_franchise_id === teamA.franchise_id;
  const aScore = game ? (aIsHome ? game.home_score : game.away_score) : null;
  const bScore = game ? (aIsHome ? game.away_score : game.home_score) : null;
  const winnerId = series.winner_franchise_id;

  // Decide which team appears in the top row.
  const aFirst = (() => {
    if (topTeamId) return topTeamId === series.franchise_a_id;
    // WC + Div default: higher seed (lower seed number) on top.
    if (
      (series.round === 1 || series.round === 2) &&
      series.seed_a != null &&
      series.seed_b != null
    ) {
      return series.seed_a < series.seed_b;
    }
    return true; // a-then-b
  })();

  const topTeam = aFirst ? teamA : teamB;
  const topSeed = aFirst ? series.seed_a : series.seed_b;
  const topScore = aFirst ? aScore : bScore;
  const topIsWinner = !!winnerId && winnerId === (aFirst ? series.franchise_a_id : series.franchise_b_id);

  const botTeam = aFirst ? teamB : teamA;
  const botSeed = aFirst ? series.seed_b : series.seed_a;
  const botScore = aFirst ? bScore : aScore;
  const botIsWinner = !!winnerId && winnerId === (aFirst ? series.franchise_b_id : series.franchise_a_id);

  return (
    <TouchableOpacity
      onPress={() => onSelect(series.id)}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={
        teamA && teamB ? `${teamA.tricode} vs ${teamB.tricode} game` : 'Series card'
      }
      style={[
        styles.card,
        { backgroundColor: c.card, borderColor: selected ? c.gold : c.border },
        compact && styles.cardCompact,
      ]}
    >
      <TeamRow
        franchise={topTeam}
        seed={topSeed}
        score={topScore}
        isWinner={topIsWinner}
        compact={compact}
      />
      <View style={[styles.cardDivider, { backgroundColor: c.border }]} />
      <TeamRow
        franchise={botTeam}
        seed={botSeed}
        score={botScore}
        isWinner={botIsWinner}
        compact={compact}
      />
    </TouchableOpacity>
  );
}

function TeamRow({
  franchise,
  seed,
  score,
  isWinner,
  compact,
}: {
  franchise: NflArchiveFranchiseSeason | null;
  seed: number | null;
  score: number | null;
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
          sport="nfl"
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
      <View style={styles.spacer} />
      <ThemedText
        style={[
          styles.wins,
          compact && styles.winsCompact,
          { color: isWinner ? c.gold : c.secondaryText, fontWeight: isWinner ? '700' : '500' },
        ]}
      >
        {franchise && score != null ? score : ''}
      </ThemedText>
    </View>
  );
}

// ─── Bye card (NBA pre-1984 style) ────────────────────────────────────────
// A team that earned a bye through the Wild Card round. Renders the same
// dimensions as a BracketCard so the bracket retains its shape; second row
// carries a "BYE" eyebrow instead of an opponent. Non-interactive.
function ByeCard({
  franchise,
  seed,
}: {
  franchise: NflArchiveFranchiseSeason;
  seed: number;
}) {
  const c = useArchiveColors();
  return (
    <View
      style={[styles.card, { borderColor: c.border, backgroundColor: c.cardAlt }]}
      accessibilityLabel={`${franchise.tricode} bye to Divisional Round`}
    >
      <View style={styles.teamRow}>
        <ArchiveTeamLogo
          franchiseId={franchise.franchise_id}
          tricode={franchise.tricode}
          primaryColor={franchise.primary_color}
          secondaryColor={franchise.secondary_color}
          logoKey={franchise.logo_key}
          size={s(26)}
          sport="nfl"
        />
        <ThemedText style={[styles.seed, { color: c.secondaryText }]}>{seed}</ThemedText>
        <View style={styles.spacer} />
      </View>
      <View style={[styles.cardDivider, { backgroundColor: c.border }]} />
      <View style={[styles.teamRow, styles.byeRow]}>
        <ThemedText
          type="varsitySmall"
          style={[styles.byeLabel, { color: c.secondaryText }]}
        >
          BYE
        </ThemedText>
      </View>
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

function EmptyFinalsCard() {
  const c = useArchiveColors();
  return (
    <View
      style={[
        styles.finalsCard,
        styles.emptyCard,
        { borderColor: c.gold, backgroundColor: c.cardAlt, borderWidth: 2 },
      ]}
    >
      <View style={styles.finalsHeader}>
        <Ionicons name="trophy-outline" size={ms(11)} color={c.gold} accessible={false} />
        <ThemedText
          type="varsitySmall"
          style={[styles.finalsLabel, { color: c.gold }]}
        >
          SUPER BOWL
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

function FinalsCard({
  series,
  franchiseMap,
  gameForSeries,
  selected,
  onSelect,
}: {
  series: NflArchiveSeries;
  franchiseMap: Map<string, NflArchiveFranchiseSeason>;
  gameForSeries: Map<string, NflArchiveGame>;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const c = useArchiveColors();
  const teamA = series.franchise_a_id ? franchiseMap.get(series.franchise_a_id) ?? null : null;
  const teamB = series.franchise_b_id ? franchiseMap.get(series.franchise_b_id) ?? null : null;
  const game = gameForSeries.get(series.id) ?? null;
  const aIsHome = !!game && !!teamA && game.home_franchise_id === teamA.franchise_id;
  const aScore = game ? (aIsHome ? game.home_score : game.away_score) : null;
  const bScore = game ? (aIsHome ? game.away_score : game.home_score) : null;
  const winnerId = series.winner_franchise_id;

  return (
    <TouchableOpacity
      onPress={() => onSelect(series.id)}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel="Super Bowl"
      style={[
        styles.finalsCard,
        { backgroundColor: c.card, borderColor: c.gold, borderWidth: 2 },
      ]}
    >
      <View style={styles.finalsHeader}>
        <Ionicons name="trophy" size={ms(11)} color={c.gold} accessible={false} />
        <ThemedText
          type="varsitySmall"
          style={[styles.finalsLabel, { color: c.gold }]}
        >
          SUPER BOWL
        </ThemedText>
      </View>
      <TeamRow
        franchise={teamA}
        seed={series.seed_a}
        score={aScore}
        isWinner={!!winnerId && winnerId === series.franchise_a_id}
        compact
      />
      <View style={[styles.cardDivider, { backgroundColor: c.gold, opacity: 0.4 }]} />
      <TeamRow
        franchise={teamB}
        seed={series.seed_b}
        score={bScore}
        isWinner={!!winnerId && winnerId === series.franchise_b_id}
        compact
      />
    </TouchableOpacity>
  );
}

// ─── Styles (cloned from NBA OverviewView) ────────────────────────────────
const styles = StyleSheet.create({
  outer: { flex: 1 },
  bracketArea: { position: 'relative' },

  halfRow: { flexDirection: 'row', alignItems: 'center' },
  centerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: s(8) },

  col: { justifyContent: 'flex-start' },
  r1Col: { flex: 24 },
  cfCol: { flex: 22 },
  finalsCol: { flex: 24, paddingHorizontal: s(3) },
  semiCenter: { justifyContent: 'center' },

  cardSpaceTop: { marginBottom: s(4) },
  cardSpaceBottom: {},

  card: { borderRadius: 8, overflow: 'hidden', borderWidth: 1 },
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
  seed: { fontFamily: Fonts.mono, fontSize: ms(10), fontWeight: '600' },
  seedCompact: { fontSize: ms(9) },
  wins: {
    fontFamily: Fonts.mono,
    fontSize: ms(15),
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  winsCompact: { fontSize: ms(13) },

  // Bye placeholder row — center-aligned eyebrow instead of a team. Matches
  // NBA's ByeCard exactly (vertical space matches a TeamRow so the bracket
  // retains its shape).
  byeRow: {
    justifyContent: 'center',
    minHeight: s(26 + 12),
  },
  byeLabel: { fontSize: ms(9), letterSpacing: 1.4 },

  finalsCard: { borderRadius: 10, overflow: 'hidden', paddingTop: s(4) },
  finalsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(4),
    paddingBottom: s(2),
  },
  finalsLabel: { fontSize: ms(8), letterSpacing: 1.0 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: s(20) },
});
