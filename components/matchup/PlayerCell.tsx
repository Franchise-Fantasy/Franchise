import { ScoringWeight } from '@/types/player';
import { formatGameInfo, liveToGameLog, LivePlayerStats } from '@/utils/nbaLive';
import { calculateGameFantasyPoints, formatScore } from '@/utils/fantasyPoints';
import { getInjuryBadge } from '@/utils/injuryBadge';
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

// ─── Types ───────────────────────────────────────────────────────────────────

export type DisplayMode = 'past' | 'today' | 'future';

export interface RosterPlayer {
  player_id: string;
  name: string;
  position: string;
  nba_team: string;
  nbaTricode: string | null;
  roster_slot: string;
  external_id_nba: number | null;
  status: string;
  weekPoints: number;
  dayPoints: number;
  dayMatchup: string | null;
  dayStatLine: string | null;
  projectedFpts: number | null;
  dayGameStats?: Record<string, number | boolean> | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function round1(n: number) {
  return Math.round(n * 100) / 100;
}

// Build a stat line string for a live/historical stat object.
// Only includes stats that the league actually scores.
export function buildStatLine(
  stats: Record<string, number>,
  scoring: ScoringWeight[]
): string {
  const DISPLAY: Record<string, string> = {
    PTS: 'PTS',
    REB: 'REB',
    AST: 'AST',
    STL: 'STL',
    BLK: 'BLK',
    TO: 'TO',
    '3PM': '3PM',
    FGM: 'FGM',
    FGA: 'FGA',
    FTM: 'FTM',
    FTA: 'FTA',
    PF: 'PF',
  };
  const LIVE_KEY: Record<string, string> = {
    PTS: 'pts', REB: 'reb', AST: 'ast', STL: 'stl', BLK: 'blk',
    TO: 'tov', '3PM': '3pm', FGM: 'fgm', FGA: 'fga', FTM: 'ftm',
    FTA: 'fta', PF: 'pf',
  };

  const scoredStatNames = new Set(scoring.map((w) => w.stat_name));
  const toShow = ['PTS', 'REB', 'AST', 'STL', 'BLK', 'TO', '3PM', 'PF'].filter(
    (key) => scoredStatNames.has(key) || key === 'PF'
  );

  return toShow
    .map((key) => {
      const val = stats[LIVE_KEY[key]] ?? 0;
      return `${val} ${DISPLAY[key]}`;
    })
    .join(' · ');
}

// ─── Sub-components ──────────────────────────────────────────────────────────

// Static green dot shown when player is actively on the floor.
function OnCourtDot() {
  return <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#2dc653', marginRight: 2 }} />;
}

// Pops on value change (1 → 1.35 → 1 spring)
function AnimatedFpts({
  value,
  activeColor,
  dimColor,
  textStyle,
  projected,
}: {
  value: number | null;
  activeColor: string;
  dimColor: string;
  textStyle: any;
  projected?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const prev = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    if (prev.current !== undefined && value !== prev.current) {
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.35, duration: 150, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, bounciness: 12 }),
      ]).start();
    }
    prev.current = value;
  }, [value]);

  return (
    <Animated.Text style={[textStyle, { transform: [{ scale }], color: value !== null ? activeColor : dimColor }]}>
      {value !== null ? (projected ? value.toFixed(1) : formatScore(value)) : '—'}
    </Animated.Text>
  );
}

// ─── PlayerCell ──────────────────────────────────────────────────────────────

// Renders a single player cell (one side of a matchup row). No slot badge — that's in the center.
export const PlayerCell = React.memo(function PlayerCell({
  player,
  c,
  side,
  mode,
  liveStats,
  scoring,
  futureSchedule,
  onPress,
  isCategories,
  onFptsPress,
}: {
  player: RosterPlayer | null;
  c: any;
  side: 'left' | 'right';
  mode: DisplayMode;
  liveStats: LivePlayerStats | null;
  scoring: ScoringWeight[];
  futureSchedule?: Map<string, string>;
  onPress?: (playerId: string) => void;
  isCategories?: boolean;
  onFptsPress?: (stats: Record<string, number | boolean>, playerName: string, gameLabel: string) => void;
}) {
  const align = side === 'right' ? 'flex-end' : 'flex-start';
  const textAlign = side === 'right' ? ('right' as const) : ('left' as const);

  const injuryBadge = player ? getInjuryBadge(player.status) : null;

  // Empty slot
  if (!player) {
    return (
      <View style={[pStyles.cell, { alignItems: align }]} accessibilityLabel="Empty slot">
        <Text style={[pStyles.name, { color: c.secondaryText, fontStyle: 'italic', textAlign }]}>Empty</Text>
        <Text style={[pStyles.pts, { color: c.secondaryText, textAlign }]}>—</Text>
      </View>
    );
  }

  const Wrapper = onPress ? TouchableOpacity : View;
  const wrapperProps = onPress
    ? { activeOpacity: 0.6, onPress: () => onPress(player.player_id), accessibilityRole: 'button' as const, accessibilityLabel: `${player.name}, ${player.position}` }
    : { accessibilityLabel: `${player.name}, ${player.position}` };

  if (mode === 'future') {
    const futureMatchup = player.nbaTricode ? (futureSchedule?.get(player.nbaTricode) ?? null) : null;
    const projValue = futureMatchup && player.projectedFpts != null ? player.projectedFpts : null;
    return (
      <Wrapper style={[pStyles.cell, { alignItems: align }]} {...wrapperProps}>
        <View style={[pStyles.nameRow, { justifyContent: align }]}>
          <Text style={[pStyles.name, { color: c.text, textAlign }]} numberOfLines={1}>{player.name}</Text>
          {futureMatchup ? (
            <Text style={[pStyles.matchup, { color: c.secondaryText }]}>{futureMatchup}</Text>
          ) : null}
          {injuryBadge && (
            <View style={[pStyles.liveBadge, { backgroundColor: injuryBadge.color }]}>
              <Text style={pStyles.liveText}>{injuryBadge.label}</Text>
            </View>
          )}
        </View>
        <Text style={[pStyles.meta, { color: c.secondaryText, textAlign }]}>
          {futureMatchup ? `${player.position} · proj` : player.position}
        </Text>
        {!isCategories && (
          <Text style={[pStyles.pts, { color: projValue != null ? c.text : c.secondaryText, textAlign }]}>
            {projValue != null ? projValue.toFixed(1) : '—'}
          </Text>
        )}
      </Wrapper>
    );
  }

  if (liveStats && (mode === 'today' || mode === 'past')) {
    const liveFp = round1(calculateGameFantasyPoints(liveToGameLog(liveStats) as any, scoring));
    const isLive = liveStats.game_status === 2;
    const statLine = liveStats.game_status !== 1
      ? buildStatLine(liveToGameLog(liveStats) as Record<string, number>, scoring)
      : null;
    const gameInfo = formatGameInfo(liveStats);

    return (
      <Wrapper style={[pStyles.cell, { alignItems: align }]} {...wrapperProps}>
        <View style={[pStyles.nameRow, { justifyContent: align }]}>
          {liveStats.oncourt && isLive && <OnCourtDot />}
          <Text style={[pStyles.name, { color: c.text, flexShrink: 1, textAlign }]} numberOfLines={1}>{player.name}</Text>
          {liveStats.matchup ? (
            <Text style={[pStyles.matchup, { color: c.secondaryText }]}>{liveStats.matchup}</Text>
          ) : null}
          {injuryBadge && (
            <View style={[pStyles.liveBadge, { backgroundColor: injuryBadge.color }]}>
              <Text style={pStyles.liveText}>{injuryBadge.label}</Text>
            </View>
          )}
          {isLive && (
            <View style={[pStyles.liveBadge, { backgroundColor: '#e03131' }]}>
              <Text style={pStyles.liveText}>LIVE</Text>
            </View>
          )}
        </View>
        {gameInfo ? (
          <Text style={[pStyles.meta, { color: c.secondaryText, fontSize: 10, lineHeight: 13, textAlign }]} numberOfLines={1}>
            {gameInfo}
          </Text>
        ) : null}
        <Text style={[pStyles.meta, { color: c.secondaryText, textAlign }]} numberOfLines={1}>
          {statLine ?? player.position}
        </Text>
        {!isCategories && (
          onFptsPress ? (
            <TouchableOpacity
              onPress={() => onFptsPress(liveToGameLog(liveStats) as Record<string, number | boolean>, player.name, liveStats.matchup ?? '')}
              accessibilityRole="button"
              accessibilityLabel={`View breakdown: ${liveFp} fantasy points`}
            >
              <AnimatedFpts value={liveFp} activeColor={c.text} dimColor={c.secondaryText} textStyle={[pStyles.pts, { textAlign }]} />
            </TouchableOpacity>
          ) : (
            <AnimatedFpts value={liveFp} activeColor={c.text} dimColor={c.secondaryText} textStyle={[pStyles.pts, { textAlign }]} />
          )
        )}
      </Wrapper>
    );
  }

  // today with no live entry yet
  if (mode === 'today') {
    const todayMatchup = player.nbaTricode ? (futureSchedule?.get(player.nbaTricode) ?? null) : null;
    const projValue = todayMatchup && player.projectedFpts != null ? player.projectedFpts : null;
    return (
      <Wrapper style={[pStyles.cell, { alignItems: align }]} {...wrapperProps}>
        <View style={[pStyles.nameRow, { justifyContent: align }]}>
          <Text style={[pStyles.name, { color: c.text, flexShrink: 1, textAlign }]} numberOfLines={1}>{player.name}</Text>
          {todayMatchup ? (
            <Text style={[pStyles.matchup, { color: c.secondaryText }]}>{todayMatchup}</Text>
          ) : null}
          {injuryBadge && (
            <View style={[pStyles.liveBadge, { backgroundColor: injuryBadge.color }]}>
              <Text style={pStyles.liveText}>{injuryBadge.label}</Text>
            </View>
          )}
        </View>
        <Text style={[pStyles.meta, { color: c.secondaryText, textAlign }]}>
          {todayMatchup ? `${player.position} · proj` : player.position}
        </Text>
        {!isCategories && (
          <AnimatedFpts value={projValue} activeColor={c.text} dimColor={c.secondaryText} textStyle={[pStyles.pts, { textAlign }]} projected />
        )}
      </Wrapper>
    );
  }

  // past
  const hasDayGame = player.dayPoints > 0;
  const canShowBreakdown = hasDayGame && onFptsPress && player.dayGameStats;
  return (
    <Wrapper style={[pStyles.cell, { alignItems: align }]} {...wrapperProps}>
      <View style={[pStyles.nameRow, { justifyContent: align }]}>
        <Text style={[pStyles.name, { color: c.text, flexShrink: 1, textAlign }]} numberOfLines={1}>{player.name}</Text>
        {hasDayGame && player.dayMatchup ? (
          <Text style={[pStyles.matchup, { color: c.secondaryText }]}>{player.dayMatchup}</Text>
        ) : null}
        {injuryBadge && (
          <View style={[pStyles.liveBadge, { backgroundColor: injuryBadge.color }]}>
            <Text style={pStyles.liveText}>{injuryBadge.label}</Text>
          </View>
        )}
      </View>
      <Text style={[pStyles.meta, { color: c.secondaryText, textAlign }]} numberOfLines={1}>
        {hasDayGame && player.dayStatLine ? player.dayStatLine : player.position}
      </Text>
      {!isCategories && (
        canShowBreakdown ? (
          <TouchableOpacity
            onPress={() => onFptsPress!(player.dayGameStats!, player.name, player.dayMatchup ?? '')}
            accessibilityRole="button"
            accessibilityLabel={`View breakdown: ${player.dayPoints} fantasy points`}
          >
            <AnimatedFpts
              value={player.dayPoints}
              activeColor={c.text}
              dimColor={c.secondaryText}
              textStyle={[pStyles.pts, { textAlign }]}
            />
          </TouchableOpacity>
        ) : (
          <AnimatedFpts
            value={hasDayGame ? player.dayPoints : null}
            activeColor={c.text}
            dimColor={c.secondaryText}
            textStyle={[pStyles.pts, { textAlign }]}
          />
        )
      )}
    </Wrapper>
  );
});

// ─── Styles ──────────────────────────────────────────────────────────────────

export const pStyles = StyleSheet.create({
  slotRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  cell: { flex: 1, paddingHorizontal: 2 },
  slotCenter: { width: 34, alignItems: 'center', justifyContent: 'center' },
  slotText: { fontSize: 10, fontWeight: '600' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 },
  name: { fontSize: 12, fontWeight: '500' },
  matchup: { fontSize: 9, fontWeight: '600' },
  meta: { fontSize: 10 },
  pts: { fontSize: 13, fontWeight: '700' },
  liveBadge: { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3 },
  liveText: { color: '#fff', fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },
});
