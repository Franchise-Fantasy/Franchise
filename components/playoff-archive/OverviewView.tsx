import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { ArchiveTeamLogo } from '@/components/playoff-archive/ArchiveTeamLogo';
import { SeriesDetailCard } from '@/components/playoff-archive/SeriesDetailCard';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Fonts } from '@/constants/Colors';
import { useArchiveColors } from '@/hooks/useArchiveColors';
import type {
  ArchiveBracket,
  ArchiveFranchiseSeason,
  ArchiveGame,
  ArchiveSeries,
  SeriesConference,
} from '@/types/archivePlayoff';
import { prefetchSeasonLogos } from '@/utils/playoffArchive';
import { ms, s } from '@/utils/scale';

interface Props {
  bracket: ArchiveBracket;
  /** Tapping a team within the SeriesDetailCard opens the team detail sheet. */
  onTeamTap: (franchiseId: string) => void;
}

type Mode = 'final' | 'replay';

// ─── Bracket indexing ──────────────────────────────────────────────────────

interface IndexedBracket {
  franchiseMap: Map<string, ArchiveFranchiseSeason>;
  // R1 and semi arrays are sparse — indexed by bracket_position so missing
  // slots stay `undefined`. The 1977-1983 12-team format has byes at R1
  // positions 0 and 3 (1-seed and 2-seed don't play in R1).
  west: {
    r1: (ArchiveSeries | undefined)[];
    semi: (ArchiveSeries | undefined)[];
    cf: ArchiveSeries | null;
  };
  east: {
    r1: (ArchiveSeries | undefined)[];
    semi: (ArchiveSeries | undefined)[];
    cf: ArchiveSeries | null;
  };
  finals: ArchiveSeries | null;
  /** Bye slots in R1, keyed `${conf}-${bracket_position}`. The bye recipient
   *  is the team whose Semi slot is filled but has no R1 feeder series. */
  byes: Map<string, { franchise: ArchiveFranchiseSeason; seed: number }>;
  /** All series ordered by (round → conference → bracket_position). */
  orderedSeries: ArchiveSeries[];
  /** Games grouped by series id, sorted by game_num. */
  gamesBySeries: Map<string, ArchiveGame[]>;
}

// R1 in 1984–2002 was best-of-5; semis/CF/Finals have always been best-of-7.
function winThresholdForRound(
  round: number,
  firstRoundFormat: string | undefined,
): number {
  if (round !== 1) return 4;
  if (firstRoundFormat === 'best_of_3') return 2;
  if (firstRoundFormat === 'best_of_5') return 3;
  return 4;
}

function indexBracket(bracket: ArchiveBracket): IndexedBracket {
  const fmap = new Map<string, ArchiveFranchiseSeason>();
  for (const f of bracket.franchises) fmap.set(f.franchise_id, f);

  // Bracket-position-indexed sparse arrays — R1 always has 4 slots per
  // conference (bp 0..3), semis always have 2 (bp 0..1), even when some
  // are absent (12-team byes). Pre-1984, slots 0 and 3 are typically empty.
  const r1At = (round: number, conf: string, len: number) => {
    const arr: (ArchiveSeries | undefined)[] = new Array(len).fill(undefined);
    for (const s of bracket.series) {
      if (s.round === round && s.conference === conf && s.bracket_position < len) {
        arr[s.bracket_position] = s;
      }
    }
    return arr;
  };

  const westR1 = r1At(1, 'West', 4);
  const eastR1 = r1At(1, 'East', 4);
  const westSemi = r1At(2, 'West', 2);
  const eastSemi = r1At(2, 'East', 2);

  const confOrder: Record<string, number> = { East: 0, West: 1, Finals: 2 };
  const orderedSeries = [...bracket.series].sort((a, b) => {
    if (a.round !== b.round) return a.round - b.round;
    if (a.conference !== b.conference)
      return confOrder[a.conference] - confOrder[b.conference];
    return a.bracket_position - b.bracket_position;
  });

  const gamesBySeries = new Map<string, ArchiveGame[]>();
  for (const g of bracket.games) {
    const arr = gamesBySeries.get(g.series_id) ?? [];
    arr.push(g);
    gamesBySeries.set(g.series_id, arr);
  }
  for (const arr of gamesBySeries.values()) arr.sort((a, b) => a.game_num - b.game_num);

  // Byes: a Semi slot has a franchise_id BUT no R1 feeder series exists at
  // the position that would feed it. Characteristic of 1977-1983 — the 1
  // and 2 seeds enter the bracket directly at the Conference Semis.
  const byes = new Map<string, { franchise: ArchiveFranchiseSeason; seed: number }>();
  const detect = (
    conf: string,
    r1: (ArchiveSeries | undefined)[],
    semi: (ArchiveSeries | undefined)[],
  ) => {
    for (let bp = 0; bp < semi.length; bp++) {
      const sm = semi[bp];
      if (!sm) continue;
      const aFeederBp = bp * 2;
      const bFeederBp = bp * 2 + 1;
      if (!r1[aFeederBp] && sm.franchise_a_id && sm.seed_a != null) {
        const f = fmap.get(sm.franchise_a_id);
        if (f) byes.set(`${conf}-${aFeederBp}`, { franchise: f, seed: sm.seed_a });
      }
      if (!r1[bFeederBp] && sm.franchise_b_id && sm.seed_b != null) {
        const f = fmap.get(sm.franchise_b_id);
        if (f) byes.set(`${conf}-${bFeederBp}`, { franchise: f, seed: sm.seed_b });
      }
    }
  };
  detect('West', westR1, westSemi);
  detect('East', eastR1, eastSemi);

  const findCf = (conf: string): ArchiveSeries | null =>
    bracket.series.find((s) => s.round === 3 && s.conference === conf) ?? null;
  const finals =
    bracket.series.find((s) => s.round === 4 && s.conference === 'Finals') ?? null;

  let westCf = findCf('West');
  let eastCf = findCf('East');
  let finalsRef = finals;

  // Live-bracket preview: when a next-round slot has no series row yet but
  // its feeder already has a winner, synthesize a placeholder series with
  // the winner pre-filled in the corresponding slot. Real data overwrites
  // the preview the moment the actual series gets imported (the lookup
  // above picks up the real one and the preview is not generated). The
  // preview synthesis chains forward — R2 winners can preview R3, etc.
  const season = bracket.year?.season ?? 0;
  const previewId = (round: number, conf: string, bp: number) =>
    `${season}-${conf}-R${round}-${bp}-PREVIEW`;
  // Extract the seed of the winning franchise from a feeder series — the
  // winner's seed is the seed_a/seed_b matching the winner_franchise_id.
  const winnerSeed = (feeder: ArchiveSeries | undefined | null) => {
    if (!feeder?.winner_franchise_id) return null;
    if (feeder.winner_franchise_id === feeder.franchise_a_id) return feeder.seed_a;
    if (feeder.winner_franchise_id === feeder.franchise_b_id) return feeder.seed_b;
    return null;
  };
  const makePreview = (
    round: number,
    conf: SeriesConference,
    bp: number,
    feederA: ArchiveSeries | undefined | null,
    feederB: ArchiveSeries | undefined | null,
  ): ArchiveSeries => ({
    id: previewId(round, conf, bp),
    season,
    round,
    conference: conf,
    bracket_position: bp,
    franchise_a_id: feederA?.winner_franchise_id ?? null,
    franchise_b_id: feederB?.winner_franchise_id ?? null,
    seed_a: winnerSeed(feederA),
    seed_b: winnerSeed(feederB),
    winner_franchise_id: null,
    wins_a: 0,
    wins_b: 0,
  });

  // R2 previews from completed R1s.
  for (const [conf, r1, semi] of [
    ['West', westR1, westSemi] as const,
    ['East', eastR1, eastSemi] as const,
  ]) {
    for (let bp = 0; bp < 2; bp++) {
      if (semi[bp]) continue;
      const fA = r1[bp * 2];
      const fB = r1[bp * 2 + 1];
      if (fA?.winner_franchise_id || fB?.winner_franchise_id) {
        semi[bp] = makePreview(2, conf, bp, fA, fB);
      }
    }
  }

  // R3 previews from completed semis (real or synthesized).
  if (!westCf && (westSemi[0]?.winner_franchise_id || westSemi[1]?.winner_franchise_id)) {
    westCf = makePreview(3, 'West', 0, westSemi[0], westSemi[1]);
  }
  if (!eastCf && (eastSemi[0]?.winner_franchise_id || eastSemi[1]?.winner_franchise_id)) {
    eastCf = makePreview(3, 'East', 0, eastSemi[0], eastSemi[1]);
  }

  // Finals preview from completed conference finals (real or synthesized).
  if (!finalsRef && (westCf?.winner_franchise_id || eastCf?.winner_franchise_id)) {
    finalsRef = makePreview(4, 'Finals', 0, westCf, eastCf);
  }

  // Preview series MUST be in orderedSeries so buildViewStates visits them
  // (and so feedersFor's byKey lookup can find them when chaining R3+
  // preview visibility off synthetic R2 previews). Append in canonical order.
  const enrichedOrdered = [...orderedSeries];
  const isPreview = (sr: ArchiveSeries) => sr.id.endsWith('-PREVIEW');
  for (const sr of [
    ...westSemi,
    ...eastSemi,
    westCf,
    eastCf,
    finalsRef,
  ]) {
    if (sr && isPreview(sr)) enrichedOrdered.push(sr);
  }
  enrichedOrdered.sort((a, b) => {
    if (a.round !== b.round) return a.round - b.round;
    if (a.conference !== b.conference)
      return confOrder[a.conference] - confOrder[b.conference];
    return a.bracket_position - b.bracket_position;
  });

  return {
    franchiseMap: fmap,
    west: { r1: westR1, semi: westSemi, cf: westCf },
    east: { r1: eastR1, semi: eastSemi, cf: eastCf },
    finals: finalsRef,
    byes,
    orderedSeries: enrichedOrdered,
    gamesBySeries,
  };
}

// ─── View-state derivation (replay mode) ───────────────────────────────────

interface SeriesViewState {
  series: ArchiveSeries;
  /** Games played so far in this series (chronological). */
  playedGames: ArchiveGame[];
  /** Total games in this series (all the data we have). */
  totalGames: number;
  liveWinsA: number;
  liveWinsB: number;
  isComplete: boolean;
  liveWinnerId: string | null;
  /** Whether team_a should be rendered (false when its feeder hasn't completed). */
  showTeamA: boolean;
  showTeamB: boolean;
}

// Determines the feeder series for series's team_a and team_b slots.
// R1 has no feeders; later rounds inherit from their two feeders in the
// previous round. NBA Finals (R4 / Finals conference) bridges West R3 and
// East R3 — `a` is West (matches the import data convention), `b` is East.
function feedersFor(
  series: ArchiveSeries,
  byKey: Map<string, ArchiveSeries>,
): { a: ArchiveSeries | null; b: ArchiveSeries | null } {
  if (series.round === 1) return { a: null, b: null };
  if (series.conference === 'Finals') {
    return {
      a: byKey.get(`3-West-0`) ?? null,
      b: byKey.get(`3-East-0`) ?? null,
    };
  }
  return {
    a: byKey.get(`${series.round - 1}-${series.conference}-${series.bracket_position * 2}`) ?? null,
    b: byKey.get(`${series.round - 1}-${series.conference}-${series.bracket_position * 2 + 1}`) ?? null,
  };
}

function buildViewStates(
  idx: IndexedBracket,
  mode: Mode,
  phase: number,
  gameInPhase: number,
  firstRoundFormat: string | undefined,
): Map<string, SeriesViewState> {
  const result = new Map<string, SeriesViewState>();
  const byKey = new Map<string, ArchiveSeries>();
  for (const sr of idx.orderedSeries) {
    byKey.set(`${sr.round}-${sr.conference}-${sr.bracket_position}`, sr);
  }

  // Count played games per series. In replay we tick through ROUNDS as
  // phases — within a phase, every active series in that round plays in
  // parallel, so a single "advance" step adds one game to every series in
  // the current phase that still has games left.
  const playedCount = new Map<string, number>();
  for (const sr of idx.orderedSeries) {
    const games = idx.gamesBySeries.get(sr.id) ?? [];
    if (mode === 'final') {
      playedCount.set(sr.id, games.length);
    } else if (sr.round < phase) {
      playedCount.set(sr.id, games.length);
    } else if (sr.round === phase) {
      playedCount.set(sr.id, Math.min(gameInPhase, games.length));
    } else {
      playedCount.set(sr.id, 0);
    }
  }

  // First pass: live wins + completion (depends only on playedCount).
  for (const sr of idx.orderedSeries) {
    const games = idx.gamesBySeries.get(sr.id) ?? [];
    const played = playedCount.get(sr.id) ?? 0;
    const playedGames = games.slice(0, played);
    let a = 0;
    let b = 0;
    for (const g of playedGames) {
      if (g.winner_franchise_id === sr.franchise_a_id) a++;
      else if (g.winner_franchise_id === sr.franchise_b_id) b++;
    }
    // Completion logic differs by mode:
    // - Final mode: trust the recorded winner_franchise_id (handles
    //   ongoing seasons where some series legitimately aren't done yet).
    // - Replay mode: a series becomes "complete" the moment one side
    //   reaches the win threshold for its round/format.
    const threshold = winThresholdForRound(sr.round, firstRoundFormat);
    const isComplete =
      mode === 'final'
        ? sr.winner_franchise_id != null
        : a >= threshold || b >= threshold;
    const liveWinnerId = isComplete
      ? mode === 'final'
        ? sr.winner_franchise_id
        : a > b
          ? sr.franchise_a_id
          : sr.franchise_b_id
      : null;
    result.set(sr.id, {
      series: sr,
      playedGames,
      totalGames: games.length,
      liveWinsA: a,
      liveWinsB: b,
      isComplete,
      liveWinnerId,
      showTeamA: false,
      showTeamB: false,
    });
  }

  // Second pass: team visibility in replay mode (depends on first-pass
  // completion of feeder series). In final mode every team is visible.
  for (const sr of idx.orderedSeries) {
    const vs = result.get(sr.id)!;
    if (mode === 'final') {
      vs.showTeamA = true;
      vs.showTeamB = true;
      continue;
    }
    const { a: feederA, b: feederB } = feedersFor(sr, byKey);
    // Bye recipients (1977-1983 12-team format): no feeder series exists
    // for that slot but the franchise is set on the series. They're visible
    // from the start of replay since they didn't play in R1.
    const hasByeA = sr.round > 1 && !feederA && sr.franchise_a_id != null;
    const hasByeB = sr.round > 1 && !feederB && sr.franchise_b_id != null;
    vs.showTeamA = sr.round === 1
      ? true
      : hasByeA
        ? true
        : !!feederA && (result.get(feederA.id)?.isComplete ?? false);
    vs.showTeamB = sr.round === 1
      ? true
      : hasByeB
        ? true
        : !!feederB && (result.get(feederB.id)?.isComplete ?? false);
  }

  return result;
}

// ─── Main view ─────────────────────────────────────────────────────────────

export function OverviewView({ bracket, onTeamTap }: Props) {
  const idx = useMemo(() => indexBracket(bracket), [bracket]);

  // Warm the disk cache for every logo this season uses, so subsequent
  // bracket renders + season switches don't show pop-in. Fires once per
  // season payload — expo-image dedupes against its cache internally.
  useEffect(() => {
    prefetchSeasonLogos(bracket.franchises);
  }, [bracket.franchises]);

  const [mode, setMode] = useState<Mode>('final');
  // Replay state: which round we're playing through ("phase") and how many
  // game-steps within that phase have been advanced. Each step plays one
  // more game in every series of the current round in parallel — like real
  // life, where Game 1s happen first, then Game 2s, etc.
  const [phase, setPhase] = useState<1 | 2 | 3 | 4>(1);
  const [gameInPhase, setGameInPhase] = useState(0);

  // Max number of games in any series of a given round — caps how many
  // game-steps that phase can take. (Round 1 of 2025 went up to 7 games;
  // a sweep round would max at 4.)
  const phaseMaxGames = useMemo(() => {
    const map = new Map<number, number>();
    for (const p of [1, 2, 3, 4] as const) {
      const seriesInPhase = idx.orderedSeries.filter((sr) => sr.round === p);
      const max = seriesInPhase.reduce(
        (m, sr) => Math.max(m, idx.gamesBySeries.get(sr.id)?.length ?? 0),
        0,
      );
      map.set(p, max);
    }
    return map;
  }, [idx]);

  // Replay is done when there are no more games to advance — handles both
  // a normal final-round finish AND an ongoing season where later phases
  // simply have no data.
  const isReplayDone = useMemo(() => {
    for (let p = phase; p <= 4; p++) {
      const max = phaseMaxGames.get(p) ?? 0;
      const played = p === phase ? gameInPhase : 0;
      if (played < max) return false;
    }
    return true;
  }, [phase, gameInPhase, phaseMaxGames]);

  const viewStates = useMemo(
    () =>
      buildViewStates(
        idx,
        mode,
        phase,
        gameInPhase,
        bracket.year?.first_round_format,
      ),
    [idx, mode, phase, gameInPhase, bracket.year?.first_round_format],
  );

  // Default the detail card to the NBA Finals when the season has finished;
  // for ongoing seasons (no Finals yet, like 2025-26 mid-bracket), fall
  // back to the West 1-seed's R1 matchup so the card always has something
  // to show.
  // Pre-1984 12-team format has byes at R1 positions 0 and 3, so r1[0]
  // is undefined for the West 1-seed bye. Fall back to the first R1 series
  // that actually exists in either conference.
  const firstWestR1 = idx.west.r1.find((sr): sr is ArchiveSeries => !!sr) ?? null;
  const firstEastR1 = idx.east.r1.find((sr): sr is ArchiveSeries => !!sr) ?? null;
  const defaultSelectedId = idx.finals?.id ?? firstWestR1?.id ?? firstEastR1?.id ?? null;
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(
    defaultSelectedId,
  );

  // When the season changes (parent passes a different bracket payload), the
  // existing selection may not exist in the new bracket. Reset to the
  // current season's default so the detail card stays populated.
  useEffect(() => {
    if (selectedSeriesId && bracket.series.some((sr) => sr.id === selectedSeriesId)) return;
    setSelectedSeriesId(defaultSelectedId);
  }, [bracket.series, defaultSelectedId, selectedSeriesId]);

  const selectedSeries = useMemo(
    () => bracket.series.find((sr) => sr.id === selectedSeriesId) ?? null,
    [bracket.series, selectedSeriesId],
  );

  // In replay mode, the detail card only shows pips for games that have
  // been played in this series; in final mode all games are played.
  const selectedGames = useMemo(() => {
    if (!selectedSeriesId) return [];
    if (mode === 'final') {
      return bracket.games.filter((g) => g.series_id === selectedSeriesId);
    }
    const vs = viewStates.get(selectedSeriesId);
    return vs?.playedGames ?? [];
  }, [bracket.games, selectedSeriesId, mode, viewStates]);

  const selectedTotalGames = useMemo(() => {
    if (!selectedSeriesId) return 0;
    return idx.gamesBySeries.get(selectedSeriesId)?.length ?? 0;
  }, [idx.gamesBySeries, selectedSeriesId]);

  // Hide the detail card entirely when the selected series isn't yet
  // visible in the bracket (replay mode, both feeders still pending). The
  // card has no useful information at that point and would just show an
  // empty placeholder.
  const detailVisible = useMemo(() => {
    if (!selectedSeries) return false;
    if (mode === 'final') return true;
    const vs = viewStates.get(selectedSeries.id);
    return !!vs && (vs.showTeamA || vs.showTeamB);
  }, [selectedSeries, viewStates, mode]);

  const handleSetMode = (m: Mode) => {
    setMode(m);
    setPhase(1);
    setGameInPhase(0);
    if (m === 'replay') {
      // Auto-select the West 1-seed's R1 matchup (r1[0]) as the starting
      // drill-in. In the pre-1984 12-team format this slot is a bye, so
      // fall back to the first R1 series that actually exists.
      setSelectedSeriesId(firstWestR1?.id ?? firstEastR1?.id ?? null);
    }
  };

  // Auto-follow the winner of the currently-selected series into their
  // next-round matchup — but only at the MOMENT that next-round series
  // transitions to "set" (both feeders just became complete). Without the
  // transition check, the effect re-fired every render where the selected
  // series was already complete + the next was visible, snapping the user
  // forward whenever they manually navigated to an earlier finished round.
  const prevViewStatesRef = useRef<Map<string, SeriesViewState>>(new Map());
  useEffect(() => {
    const prevViewStates = prevViewStatesRef.current;
    prevViewStatesRef.current = viewStates;

    if (mode !== 'replay') return;
    if (!selectedSeriesId) return;
    const selected = bracket.series.find((sr) => sr.id === selectedSeriesId);
    if (!selected || selected.round >= 4) return;
    const selectedVS = viewStates.get(selected.id);
    if (!selectedVS?.isComplete) return;
    const winnerId = selectedVS.liveWinnerId;
    if (!winnerId) return;
    const next = bracket.series.find(
      (sr) =>
        sr.round === selected.round + 1 &&
        (sr.franchise_a_id === winnerId || sr.franchise_b_id === winnerId),
    );
    if (!next) return;
    const nextVS = viewStates.get(next.id);
    if (!nextVS) return;
    const isVisible = nextVS.showTeamA && nextVS.showTeamB;
    const prevNext = prevViewStates.get(next.id);
    const wasVisible = !!prevNext && prevNext.showTeamA && prevNext.showTeamB;
    if (isVisible && !wasVisible) {
      setSelectedSeriesId(next.id);
    }
  }, [viewStates, mode, selectedSeriesId, bracket.series]);

  // Find the next phase that actually has data. For ongoing seasons, R2+
  // may be empty — we skip past them rather than stranding the user on a
  // 0-game phase.
  const findNextNonEmptyPhase = (current: number): 1 | 2 | 3 | 4 | null => {
    for (let p = current + 1; p <= 4; p++) {
      if ((phaseMaxGames.get(p) ?? 0) > 0) return p as 1 | 2 | 3 | 4;
    }
    return null;
  };

  // ADVANCE: play one more game-step in the current phase. When the phase's
  // maximum game number is reached, automatically roll into Game 1 of the
  // next phase that has data.
  const handleAdvance = () => {
    if (isReplayDone) return;
    const max = phaseMaxGames.get(phase) ?? 0;
    if (gameInPhase < max) {
      setGameInPhase((g) => g + 1);
      return;
    }
    const next = findNextNonEmptyPhase(phase);
    if (next != null) {
      setPhase(next);
      setGameInPhase(1);
    }
  };

  // SKIP ROUND: jump to the end of the current phase. If we're already
  // there, jump straight to the END of the next non-empty phase.
  const handleSkipRound = () => {
    if (isReplayDone) return;
    const max = phaseMaxGames.get(phase) ?? 0;
    if (gameInPhase < max) {
      setGameInPhase(max);
      return;
    }
    const next = findNextNonEmptyPhase(phase);
    if (next != null) {
      setPhase(next);
      setGameInPhase(phaseMaxGames.get(next) ?? 0);
    }
  };

  const handleReset = () => {
    setPhase(1);
    setGameInPhase(0);
  };

  return (
    // Regular View instead of ScrollView so the SeriesDetailCard's
    // upward-growing expand panel is not clipped at the ScrollView's frame
    // when expanded. Bracket content fits on screen at typical phone sizes;
    // the previous ScrollView was unused in practice.
    <View style={[styles.outer, styles.scrollContent]}>
      {/* Bracket area — relative-positioned so the FINAL/REPLAY toggle can
          float over the empty top-center space without taking its own row. */}
      <View style={styles.bracketArea}>
        <View style={styles.toggleAnchor} pointerEvents="box-none">
          <ModeToggle mode={mode} onChange={handleSetMode} />
        </View>

        {/* ── Top half: West top-half ←   semis   → East top-half ── */}
        <HalfRow
          westR1={[idx.west.r1[0], idx.west.r1[1]]}
          westR1Byes={[idx.byes.get('West-0'), idx.byes.get('West-1')]}
          westSemi={idx.west.semi[0] ?? null}
          eastSemi={idx.east.semi[0] ?? null}
          eastR1={[idx.east.r1[0], idx.east.r1[1]]}
          eastR1Byes={[idx.byes.get('East-0'), idx.byes.get('East-1')]}
          franchiseMap={idx.franchiseMap}
          viewStates={viewStates}
          selectedSeriesId={selectedSeriesId}
          onSelectSeries={setSelectedSeriesId}
        />

        {/* ── Center band: WCF | NBA Finals | ECF ── */}
        <View style={styles.centerRow}>
          <View style={[styles.col, styles.r1Col]} />
          <View style={[styles.col, styles.cfCol]}>
            {idx.west.cf ? (
              <BracketCard
                series={idx.west.cf}
                franchiseMap={idx.franchiseMap}
                viewStates={viewStates}
                compact
                selected={selectedSeriesId === idx.west.cf.id}
                onSelect={setSelectedSeriesId}
              />
            ) : (
              <EmptyBracketCard compact />
            )}
          </View>
          <View style={[styles.col, styles.finalsCol]}>
            {idx.finals ? (
              <FinalsCard
                series={idx.finals}
                franchiseMap={idx.franchiseMap}
                viewStates={viewStates}
                selected={selectedSeriesId === idx.finals.id}
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
                viewStates={viewStates}
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

        {/* ── Bottom half: West bottom-half ← semis → East bottom-half ── */}
        <HalfRow
          westR1={[idx.west.r1[2], idx.west.r1[3]]}
          westR1Byes={[idx.byes.get('West-2'), idx.byes.get('West-3')]}
          westSemi={idx.west.semi[1] ?? null}
          eastSemi={idx.east.semi[1] ?? null}
          eastR1={[idx.east.r1[2], idx.east.r1[3]]}
          eastR1Byes={[idx.byes.get('East-2'), idx.byes.get('East-3')]}
          franchiseMap={idx.franchiseMap}
          viewStates={viewStates}
          selectedSeriesId={selectedSeriesId}
          onSelectSeries={setSelectedSeriesId}
        />
      </View>

      {/* ── Series detail card ── */}
      {detailVisible && (
        <SeriesDetailCard
          series={selectedSeries}
          franchiseMap={idx.franchiseMap}
          games={selectedGames}
          totalGames={selectedTotalGames}
          onTeamTap={onTeamTap}
          finalsMvp={
            // The MvpRow inside SeriesDetailCard self-gates on liveWinnerId,
            // so during replay the row only appears after the Finals decide
            // — the narrative beat. We pass the data in both modes.
            bracket.year?.finals_mvp_player_name
              ? {
                  playerName: bracket.year.finals_mvp_player_name,
                  franchiseId: bracket.year.finals_mvp_franchise_id,
                  statLine: bracket.year.finals_mvp_stat_line,
                }
              : null
          }
        />
      )}

      {/* ── Replay controls — only visible in replay mode ── */}
      {mode === 'replay' && (
        <ReplayControls
          phase={phase}
          gameInPhase={gameInPhase}
          phaseMax={phaseMaxGames.get(phase) ?? 0}
          isDone={isReplayDone}
          onAdvance={handleAdvance}
          onSkipRound={handleSkipRound}
          onReset={handleReset}
        />
      )}
    </View>
  );
}

// ─── Mode toggle (Final / Replay) ──────────────────────────────────────────

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const c = useArchiveColors();
  return (
    <View style={[styles.modeWrap, { borderColor: c.border, backgroundColor: c.cardAlt }]}>
      {(['final', 'replay'] as const).map((m) => {
        const selected = mode === m;
        return (
          <TouchableOpacity
            key={m}
            onPress={() => onChange(m)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={m === 'final' ? 'Final view' : 'Replay mode'}
            style={[
              styles.modeChip,
              selected && { backgroundColor: c.primary },
            ]}
          >
            <Ionicons
              name={m === 'final' ? 'trophy-outline' : 'play-outline'}
              size={ms(10)}
              color={selected ? Brand.ecru : c.secondaryText}
              accessible={false}
            />
            <ThemedText
              type="varsitySmall"
              style={[
                styles.modeLabel,
                { color: selected ? Brand.ecru : c.secondaryText },
              ]}
            >
              {m === 'final' ? 'FINAL' : 'REPLAY'}
            </ThemedText>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─── Replay controls (Advance, Skip Series, Reset) ────────────────────────

const PHASE_LABELS: Record<number, string> = {
  1: 'ROUND 1',
  2: 'CONF SEMIS',
  3: 'CONF FINALS',
  4: 'NBA FINALS',
};

function ReplayControls({
  phase,
  gameInPhase,
  phaseMax,
  isDone,
  onAdvance,
  onSkipRound,
  onReset,
}: {
  phase: number;
  gameInPhase: number;
  phaseMax: number;
  isDone: boolean;
  onAdvance: () => void;
  onSkipRound: () => void;
  onReset: () => void;
}) {
  const c = useArchiveColors();
  const atStart = phase === 1 && gameInPhase === 0;

  return (
    <View style={[styles.replayBar, { borderColor: c.border, backgroundColor: c.card }]}>
      <TouchableOpacity
        onPress={onReset}
        disabled={atStart}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Reset replay"
        accessibilityState={{ disabled: atStart }}
        style={[styles.replayBtn, { borderColor: c.border, opacity: atStart ? 0.4 : 1 }]}
      >
        <Ionicons name="refresh" size={ms(13)} color={c.secondaryText} accessible={false} />
      </TouchableOpacity>

      <View style={styles.replayCountWrap}>
        <ThemedText
          type="varsitySmall"
          style={[styles.replayPhase, { color: c.text }]}
        >
          {PHASE_LABELS[phase] ?? `ROUND ${phase}`}
        </ThemedText>
        <ThemedText
          type="varsitySmall"
          style={[styles.replayGame, { color: c.secondaryText }]}
        >
          GAME {Math.min(gameInPhase, phaseMax)} / {phaseMax}
        </ThemedText>
      </View>

      <TouchableOpacity
        onPress={onSkipRound}
        disabled={isDone}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Skip to end of round"
        accessibilityState={{ disabled: isDone }}
        style={[styles.replayBtn, { borderColor: c.border, opacity: isDone ? 0.4 : 1 }]}
      >
        <Ionicons name="play-forward" size={ms(13)} color={c.secondaryText} accessible={false} />
      </TouchableOpacity>

      <TouchableOpacity
        onPress={onAdvance}
        disabled={isDone}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Advance one game across the round"
        accessibilityState={{ disabled: isDone }}
        style={[
          styles.advancePrimary,
          { backgroundColor: isDone ? c.cardAlt : c.primary },
        ]}
      >
        <ThemedText
          type="varsity"
          style={[
            styles.advanceLabel,
            { color: isDone ? c.secondaryText : Brand.ecru },
          ]}
        >
          {isDone ? 'COMPLETE' : 'ADVANCE'}
        </ThemedText>
        {!isDone && (
          <Ionicons name="play" size={ms(12)} color={Brand.ecru} accessible={false} />
        )}
      </TouchableOpacity>
    </View>
  );
}

// ─── Half row ───────────────────────────────────────────────────────────────

type ByeInfo = { franchise: ArchiveFranchiseSeason; seed: number } | undefined;

function HalfRow({
  westR1,
  westR1Byes,
  westSemi,
  eastSemi,
  eastR1,
  eastR1Byes,
  franchiseMap,
  viewStates,
  selectedSeriesId,
  onSelectSeries,
}: {
  westR1: (ArchiveSeries | undefined)[];
  westR1Byes: ByeInfo[];
  westSemi: ArchiveSeries | null;
  eastSemi: ArchiveSeries | null;
  eastR1: (ArchiveSeries | undefined)[];
  eastR1Byes: ByeInfo[];
  franchiseMap: Map<string, ArchiveFranchiseSeason>;
  viewStates: Map<string, SeriesViewState>;
  selectedSeriesId: string | null;
  onSelectSeries: (id: string) => void;
}) {
  const renderR1Slot = (
    sr: ArchiveSeries | undefined,
    bye: ByeInfo,
    key: string,
    i: number,
  ) => (
    <View key={key} style={i === 0 ? styles.cardSpaceTop : styles.cardSpaceBottom}>
      {sr ? (
        <BracketCard
          series={sr}
          franchiseMap={franchiseMap}
          viewStates={viewStates}
          selected={selectedSeriesId === sr.id}
          onSelect={onSelectSeries}
        />
      ) : bye ? (
        <ByeCard franchise={bye.franchise} seed={bye.seed} />
      ) : (
        <EmptyBracketCard />
      )}
    </View>
  );

  return (
    <View style={styles.halfRow}>
      <View style={[styles.col, styles.r1Col]}>
        {[0, 1].map((i) => renderR1Slot(westR1[i], westR1Byes[i], `west-r1-${i}`, i))}
      </View>
      <View style={[styles.col, styles.cfCol, styles.semiCenter]}>
        {westSemi ? (
          <BracketCard
            series={westSemi}
            franchiseMap={franchiseMap}
            viewStates={viewStates}
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
            viewStates={viewStates}
            compact
            selected={selectedSeriesId === eastSemi.id}
            onSelect={onSelectSeries}
          />
        ) : (
          <EmptyBracketCard compact />
        )}
      </View>
      <View style={[styles.col, styles.r1Col]}>
        {[0, 1].map((i) => renderR1Slot(eastR1[i], eastR1Byes[i], `east-r1-${i}`, i))}
      </View>
    </View>
  );
}

// ─── Bracket card (R1, semi, conf finals) ──────────────────────────────────

function BracketCard({
  series,
  franchiseMap,
  viewStates,
  compact,
  selected,
  onSelect,
}: {
  series: ArchiveSeries;
  franchiseMap: Map<string, ArchiveFranchiseSeason>;
  viewStates: Map<string, SeriesViewState>;
  compact?: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const c = useArchiveColors();
  const vs = viewStates.get(series.id);
  const teamA = vs?.showTeamA && series.franchise_a_id ? franchiseMap.get(series.franchise_a_id) ?? null : null;
  const teamB = vs?.showTeamB && series.franchise_b_id ? franchiseMap.get(series.franchise_b_id) ?? null : null;
  const winnerId = vs?.liveWinnerId ?? null;
  // Synthesized live-bracket previews aren't in bracket.series, so the
  // detail-card lookup would miss them and tapping wouldn't drill in.
  // Keep them non-interactive — they exist purely to preview the next-round
  // matchup once a feeder series finishes.
  const isPreview = series.id.endsWith('-PREVIEW');

  return (
    <TouchableOpacity
      onPress={() => isPreview ? undefined : onSelect(series.id)}
      activeOpacity={isPreview ? 1 : 0.75}
      disabled={isPreview}
      accessibilityRole={isPreview ? 'text' : 'button'}
      accessibilityLabel={
        isPreview
          ? `Preview: ${teamA?.tricode ?? ''}${teamB ? ' vs ' + teamB.tricode : ''} headed to next round`
          : teamA && teamB
            ? `${teamA.tricode} vs ${teamB.tricode} series`
            : 'Series card'
      }
      style={[
        styles.card,
        {
          backgroundColor: c.card,
          // Keep borderWidth fixed (set in styles.card) — toggling between
          // 1 and 2 on selection shrinks the inner content area by 1px on
          // each side, which makes the team rows visibly shift when the
          // user clicks between cards. Color alone carries selection.
          borderColor: selected ? c.gold : c.border,
        },
        compact && styles.cardCompact,
      ]}
    >
      <TeamRow
        franchise={teamA}
        seed={vs?.showTeamA ? series.seed_a : null}
        wins={vs?.liveWinsA ?? 0}
        isWinner={!!winnerId && winnerId === series.franchise_a_id}
        compact={compact}
      />
      <View style={[styles.cardDivider, { backgroundColor: c.border }]} />
      <TeamRow
        franchise={teamB}
        seed={vs?.showTeamB ? series.seed_b : null}
        wins={vs?.liveWinsB ?? 0}
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
  franchise: ArchiveFranchiseSeason | null;
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
        {franchise ? wins : ''}
      </ThemedText>
    </View>
  );
}

// ─── Empty placeholder cards ───────────────────────────────────────────────
// Drawn for slots whose series hasn't been imported yet (e.g. R2+ for the
// ongoing 2025–26 season). Same dimensions as filled cards so the bracket
// retains its shape and connector geometry.

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

// Bye placeholder for 1977-1983 12-team era — the 1 and 2 seeds skipped R1
// entirely. Renders the same dimensions as a BracketCard so the bracket
// retains its shape; second row carries a "BYE" eyebrow instead of an
// opponent. Non-interactive — there's no series to drill into.
function ByeCard({
  franchise,
  seed,
}: {
  franchise: ArchiveFranchiseSeason;
  seed: number;
}) {
  const c = useArchiveColors();
  return (
    <View
      style={[styles.card, { borderColor: c.border, backgroundColor: c.cardAlt }]}
      accessibilityLabel={`${franchise.tricode} bye to Conference Semifinals`}
    >
      <View style={styles.teamRow}>
        <ArchiveTeamLogo
          franchiseId={franchise.franchise_id}
          tricode={franchise.tricode}
          primaryColor={franchise.primary_color}
          secondaryColor={franchise.secondary_color}
          logoKey={franchise.logo_key}
          size={s(26)}
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

function EmptyFinalsCard() {
  const c = useArchiveColors();
  return (
    <View
      style={[
        styles.finalsCard,
        styles.emptyCard,
        { borderColor: c.gold, backgroundColor: c.cardAlt, borderWidth: 2 },
      ]}
      accessibilityLabel="NBA Finals to be determined"
    >
      <View style={styles.finalsHeader}>
        <Ionicons name="trophy-outline" size={ms(11)} color={c.gold} accessible={false} />
        <ThemedText
          type="varsitySmall"
          style={[styles.finalsLabel, { color: c.gold }]}
        >
          NBA FINALS
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

// ─── NBA Finals card (centerpiece) ─────────────────────────────────────────

function FinalsCard({
  series,
  franchiseMap,
  viewStates,
  selected,
  onSelect,
}: {
  series: ArchiveSeries;
  franchiseMap: Map<string, ArchiveFranchiseSeason>;
  viewStates: Map<string, SeriesViewState>;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const c = useArchiveColors();
  const vs = viewStates.get(series.id);
  const teamA = vs?.showTeamA && series.franchise_a_id ? franchiseMap.get(series.franchise_a_id) ?? null : null;
  const teamB = vs?.showTeamB && series.franchise_b_id ? franchiseMap.get(series.franchise_b_id) ?? null : null;
  const winnerId = vs?.liveWinnerId ?? null;
  const isPreview = series.id.endsWith('-PREVIEW');

  return (
    <TouchableOpacity
      onPress={() => isPreview ? undefined : onSelect(series.id)}
      activeOpacity={isPreview ? 1 : 0.75}
      disabled={isPreview}
      accessibilityRole={isPreview ? 'text' : 'button'}
      accessibilityLabel="NBA Finals series"
      style={[
        styles.finalsCard,
        {
          backgroundColor: c.card,
          borderColor: c.gold,
          // Constant borderWidth — toggling between 2 and 3 on selection
          // shrinks the inner content area by 1px on each side and shifts
          // the team rows when the user clicks between cards.
          borderWidth: 2,
        },
      ]}
    >
      <View style={styles.finalsHeader}>
        <Ionicons name="trophy" size={ms(11)} color={c.gold} accessible={false} />
        <ThemedText
          type="varsitySmall"
          style={[styles.finalsLabel, { color: c.gold }]}
        >
          NBA FINALS
        </ThemedText>
      </View>
      <TeamRow
        franchise={teamA}
        seed={vs?.showTeamA ? series.seed_a : null}
        wins={vs?.liveWinsA ?? 0}
        isWinner={!!winnerId && winnerId === series.franchise_a_id}
        compact
      />
      <View style={[styles.cardDivider, { backgroundColor: c.gold, opacity: 0.4 }]} />
      <TeamRow
        franchise={teamB}
        seed={vs?.showTeamB ? series.seed_b : null}
        wins={vs?.liveWinsB ?? 0}
        isWinner={!!winnerId && winnerId === series.franchise_b_id}
        compact
      />
    </TouchableOpacity>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  outer: { flex: 1 },
  scrollContent: {
    paddingBottom: s(24),
  },

  // Bracket-area wrapper — relative-positioned so the toggle can overlay
  // the top-center empty space.
  bracketArea: {
    position: 'relative',
  },
  toggleAnchor: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  // Mode toggle (Final / Replay) — compact pill that floats above the
  // bracket. Sits in the empty top-center space between the two semi
  // columns, so it doesn't claim its own row.
  modeWrap: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 999,
    padding: s(2),
    gap: s(2),
  },
  modeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
    paddingHorizontal: s(10),
    paddingVertical: s(4),
    borderRadius: 999,
  },
  modeLabel: {
    fontSize: ms(9),
    letterSpacing: 1.0,
  },

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
  // 5-column ratios. R1 columns are intentionally narrower so the inner
  // rounds get more room.
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
  cardCompact: {
    borderRadius: 6,
  },
  // Slightly faded outline + dashed feel for unfilled bracket slots.
  emptyCard: {
    borderStyle: 'dashed',
    opacity: 0.65,
  },
  cardDivider: { height: StyleSheet.hairlineWidth },

  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: s(6),
    paddingVertical: s(6),
    gap: s(4),
  },
  teamRowCompact: {
    paddingVertical: s(4),
    gap: s(3),
  },
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

  // Bye placeholder row (1977-1983) — center-aligned eyebrow instead of a
  // team. Vertical space matches a TeamRow so the bracket retains shape.
  byeRow: {
    justifyContent: 'center',
    minHeight: s(26 + 12), // logo (26) + paddingVertical(6) * 2
  },
  byeLabel: {
    fontSize: ms(9),
    letterSpacing: 1.4,
  },

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

  // Replay controls bar
  replayBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    marginTop: s(10),
    paddingHorizontal: s(10),
    paddingVertical: s(8),
    borderWidth: 1,
    borderRadius: 12,
  },
  replayBtn: {
    width: s(34),
    height: s(34),
    borderRadius: s(17),
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  replayCountWrap: {
    flex: 1,
    alignItems: 'center',
  },
  replayPhase: {
    fontSize: ms(10),
    letterSpacing: 1.3,
  },
  replayGame: {
    fontSize: ms(9),
    letterSpacing: 1.0,
    marginTop: 1,
  },
  advancePrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    paddingHorizontal: s(14),
    paddingVertical: s(9),
    borderRadius: s(18),
  },
  advanceLabel: {
    fontSize: ms(11),
    letterSpacing: 1.0,
  },
});
