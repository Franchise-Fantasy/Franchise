import { Ionicons } from '@expo/vector-icons';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ArchiveTeamLogo } from '@/components/playoff-archive/ArchiveTeamLogo';
import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts, cardShadow } from '@/constants/Colors';
import { useArchiveColors } from '@/hooks/useArchiveColors';
import type {
  ArchiveFranchiseSeason,
  ArchiveGame,
  ArchiveGameBoxLine,
  ArchiveSeries,
} from '@/types/archivePlayoff';
import { ms, s } from '@/utils/scale';
import { type PlayerSeriesLine, topPlayersPerTeam } from '@/utils/seriesLeaders';

interface Props {
  series: ArchiveSeries | null;
  franchiseMap: Map<string, ArchiveFranchiseSeason>;
  /** Games already played in this series, chronological. In Final mode this
   * is the full series; in Replay mode it grows from 0 to totalGames as the
   * user advances. */
  games: ArchiveGame[];
  /** Total games in this series (whether played or not). Drives the pip
   * count so unplayed games render as faint placeholders. */
  totalGames: number;
  onTeamTap: (franchiseId: string) => void;
  /** Finals MVP for the season — only consumed when this card is showing the
   *  Finals series and the series has decided. Null otherwise. */
  finalsMvp?: {
    playerName: string;
    franchiseId: string | null;
    statLine: string | null;
  } | null;
}

const ROUND_LABELS: Record<number, string> = {
  1: 'ROUND 1',
  2: 'CONFERENCE SEMIFINALS',
  3: 'CONFERENCE FINALS',
  4: 'NBA FINALS',
};

// Mirrors the analytics player-detail card chrome — gold-rule eyebrow,
// fixed minHeight so the card doesn't jump between empty/selected states,
// fade transition between hint and detail.
export function SeriesDetailCard({
  series,
  franchiseMap,
  games,
  totalGames,
  onTeamTap,
  finalsMvp,
}: Props) {
  const c = useArchiveColors();
  // Tap-pip-to-reveal: which game's headline is currently expanded. Tapping
  // the same pip again toggles off; switching series clears it.
  const [selectedGameNum, setSelectedGameNum] = useState<number | null>(null);
  // Tap-to-expand: opens an upward-growing panel that overlays the bracket
  // above. Content is context-aware — when a game is selected we show the
  // full game leaders (primary + secondary per side), otherwise series
  // leaders (best +/-, peak GmSc, most appearances).
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setSelectedGameNum(null);
    setExpanded(false);
  }, [series?.id]);

  // Upward-growing animation. Two pieces move together:
  //   1. The card's animated `marginTop` shrinks from COLLAPSED_TOP_GAP down
  //      into negative territory, lifting the whole card upward.
  //   2. The inline `expandedSection` height grows from 0 to maxExpand,
  //      adding visible space at the top.
  // Net effect: bottom edge stays anchored, top edge slides up over the
  // bracket and segmented control until it reaches just below the page
  // header. The card stays a single bordered/shadowed unit.
  //
  // COLLAPSED_TOP_GAP is the visible gap between the bracket and the card
  // when collapsed — must be in the animated style so the static marginTop
  // isn't clobbered by Reanimated's marginTop write.
  const COLLAPSED_TOP_GAP = s(16);
  // Height the panel can grow to is measured: distance from the card's
  // collapsed top to just below the page header. Captured on first layout.
  const insets = useSafeAreaInsets();
  const PAGE_HEADER_HEIGHT = s(50);
  const cardRef = useRef<View>(null);
  const measuredRef = useRef(false);
  const [maxExpand, setMaxExpand] = useState(s(280));
  const handleCardLayout = useCallback(() => {
    if (measuredRef.current) return;
    cardRef.current?.measureInWindow((_x, y) => {
      // First layout pass can return y=0 before insets settle. Wait for a
      // sane value before locking in.
      if (y <= 0) return;
      measuredRef.current = true;
      const targetTop = insets.top + PAGE_HEADER_HEIGHT;
      const max = Math.max(y - targetTop, s(120));
      setMaxExpand(max);
    });
  }, [insets.top, PAGE_HEADER_HEIGHT]);

  const expandedHeight = useSharedValue(0);
  useEffect(() => {
    expandedHeight.value = withTiming(expanded ? maxExpand : 0, {
      duration: 260,
    });
  }, [expanded, maxExpand, expandedHeight]);
  const animatedCardStyle = useAnimatedStyle(() => ({
    marginTop: COLLAPSED_TOP_GAP - expandedHeight.value,
  }));
  const animatedSectionStyle = useAnimatedStyle(() => ({
    height: expandedHeight.value,
    opacity: interpolate(
      expandedHeight.value,
      [0, Math.max(maxExpand * 0.25, 1)],
      [0, 1],
      'clamp',
    ),
  }));

  const teamA = series?.franchise_a_id
    ? franchiseMap.get(series.franchise_a_id) ?? null
    : null;
  const teamB = series?.franchise_b_id
    ? franchiseMap.get(series.franchise_b_id) ?? null
    : null;
  const isFinals = series?.conference === 'Finals';

  // Wins are derived from the games array so the card stays in sync with
  // replay progress (in Final mode `games` is the full series, so this
  // matches series.wins_a/b exactly).
  const sortedGames = [...games].sort((a, b) => a.game_num - b.game_num);
  const liveWinsA = series
    ? sortedGames.filter((g) => g.winner_franchise_id === series.franchise_a_id).length
    : 0;
  const liveWinsB = series
    ? sortedGames.filter((g) => g.winner_franchise_id === series.franchise_b_id).length
    : 0;
  const isComplete = liveWinsA >= 4 || liveWinsB >= 4;
  const liveWinnerId = isComplete
    ? liveWinsA > liveWinsB
      ? series?.franchise_a_id ?? null
      : series?.franchise_b_id ?? null
    : null;

  // Compact result tag that lives on the right side of the eyebrow row, e.g.
  // "OKC IN 7" — using the tricode keeps the line short enough to fit on a
  // single row even for the longer round labels ("CONFERENCE SEMIFINALS").
  const winnerTag = (() => {
    if (!series || !liveWinnerId) return null;
    const winner = franchiseMap.get(liveWinnerId);
    if (!winner) return null;
    const played = liveWinsA + liveWinsB;
    return `${winner.tricode} IN ${played}`;
  })();

  // Currently-selected game (if any) and its primary/secondary headlines.
  const selectedGame = useMemo(
    () =>
      selectedGameNum != null
        ? sortedGames.find((g) => g.game_num === selectedGameNum) ?? null
        : null,
    [sortedGames, selectedGameNum],
  );
  // Top 7 players per team across the series, ranked by total minutes
  // played. Drawn from each game's surfaced rotation (5 starters + top 2
  // bench) — bench guys outside the rotation in any given game don't show
  // up here, but rotation regulars do.
  const topPlayers = useMemo(
    () =>
      series
        ? topPlayersPerTeam(
            sortedGames,
            series.franchise_a_id,
            series.franchise_b_id,
            7,
          )
        : { teamA: [], teamB: [] },
    [sortedGames, series],
  );


  return (
    <Animated.View
      ref={cardRef}
      onLayout={handleCardLayout}
      style={[
        styles.card,
        {
          backgroundColor: c.card,
          borderColor: isFinals ? c.gold : c.border,
          ...cardShadow,
        },
        animatedCardStyle,
      ]}
    >
      {/* Upward-growing expanded section — same card body, just an extra
          slot at the top that animates from 0 → EXPANDED_HEIGHT. Combined
          with the card's negative marginTop, the bottom stays anchored
          above the replay controls and the top slides up over the bracket. */}
      {series && teamA && teamB && (
        <Animated.View
          pointerEvents={expanded ? 'auto' : 'none'}
          style={[styles.expandedSection, animatedSectionStyle]}
        >
          <ExpandedPanelContent
            selectedGame={selectedGame}
            teamA={teamA}
            teamB={teamB}
            topPlayers={topPlayers}
            c={c}
          />
          <View style={[styles.expandedDivider, { backgroundColor: c.border }]} />
        </Animated.View>
      )}
      {series && teamA && teamB ? (
        <Animated.View
          key={series.id}
          entering={FadeIn.duration(160)}
          exiting={FadeOut.duration(120)}
          style={styles.cardBody}
        >
          <View style={styles.eyebrowRow}>
            <View style={[styles.eyebrowRule, { backgroundColor: isFinals ? c.gold : c.heritageGold }]} />
            <ThemedText
              type="varsitySmall"
              style={[styles.eyebrow, { color: isFinals ? c.gold : c.secondaryText }]}
              accessibilityRole="header"
              numberOfLines={1}
            >
              {ROUND_LABELS[series.round]}
              {!isFinals && series.conference !== 'Finals'
                ? `   ·   ${series.conference.toUpperCase()}`
                : ''}
            </ThemedText>
            {winnerTag && (
              <ThemedText
                type="varsitySmall"
                style={[styles.winnerTag, { color: isFinals ? c.gold : c.text }]}
              >
                {winnerTag}
              </ThemedText>
            )}
            {isFinals && (
              <Ionicons name="trophy" size={ms(12)} color={c.gold} accessible={false} />
            )}
            <TouchableOpacity
              onPress={() => setExpanded((v) => !v)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={
                expanded
                  ? 'Hide expanded leaders'
                  : selectedGameNum != null
                    ? 'Show full game leaders'
                    : 'Show series leaders'
              }
              accessibilityState={{ expanded }}
              style={styles.expandToggle}
            >
              <Ionicons
                name={expanded ? 'chevron-down' : 'chevron-up'}
                size={ms(16)}
                color={c.secondaryText}
                accessible={false}
              />
            </TouchableOpacity>
          </View>

          <SeriesTeamRow
            franchise={teamA}
            seed={series.seed_a}
            wins={liveWinsA}
            isWinner={!!liveWinnerId && liveWinnerId === teamA.franchise_id}
            games={sortedGames}
            totalGames={totalGames}
            onPress={() => onTeamTap(teamA.franchise_id)}
            selectedGameNum={selectedGameNum}
            onPipTap={(gn) =>
              setSelectedGameNum((cur) => (cur === gn ? null : gn))
            }
            position="top"
            c={c}
          />
          <View style={[styles.divider, { backgroundColor: c.border }]} />
          <SeriesTeamRow
            franchise={teamB}
            seed={series.seed_b}
            wins={liveWinsB}
            isWinner={!!liveWinnerId && liveWinnerId === teamB.franchise_id}
            games={sortedGames}
            totalGames={totalGames}
            onPress={() => onTeamTap(teamB.franchise_id)}
            selectedGameNum={selectedGameNum}
            onPipTap={(gn) =>
              setSelectedGameNum((cur) => (cur === gn ? null : gn))
            }
            position="bottom"
            c={c}
          />
          {isFinals && liveWinnerId && finalsMvp ? (
            <View
              style={styles.mvpBlock}
              accessibilityLabel={`Finals MVP: ${finalsMvp.playerName}${finalsMvp.statLine ? `, ${finalsMvp.statLine}` : ''}`}
            >
              <View style={[styles.mvpDivider, { backgroundColor: c.gold }]} />
              <ThemedText
                type="varsitySmall"
                style={[styles.mvpEyebrow, { color: c.gold }]}
              >
                FINALS MVP
              </ThemedText>
              <ThemedText
                style={[styles.mvpName, { color: c.text }]}
                numberOfLines={1}
              >
                {finalsMvp.playerName}
              </ThemedText>
              {finalsMvp.statLine ? (
                <ThemedText
                  style={[styles.mvpStatLine, { color: c.secondaryText }]}
                  numberOfLines={1}
                >
                  {finalsMvp.statLine}
                </ThemedText>
              ) : null}
            </View>
          ) : null}
        </Animated.View>
      ) : (
        <View style={[styles.hintWrap, styles.cardBody]}>
          <ThemedText
            type="varsitySmall"
            style={[styles.hint, { color: c.secondaryText }]}
          >
            TAP A SERIES TO SEE DETAILS
          </ThemedText>
        </View>
      )}
    </Animated.View>
  );
}

// Resolves the team's score from a game record. The DB stores scores as
// home/away, but our UI presents them as team A / team B (consistent with
// how the series-level data is keyed) — this remaps based on per-game
// home/away tricodes.
function scoreForTeam(teamId: string, game: ArchiveGame): number | null {
  if (game.home_franchise_id === teamId) return game.home_score;
  if (game.away_franchise_id === teamId) return game.away_score;
  return null;
}

function SeriesTeamRow({
  franchise,
  seed,
  wins,
  isWinner,
  games,
  totalGames,
  onPress,
  selectedGameNum,
  onPipTap,
  position,
  c,
}: {
  franchise: ArchiveFranchiseSeason;
  seed: number | null;
  wins: number;
  isWinner: boolean;
  games: ArchiveGame[];
  totalGames: number;
  onPress: () => void;
  selectedGameNum: number | null;
  onPipTap: (gameNum: number) => void;
  /** 'top' renders the score under each pip; 'bottom' renders it over.
   *  When the two rows stack (top + divider + bottom), the scores cluster
   *  near the divider — like a mini box-score strip. */
  position: 'top' | 'bottom';
  c: ReturnType<typeof useArchiveColors>;
}) {
  // Right-side pip strip replaces the wins number. One pip per played game,
  // chronological: filled in this team's primary color when they won, hollow
  // (border-only) when they lost. The team's score for that game sits next
  // to the pip (under for top row, over for bottom row). In Replay mode the
  // strip simply grows as games are advanced — we deliberately don't render
  // placeholder pips for unplayed games because they'd leak series length.
  const fill = franchise.primary_color ?? c.text;
  const ring = franchise.secondary_color ?? c.border;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${franchise.city} ${franchise.name}, seed ${seed ?? '—'}, ${wins} wins${isWinner ? ', winner' : ''}. Tap for team details.`}
      style={[
        styles.teamRow,
        isWinner && { backgroundColor: c.goldMuted },
      ]}
    >
      <ArchiveTeamLogo
        franchiseId={franchise.franchise_id}
        tricode={franchise.tricode}
        primaryColor={franchise.primary_color}
        secondaryColor={franchise.secondary_color}
        logoKey={franchise.logo_key}
        size={s(32)}
      />
      {seed != null && (
        <View style={[styles.seedBadge, { backgroundColor: c.cardAlt }]}>
          <ThemedText style={[styles.seedText, { color: c.secondaryText }]}>{seed}</ThemedText>
        </View>
      )}
      <View style={styles.labels}>
        <ThemedText
          style={[styles.cityName, { color: c.text, fontWeight: isWinner ? '700' : '500' }]}
          numberOfLines={1}
        >
          {franchise.city}
        </ThemedText>
        <ThemedText style={[styles.teamName, { color: c.secondaryText }]} numberOfLines={1}>
          {franchise.name}
        </ThemedText>
      </View>
      {totalGames > 0 ? (
        <View style={styles.rowPips}>
          {games.map((g) => {
            const won = g.winner_franchise_id === franchise.franchise_id;
            const isSelected = selectedGameNum === g.game_num;
            const score = scoreForTeam(franchise.franchise_id, g);
            const scoreEl = score != null ? (
              <ThemedText
                style={[
                  styles.pipScore,
                  {
                    color: won ? c.text : c.secondaryText,
                    fontWeight: won ? '700' : '500',
                  },
                ]}
              >
                {score}
              </ThemedText>
            ) : null;
            const pipEl = (
              <TouchableOpacity
                key={g.game_num}
                onPress={(e) => {
                  // Prevent the parent row's onPress (open team sheet) from
                  // also firing when the user is tapping a specific pip.
                  e.stopPropagation();
                  onPipTap(g.game_num);
                }}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`Game ${g.game_num} headline`}
                accessibilityState={{ selected: isSelected }}
                style={[
                  styles.rowPip,
                  won
                    ? { backgroundColor: fill, borderColor: ring }
                    : { backgroundColor: 'transparent', borderColor: c.border },
                  isSelected && {
                    borderColor: c.gold,
                    borderWidth: 2,
                  },
                ]}
              />
            );
            return (
              <View key={g.game_num} style={styles.pipCol}>
                {position === 'top' ? (
                  <>
                    {pipEl}
                    {scoreEl}
                  </>
                ) : (
                  <>
                    {scoreEl}
                    {pipEl}
                  </>
                )}
              </View>
            );
          })}
        </View>
      ) : (
        <ThemedText
          style={[
            styles.wins,
            { color: isWinner ? c.gold : c.secondaryText, fontWeight: isWinner ? '700' : '500' },
          ]}
        >
          {wins}
        </ThemedText>
      )}
    </TouchableOpacity>
  );
}

// Content of the upward-growing expanded panel. Two team blocks stacked
// vertically — team A on top (matching the upper team row in the lower
// card), team B on bottom. Each block shows a 5-row rotation table with
// horizontal stat columns: MIN PTS REB AST STL BLK +/-.
//   - Game selected → per-game stats from each game's box.
//   - No game selected → series totals from the rotation accumulation.
function ExpandedPanelContent({
  selectedGame,
  teamA,
  teamB,
  topPlayers,
  c,
}: {
  selectedGame: ArchiveGame | null;
  teamA: ArchiveFranchiseSeason;
  teamB: ArchiveFranchiseSeason;
  topPlayers: { teamA: PlayerSeriesLine[]; teamB: PlayerSeriesLine[] };
  c: ReturnType<typeof useArchiveColors>;
}) {
  if (selectedGame) {
    const scoreA = scoreForTeam(teamA.franchise_id, selectedGame);
    const scoreB = scoreForTeam(teamB.franchise_id, selectedGame);
    const winnerA = scoreA != null && scoreB != null && scoreA > scoreB;
    const winnerB = scoreA != null && scoreB != null && scoreB > scoreA;
    const playersA = gamePlayersFromBox(selectedGame.box?.a);
    const playersB = gamePlayersFromBox(selectedGame.box?.b);
    return (
      <View style={styles.expandedInner}>
        <TeamBlock
          franchise={teamA}
          score={scoreA}
          isWinner={winnerA}
          players={playersA}
          padTo={7}
          mode="game"
          eyebrow={`GAME ${selectedGame.game_num}`}
          c={c}
        />
        <TeamBlock
          franchise={teamB}
          score={scoreB}
          isWinner={winnerB}
          players={playersB}
          padTo={7}
          mode="game"
          c={c}
        />
      </View>
    );
  }

  const hasAny = topPlayers.teamA.length > 0 || topPlayers.teamB.length > 0;
  return (
    <View style={styles.expandedInner}>
      {!hasAny ? (
        <ThemedText style={[styles.expandedEmpty, { color: c.secondaryText }]}>
          Headline data not yet available for this series.
        </ThemedText>
      ) : (
        <>
          <TeamBlock
            franchise={teamA}
            score={null}
            isWinner={false}
            players={seriesPlayersFromAverages(topPlayers.teamA)}
            padTo={7}
            mode="series"
            eyebrow="SERIES AVG"
            c={c}
          />
          <TeamBlock
            franchise={teamB}
            score={null}
            isWinner={false}
            players={seriesPlayersFromAverages(topPlayers.teamB)}
            padTo={7}
            mode="series"
            c={c}
          />
        </>
      )}
    </View>
  );
}

interface PlayerStatRow {
  name: string;
  minutes: number | null; // integer minutes — game = single-game, series = total
  pts: number | null;
  reb: number | null;
  ast: number | null;
  stl: number | null;
  blk: number | null;
  plusMinus: number | null;
}

function secondsToMinutes(seconds: number | null): number | null {
  if (seconds == null) return null;
  return Math.round(seconds / 60);
}

function gamePlayersFromBox(lines: ArchiveGameBoxLine[] | undefined): PlayerStatRow[] {
  if (!lines) return [];
  return lines.map((l) => ({
    name: l.player_name,
    minutes: secondsToMinutes(l.minutes_seconds),
    pts: l.pts,
    reb: l.reb,
    ast: l.ast,
    stl: l.stl,
    blk: l.blk,
    plusMinus: l.plus_minus,
  }));
}

// Series view shows per-game averages. Caveat: averages are computed from
// the games where the player appeared in the surfaced rotation (top 7 by
// minutes), so a player who dropped out of the rotation late in the series
// will have their average computed only over their appearance count, not
// the full series length. Plus-minus stays as the *sum* across appearances
// because cumulative impact is what +/- is built to express.
function seriesPlayersFromAverages(lines: PlayerSeriesLine[]): PlayerStatRow[] {
  return lines.map((l) => {
    const gp = l.games_played;
    const avg = (total: number) => (gp > 0 ? total / gp : null);
    return {
      name: l.player_name,
      minutes: gp > 0 ? l.total_minutes_seconds / 60 / gp : null,
      pts: avg(l.total_pts),
      reb: avg(l.total_reb),
      ast: avg(l.total_ast),
      stl: avg(l.total_stl),
      blk: avg(l.total_blk),
      plusMinus: l.total_plus_minus,
    };
  });
}

const STAT_COLS: { key: keyof PlayerStatRow; label: string }[] = [
  { key: 'minutes', label: 'MIN' },
  { key: 'pts', label: 'PTS' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
  { key: 'stl', label: 'STL' },
  { key: 'blk', label: 'BLK' },
  { key: 'plusMinus', label: '+/-' },
];

function TeamBlock({
  franchise,
  score,
  isWinner,
  players,
  padTo,
  mode,
  eyebrow,
  c,
}: {
  franchise: ArchiveFranchiseSeason;
  score: number | null;
  isWinner: boolean;
  players: PlayerStatRow[];
  /** Render empty placeholder rows up to this count so the two team blocks
   *  match vertical height even when one team has fewer surfaced players. */
  padTo?: number;
  /** 'game' = single-game stats as integers; 'series' = per-game averages
   *  with one decimal (except +/- which stays a sum). */
  mode: 'game' | 'series';
  /** Optional inline label rendered in the team header (right side, before
   *  the score). Used on the FIRST team block to surface "GAME N" /
   *  "SERIES AVG" without spending a separate row of vertical space. */
  eyebrow?: string;
  c: ReturnType<typeof useArchiveColors>;
}) {
  const padding = padTo != null ? Math.max(0, padTo - players.length) : 0;
  return (
    <View style={styles.teamBlock}>
      <View style={[styles.teamBlockHeader, { borderBottomColor: c.border }]}>
        <ArchiveTeamLogo
          franchiseId={franchise.franchise_id}
          tricode={franchise.tricode}
          primaryColor={franchise.primary_color}
          secondaryColor={franchise.secondary_color}
          logoKey={franchise.logo_key}
          size={s(18)}
        />
        <ThemedText
          type="varsitySmall"
          style={[styles.teamBlockTricode, { color: c.text }]}
        >
          {franchise.tricode}
        </ThemedText>
        {eyebrow && (
          <ThemedText
            type="varsitySmall"
            style={[styles.teamBlockInlineEyebrow, { color: c.heritageGold }]}
          >
            {eyebrow}
          </ThemedText>
        )}
        {score != null && (
          <ThemedText
            style={[
              styles.teamBlockScore,
              { color: isWinner ? c.gold : c.text },
            ]}
          >
            {score}
          </ThemedText>
        )}
      </View>
      {/* Column header row — printed once per team block so both blocks
          stay self-describing if the user only sees one at a time. */}
      <View style={styles.statHeaderRow}>
        <View style={styles.statHeaderNameSpacer} />
        {STAT_COLS.map((col, j) => (
          <ThemedText
            key={col.key}
            type="varsitySmall"
            style={[
              styles.statHeaderCell,
              { color: c.secondaryText },
              // Column zebra — uses heritageGoldMuted (warm gold tint) so
              // it reads as visually distinct from the row zebra's cream
              // cardAlt. The two stripes overlay independently in the
              // rows, giving a 4-shade checker pattern.
              j % 2 === 1 && { backgroundColor: c.heritageGoldMuted },
            ]}
            accessible={false}
          >
            {col.label}
          </ThemedText>
        ))}
      </View>
      {players.map((p, i) => (
        <Fragment key={`${p.name}-${i}`}>
          {/* Gold hairline between rank 5 (last starter) and rank 6 (first
              bench). The scraper guarantees ranks 1-5 are starters,
              6-7 are bench. */}
          {i === 5 && (
            <View
              style={[styles.starterDivider, { backgroundColor: c.heritageGold }]}
            />
          )}
          <View
            style={[
              styles.statPlayerRow,
              // Zebra stripe — odd-indexed rows get a subtle cardAlt tint
              // so the tight 7-column stat numbers stay readable.
              i % 2 === 1 && { backgroundColor: c.cardAlt },
            ]}
          >
            <ThemedText
              style={[styles.statPlayerName, { color: c.text }]}
              numberOfLines={1}
            >
              {p.name}
            </ThemedText>
            {STAT_COLS.map((col, j) => {
              const v = p[col.key];
              const isPm = col.key === 'plusMinus';
              const numV = typeof v === 'number' ? v : null;
              const color = !isPm
                ? c.text
                : numV == null
                  ? c.text
                  : numV > 0
                    ? c.gold
                    : numV < 0
                      ? c.secondaryText
                      : c.text;
              // Series mode shows per-game averages with one decimal for
              // counting stats (PTS/REB/AST/STL/BLK/MIN); +/- stays an
              // integer sum so it reads as cumulative impact. Game mode
              // shows everything as integers (one game's stats).
              const display =
                numV == null
                  ? '—'
                  : isPm
                    ? `${numV >= 0 ? '+' : ''}${Math.round(numV)}`
                    : mode === 'series'
                      ? numV.toFixed(1)
                      : String(Math.round(numV));
              return (
                <ThemedText
                  key={col.key}
                  style={[
                    styles.statCell,
                    { color },
                    // Column zebra — heritageGoldMuted is rgba so it
                    // composites OVER the row's cardAlt bg, giving the
                    // tinted-row × tinted-col cell a slightly darker,
                    // warmer tone than either stripe alone.
                    j % 2 === 1 && { backgroundColor: c.heritageGoldMuted },
                  ]}
                >
                  {display}
                </ThemedText>
              );
            })}
          </View>
        </Fragment>
      ))}
      {Array.from({ length: padding }).map((_, i) => (
        <View key={`pad-${i}`} style={styles.statPlayerRow} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Expanded section — sits inside the card as the first child, animates
  // height from 0 → EXPANDED_HEIGHT. Combined with the card's negative
  // animated marginTop, the visual effect is the card's TOP edge sliding
  // upward over the bracket while the bottom stays anchored. Single-card
  // appearance: same border, shadow, and rounded corners as the rest.
  // Horizontal negative margin lets the divider line span edge-to-edge of
  // the card; no vertical margins so the section contributes zero space
  // when collapsed (height: 0). Spacing between the section content and
  // the eyebrow comes from the eyebrow's own padding when the section is
  // open, and the divider provides the visual break.
  expandedSection: {
    overflow: 'hidden',
    marginHorizontal: -s(12),
  },
  expandedDivider: {
    height: StyleSheet.hairlineWidth,
  },
  expandedInner: {
    flex: 1,
    paddingHorizontal: s(10),
    paddingTop: s(14),
    paddingBottom: s(2),
  },
  expandedEmpty: {
    fontSize: ms(11),
    fontStyle: 'italic',
  },

  // Vertically-stacked expanded panel: one block per team. Team A on top
  // mirrors the lower card's upper row. Each block has its own header
  // (logo + tricode + score) and a 7-row rotation table.
  teamBlock: {
    marginBottom: s(8),
  },
  teamBlockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    paddingBottom: s(3),
    // Fixed minHeight so the row's height doesn't depend on whether a
    // score is rendered. Series mode has no score; game mode does. Without
    // this minHeight, the slightly-taller score text shifted the row's
    // height when toggling between modes, knocking the rest of the
    // panel's content up/down by ~2px.
    minHeight: s(24),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  teamBlockTricode: {
    fontSize: ms(12),
    letterSpacing: 0.8,
    fontWeight: '700',
  },
  // Inline eyebrow rendered on the FIRST team block's header to surface
  // "GAME N" / "SERIES AVG" without spending a separate row of vertical
  // height. flex:1 lets it consume slack between tricode and score.
  teamBlockInlineEyebrow: {
    flex: 1,
    fontSize: ms(9),
    letterSpacing: 1.0,
    textAlign: 'right',
    paddingHorizontal: s(6),
  },
  teamBlockScore: {
    fontFamily: Fonts.mono,
    fontSize: ms(15),
    fontWeight: '800',
    marginLeft: 'auto',
    letterSpacing: -0.3,
  },
  // Column header row above each team's player rows — labels the 7 stat
  // columns so the user knows what each number means.
  statHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(1),
  },
  statHeaderNameSpacer: {
    flex: 1,
    minWidth: 0,
  },
  statHeaderCell: {
    fontSize: ms(8),
    letterSpacing: 0.8,
    minWidth: s(32),
    textAlign: 'center',
  },
  // Player row in a team block: name (flex) + 7 stat cells. Subtle zebra
  // stripe (alternating cardAlt bg) on odd indices for readability.
  statPlayerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: s(20),
    paddingVertical: s(2),
  },
  statPlayerName: {
    flex: 1,
    fontSize: ms(11),
    fontWeight: '600',
    letterSpacing: -0.2,
    minWidth: 0,
    paddingRight: s(2),
  },
  statCell: {
    fontFamily: Fonts.mono,
    fontVariant: ['tabular-nums'],
    fontSize: ms(10),
    fontWeight: '600',
    minWidth: s(32),
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  // Gold hairline that visually splits starters (1-5) from bench (6-7).
  starterDivider: {
    height: 1,
    opacity: 0.6,
    marginVertical: s(1),
  },

  // Expand chevron toggle in the eyebrow row.
  expandToggle: {
    paddingHorizontal: s(2),
  },

  card: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: s(12),
    overflow: 'hidden',
    // No paddingVertical here on purpose — vertical padding lives on the
    // inner cardBody so the expandedSection (rendered before cardBody)
    // can extend all the way to the card's top edge. That way the
    // expandedSection's bottom hairline divider lands exactly at the
    // card's original (collapsed) top position, while the cardBody's own
    // paddingTop restores breathing room above the eyebrow.
    //
    // marginTop is set by animatedCardStyle (COLLAPSED_TOP_GAP when closed,
    // shrinking into negative when expanded). Static marginTop here would
    // be overridden by Reanimated and the gap above the card would
    // disappear at rest.
    //
    // When the card grows upward via negative marginTop, we render above
    // the bracket, mode toggle, AND the outer Standings/Playoffs/Awards
    // segmented control. zIndex on iOS, elevation on Android.
    zIndex: 100,
    elevation: 100,
  },
  cardBody: {
    paddingVertical: s(10),
  },

  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    marginBottom: s(6),
  },
  eyebrowRule: {
    height: 2,
    width: s(18),
  },
  eyebrow: {
    fontSize: ms(10),
    letterSpacing: 1.3,
    flex: 1,
  },
  winnerTag: {
    fontSize: ms(10),
    letterSpacing: 1.3,
    fontWeight: '700',
  },

  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(8),
    paddingHorizontal: s(6),
    gap: s(10),
    borderRadius: 8,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  mvpBlock: {
    paddingTop: s(8),
    paddingBottom: s(2),
    paddingHorizontal: s(4),
  },
  mvpDivider: {
    height: 1,
    opacity: 0.5,
    marginBottom: s(8),
  },
  mvpEyebrow: {
    fontSize: ms(9),
    letterSpacing: 1.0,
  },
  mvpName: {
    fontSize: ms(15),
    fontWeight: '700',
    letterSpacing: -0.2,
    marginTop: 2,
  },
  mvpStatLine: {
    fontSize: ms(11),
    letterSpacing: 0.2,
    marginTop: 2,
  },
  seedBadge: {
    width: s(22),
    height: s(22),
    borderRadius: s(11),
    alignItems: 'center',
    justifyContent: 'center',
  },
  seedText: {
    fontFamily: Fonts.mono,
    fontSize: ms(10),
    fontWeight: '700',
  },
  labels: {
    flex: 1,
    minWidth: 0,
  },
  cityName: {
    fontSize: ms(15),
    lineHeight: ms(18),
  },
  teamName: {
    fontSize: ms(11),
    lineHeight: ms(13),
    marginTop: 1,
  },
  wins: {
    fontFamily: Fonts.mono,
    fontSize: ms(20),
    fontVariant: ['tabular-nums'],
  },

  rowPips: {
    flexDirection: 'row',
    gap: s(3),
    alignItems: 'center',
  },
  // Each game gets a column: pip + score (top row) or score + pip (bottom).
  // Width is fixed (slightly wider than 3-digit scores) so columns stay
  // aligned across the two team rows — important so an upper-row score and
  // its lower-row counterpart sit one above the other.
  pipCol: {
    width: s(22),
    alignItems: 'center',
    gap: s(2),
  },
  pipScore: {
    fontSize: ms(9),
    fontFamily: Fonts.mono,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.3,
    textAlign: 'center',
    minWidth: s(22),
  },
  rowPip: {
    width: s(14),
    height: s(14),
    borderRadius: s(7),
    borderWidth: 1.5,
  },

  hintWrap: {
    flex: 1,
    minHeight: s(126),
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    fontSize: ms(10),
    letterSpacing: 1.3,
  },
});
