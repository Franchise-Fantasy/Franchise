import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  NhlArchiveFranchiseSeason,
  NhlArchiveGame,
  NhlArchiveGameBoxLine,
  NhlArchiveSeries,
} from '@/types/archiveNhlPlayoff';
import { type NhlPlayerSeriesLine, nhlTopPlayersPerTeam } from '@/utils/nhlSeriesLeaders';
import { ms, s } from '@/utils/scale';

interface Props {
  series: NhlArchiveSeries | null;
  franchiseMap: Map<string, NhlArchiveFranchiseSeason>;
  games: NhlArchiveGame[];
  totalGames: number;
  onTeamTap: (franchiseId: string) => void;
  /** Conn Smythe — only consumed when this card is showing the SCF and the
   *  series has decided. */
  connSmythe?: {
    playerName: string;
    franchiseId: string | null;
    statLine: string | null;
  } | null;
}

const ROUND_LABELS: Record<number, string> = {
  1: 'FIRST ROUND',
  2: 'SECOND ROUND',
  3: 'CONFERENCE FINAL',
  4: 'STANLEY CUP',
};

// Compute per-game winner from the home/away scores (NHL games table doesn't
// store winner_franchise_id directly).
function gameWinnerId(game: NhlArchiveGame): string | null {
  if (game.home_score == null || game.away_score == null) return null;
  if (game.home_score > game.away_score) return game.home_franchise_id;
  if (game.away_score > game.home_score) return game.away_franchise_id;
  return null;
}

function scoreForTeam(teamId: string, game: NhlArchiveGame): number | null {
  if (game.home_franchise_id === teamId) return game.home_score;
  if (game.away_franchise_id === teamId) return game.away_score;
  return null;
}

export function NhlSeriesDetailCard({
  series,
  franchiseMap,
  games,
  totalGames,
  onTeamTap,
  connSmythe,
}: Props) {
  const c = useArchiveColors();
  const [selectedGameNum, setSelectedGameNum] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setSelectedGameNum(null);
    setExpanded(false);
  }, [series?.id]);

  const COLLAPSED_TOP_GAP = s(16);
  const insets = useSafeAreaInsets();
  const PAGE_HEADER_HEIGHT = s(50);
  const cardRef = useRef<View>(null);
  const measuredRef = useRef(false);
  const [maxExpand, setMaxExpand] = useState(s(280));
  const handleCardLayout = useCallback(() => {
    if (measuredRef.current) return;
    cardRef.current?.measureInWindow((_x, y) => {
      if (y <= 0) return;
      measuredRef.current = true;
      const targetTop = insets.top + PAGE_HEADER_HEIGHT;
      const max = Math.max(y - targetTop, s(120));
      setMaxExpand(max);
    });
  }, [insets.top, PAGE_HEADER_HEIGHT]);

  const expandedHeight = useSharedValue(0);
  useEffect(() => {
    expandedHeight.value = withTiming(expanded ? maxExpand : 0, { duration: 260 });
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
  const isFinals = series?.conference === 'Final';

  const sortedGames = [...games].sort((a, b) => a.game_num - b.game_num);
  const liveWinsA = series
    ? sortedGames.filter((g) => gameWinnerId(g) === series.franchise_a_id).length
    : 0;
  const liveWinsB = series
    ? sortedGames.filter((g) => gameWinnerId(g) === series.franchise_b_id).length
    : 0;
  const isComplete = liveWinsA >= 4 || liveWinsB >= 4;
  const liveWinnerId = isComplete
    ? liveWinsA > liveWinsB
      ? series?.franchise_a_id ?? null
      : series?.franchise_b_id ?? null
    : null;

  const winnerTag = (() => {
    if (!series || !liveWinnerId) return null;
    const winner = franchiseMap.get(liveWinnerId);
    if (!winner) return null;
    const played = liveWinsA + liveWinsB;
    return `${winner.tricode} IN ${played}`;
  })();

  const selectedGame = useMemo(
    () =>
      selectedGameNum != null
        ? sortedGames.find((g) => g.game_num === selectedGameNum) ?? null
        : null,
    [sortedGames, selectedGameNum],
  );

  const topPlayers = useMemo(
    () =>
      series
        ? nhlTopPlayersPerTeam(
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
              {!isFinals && series.division
                ? `   ·   ${series.division.toUpperCase()}`
                : !isFinals && series.conference
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
            onPipTap={(gn) => setSelectedGameNum((cur) => (cur === gn ? null : gn))}
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
            onPipTap={(gn) => setSelectedGameNum((cur) => (cur === gn ? null : gn))}
            position="bottom"
            c={c}
          />
          {isFinals && liveWinnerId && connSmythe ? (
            <View
              style={styles.mvpBlock}
              accessibilityLabel={`Conn Smythe: ${connSmythe.playerName}${connSmythe.statLine ? `, ${connSmythe.statLine}` : ''}`}
            >
              <View style={[styles.mvpDivider, { backgroundColor: c.gold }]} />
              <ThemedText
                type="varsitySmall"
                style={[styles.mvpEyebrow, { color: c.gold }]}
              >
                CONN SMYTHE
              </ThemedText>
              <ThemedText
                style={[styles.mvpName, { color: c.text }]}
                numberOfLines={1}
              >
                {connSmythe.playerName}
              </ThemedText>
              {connSmythe.statLine ? (
                <ThemedText
                  style={[styles.mvpStatLine, { color: c.secondaryText }]}
                  numberOfLines={1}
                >
                  {connSmythe.statLine}
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
  franchise: NhlArchiveFranchiseSeason;
  seed: number | null;
  wins: number;
  isWinner: boolean;
  games: NhlArchiveGame[];
  totalGames: number;
  onPress: () => void;
  selectedGameNum: number | null;
  onPipTap: (gameNum: number) => void;
  position: 'top' | 'bottom';
  c: ReturnType<typeof useArchiveColors>;
}) {
  const fill = franchise.primary_color ?? c.text;
  const ring = franchise.secondary_color ?? c.border;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${franchise.city} ${franchise.name}, seed ${seed ?? '—'}, ${wins} wins${isWinner ? ', winner' : ''}.`}
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
        sport="nhl"
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
            const winnerId = gameWinnerId(g);
            const won = winnerId === franchise.franchise_id;
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
                  isSelected && { borderColor: c.gold, borderWidth: 2 },
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

function ExpandedPanelContent({
  selectedGame,
  teamA,
  teamB,
  topPlayers,
  c,
}: {
  selectedGame: NhlArchiveGame | null;
  teamA: NhlArchiveFranchiseSeason;
  teamB: NhlArchiveFranchiseSeason;
  topPlayers: { teamA: NhlPlayerSeriesLine[]; teamB: NhlPlayerSeriesLine[] };
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
          mode="game"
          eyebrow={`GAME ${selectedGame.game_num}`}
          c={c}
        />
        <TeamBlock
          franchise={teamB}
          score={scoreB}
          isWinner={winnerB}
          players={playersB}
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
            players={seriesPlayerRows(topPlayers.teamA)}
            mode="series"
            eyebrow="SERIES TOTAL · AVG TOI"
            c={c}
          />
          <TeamBlock
            franchise={teamB}
            score={null}
            isWinner={false}
            players={seriesPlayerRows(topPlayers.teamB)}
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
  position: string | null;
  /** TOI is total seconds across the games this row represents. In series
   *  mode the renderer divides by `gamesPlayed` to produce avg-per-game. */
  toiSec: number | null;
  /** 1 in game mode; per-player series GP in series mode. */
  gamesPlayed: number;
  goals: number | null;
  assists: number | null;
  points: number | null;
  plusMinus: number | null;
  sog: number | null;
  // Goalie-specific
  saves: number | null;
  shotsAgainst: number | null;
  goalsAgainst: number | null;
}

function gamePlayersFromBox(lines: NhlArchiveGameBoxLine[] | undefined): PlayerStatRow[] {
  if (!lines) return [];
  return lines.map((l) => ({
    name: l.player_name,
    position: l.position,
    toiSec: l.toi_seconds,
    gamesPlayed: 1,
    goals: l.goals,
    assists: l.assists,
    points: l.points,
    plusMinus: l.plus_minus,
    sog: l.sog,
    saves: l.saves,
    shotsAgainst: l.shots_against,
    goalsAgainst: l.goals_against,
  }));
}

function seriesPlayerRows(lines: NhlPlayerSeriesLine[]): PlayerStatRow[] {
  return lines.map((l) => ({
    name: l.player_name,
    position: l.position,
    toiSec: l.total_toi_seconds,
    gamesPlayed: l.games_played,
    goals: l.total_goals,
    assists: l.total_assists,
    points: l.total_points,
    plusMinus: l.total_plus_minus,
    sog: l.total_sog,
    saves: l.total_saves,
    shotsAgainst: l.total_shots_against,
    goalsAgainst: l.total_goals_against,
  }));
}

// Two separate column sets — goalies have a fundamentally different stat
// shape (saves/shots-against/SV%) than skaters, so they get their own table
// header instead of sharing repurposed columns.
const SKATER_COLS = [
  { key: 'toi', label: 'TOI' },
  { key: 'g',   label: 'G' },
  { key: 'a',   label: 'A' },
  { key: 'p',   label: 'P' },
  { key: 'pm',  label: '+/-' },
  { key: 'sog', label: 'SOG' },
] as const;

const GOALIE_COLS = [
  { key: 'toi',   label: 'TOI' },
  { key: 'sv',    label: 'SV' },
  { key: 'sa',    label: 'SA' },
  { key: 'svpct', label: 'SV%' },
  { key: 'ga',    label: 'GA' },
] as const;

function formatToi(sec: number | null): string {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Position tag rendered next to each player's name. NHL API gives single-
// letter codes (C/L/R/D for skaters, G for goalies) — pass through as-is.
function PositionTag({ position, c }: { position: string | null; c: ReturnType<typeof useArchiveColors> }) {
  if (!position) return null;
  return (
    <ThemedText style={{ color: c.heritageGold, fontSize: ms(8), fontWeight: '700' }}>
      {`  ${position}`}
    </ThemedText>
  );
}

function TeamBlock({
  franchise,
  score,
  isWinner,
  players,
  mode,
  eyebrow,
  c,
}: {
  franchise: NhlArchiveFranchiseSeason;
  score: number | null;
  isWinner: boolean;
  players: PlayerStatRow[];
  mode: 'game' | 'series';
  eyebrow?: string;
  c: ReturnType<typeof useArchiveColors>;
}) {
  // Split out goalies first — they get their own mini-table above the
  // skater rows. There's almost always 1 goalie per team per game.
  const goalies = players.filter((p) => p.position === 'G');
  const skaters = players.filter((p) => p.position !== 'G');

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
          sport="nhl"
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

      {/* Goalie strip — usually 1 row, sometimes 2 if a starter was pulled
          mid-game and both played meaningful minutes. */}
      {goalies.length > 0 && (
        <>
          <StatHeaderRow cols={GOALIE_COLS} c={c} />
          {goalies.map((g, i) => (
            <GoalieRow key={`g-${g.name}-${i}`} p={g} mode={mode} zebra={i % 2 === 1} c={c} />
          ))}
        </>
      )}

      {/* Skater table */}
      {skaters.length > 0 && (
        <>
          <StatHeaderRow cols={SKATER_COLS} c={c} />
          {skaters.map((p, i) => (
            <SkaterRow key={`s-${p.name}-${i}`} p={p} mode={mode} zebra={i % 2 === 1} c={c} />
          ))}
        </>
      )}
    </View>
  );
}

function StatHeaderRow({
  cols,
  c,
}: {
  cols: readonly { key: string; label: string }[];
  c: ReturnType<typeof useArchiveColors>;
}) {
  return (
    <View style={styles.statHeaderRow}>
      <View style={styles.statHeaderNameSpacer} />
      {cols.map((col, j) => (
        <ThemedText
          key={col.key}
          type="varsitySmall"
          style={[
            styles.statHeaderCell,
            { color: c.secondaryText },
            j % 2 === 1 && { backgroundColor: c.heritageGoldMuted },
          ]}
          accessible={false}
        >
          {col.label}
        </ThemedText>
      ))}
    </View>
  );
}

function SkaterRow({
  p,
  mode,
  zebra,
  c,
}: {
  p: PlayerStatRow;
  mode: 'game' | 'series';
  zebra: boolean;
  c: ReturnType<typeof useArchiveColors>;
}) {
  // TOI: game mode = single-game seconds; series mode = avg per game.
  const toiDisplay = (() => {
    if (p.toiSec == null) return '—';
    const sec = mode === 'series' && p.gamesPlayed > 0
      ? Math.round(p.toiSec / p.gamesPlayed)
      : p.toiSec;
    return formatToi(sec);
  })();

  const pmV = p.plusMinus;
  const pmDisplay = pmV == null ? '—' : `${pmV >= 0 ? '+' : ''}${pmV}`;
  const pmColor =
    pmV == null ? c.text : pmV > 0 ? c.gold : pmV < 0 ? c.secondaryText : c.text;

  const cells: { display: string; color: string }[] = [
    { display: toiDisplay, color: c.text },
    { display: String(p.goals ?? 0), color: mode === 'series' && (p.goals ?? 0) >= 5 ? c.gold : c.text },
    { display: String(p.assists ?? 0), color: c.text },
    { display: String(p.points ?? 0), color: mode === 'series' && (p.points ?? 0) >= 5 ? c.gold : c.text },
    { display: pmDisplay, color: pmColor },
    { display: String(p.sog ?? 0), color: c.text },
  ];

  return (
    <View
      style={[
        styles.statPlayerRow,
        zebra && { backgroundColor: c.cardAlt },
      ]}
    >
      <ThemedText
        style={[styles.statPlayerName, { color: c.text }]}
        numberOfLines={1}
      >
        {p.name}
        <PositionTag position={p.position} c={c} />
      </ThemedText>
      {cells.map((cell, j) => (
        <ThemedText
          key={SKATER_COLS[j].key}
          style={[
            styles.statCell,
            { color: cell.color },
            j % 2 === 1 && { backgroundColor: c.heritageGoldMuted },
          ]}
        >
          {cell.display}
        </ThemedText>
      ))}
    </View>
  );
}

function GoalieRow({
  p,
  mode,
  zebra,
  c,
}: {
  p: PlayerStatRow;
  mode: 'game' | 'series';
  zebra: boolean;
  c: ReturnType<typeof useArchiveColors>;
}) {
  const sa = p.shotsAgainst ?? 0;
  const ga = p.goalsAgainst ?? 0;
  const sv = p.saves ?? Math.max(0, sa - ga);
  const svPct = sa > 0 ? sv / sa : null;
  const toiDisplay = (() => {
    if (p.toiSec == null) return '—';
    const sec = mode === 'series' && p.gamesPlayed > 0
      ? Math.round(p.toiSec / p.gamesPlayed)
      : p.toiSec;
    return formatToi(sec);
  })();

  const cells: { display: string; color: string }[] = [
    { display: toiDisplay, color: c.text },
    { display: String(sv), color: c.text },
    { display: String(sa), color: c.text },
    { display: svPct != null ? svPct.toFixed(3).replace(/^0/, '') : '—', color: svPct != null && svPct >= 0.93 ? c.gold : c.text },
    { display: String(ga), color: ga === 0 && (mode === 'game' || sa > 0) ? c.gold : c.text },
  ];

  return (
    <View
      style={[
        styles.statPlayerRow,
        zebra && { backgroundColor: c.cardAlt },
      ]}
    >
      <ThemedText
        style={[styles.statPlayerName, { color: c.text }]}
        numberOfLines={1}
      >
        {p.name}
        <PositionTag position={p.position} c={c} />
      </ThemedText>
      {cells.map((cell, j) => (
        <ThemedText
          key={GOALIE_COLS[j].key}
          style={[
            styles.statCell,
            { color: cell.color },
            j % 2 === 1 && { backgroundColor: c.heritageGoldMuted },
          ]}
        >
          {cell.display}
        </ThemedText>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  expandedSection: {
    overflow: 'hidden',
    marginHorizontal: -s(12),
  },
  expandedDivider: { height: StyleSheet.hairlineWidth },
  expandedInner: {
    flex: 1,
    paddingHorizontal: s(10),
    paddingTop: s(14),
    paddingBottom: s(2),
  },
  expandedEmpty: { fontSize: ms(11), fontStyle: 'italic' },

  teamBlock: { marginBottom: s(8) },
  teamBlockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    paddingBottom: s(3),
    minHeight: s(24),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  teamBlockTricode: {
    fontSize: ms(12),
    letterSpacing: 0.8,
    fontWeight: '700',
  },
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
  statHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(1),
  },
  statHeaderNameSpacer: { flex: 1, minWidth: 0 },
  statHeaderCell: {
    fontSize: ms(8),
    letterSpacing: 0.8,
    minWidth: s(36),
    textAlign: 'center',
  },
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
    minWidth: s(36),
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  starterDivider: {
    height: 1,
    opacity: 0.6,
    marginVertical: s(1),
  },

  expandToggle: { paddingHorizontal: s(2) },

  card: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: s(12),
    overflow: 'hidden',
    zIndex: 100,
    elevation: 100,
  },
  cardBody: { paddingVertical: s(10) },

  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    marginBottom: s(6),
  },
  eyebrowRule: { height: 2, width: s(18) },
  eyebrow: { fontSize: ms(10), letterSpacing: 1.3, flex: 1 },
  winnerTag: { fontSize: ms(10), letterSpacing: 1.3, fontWeight: '700' },

  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(8),
    paddingHorizontal: s(6),
    gap: s(10),
    borderRadius: 8,
  },
  divider: { height: StyleSheet.hairlineWidth },
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
  mvpEyebrow: { fontSize: ms(9), letterSpacing: 1.0 },
  mvpName: {
    fontSize: ms(15),
    fontWeight: '700',
    letterSpacing: -0.2,
    marginTop: 2,
  },
  mvpStatLine: { fontSize: ms(11), letterSpacing: 0.2, marginTop: 2 },
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
  labels: { flex: 1, minWidth: 0 },
  cityName: { fontSize: ms(15), lineHeight: ms(18) },
  teamName: { fontSize: ms(11), lineHeight: ms(13), marginTop: 1 },
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
  hint: { fontSize: ms(10), letterSpacing: 1.3 },
});
