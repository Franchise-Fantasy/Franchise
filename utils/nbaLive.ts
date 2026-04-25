import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { supabase } from '@/lib/supabase';
import { addDays, toDateStr } from '@/utils/dates';

export interface LivePlayerStats {
  player_id: string;
  game_id: string;
  game_date: string;
  game_status: number; // 1=scheduled, 2=live, 3=final
  period: number;
  game_clock: string; // ISO duration format: "PT05M23.00S"
  matchup: string;    // e.g. "vs MIA" or "@BOS"
  home_score: number;
  away_score: number;
  oncourt: boolean;   // true when player is currently on the floor
  pts: number;
  reb: number;
  ast: number;
  blk: number;
  stl: number;
  tov: number;
  fgm: number;
  fga: number;
  '3pm': number;
  '3pa': number;
  ftm: number;
  fta: number;
  pf: number;
}

// "1st", "2nd", "3rd", "4th", "OT", "OT2", ...
export function formatPeriod(period: number): string {
  if (period <= 0) return '';
  if (period === 1) return '1st';
  if (period === 2) return '2nd';
  if (period === 3) return '3rd';
  if (period === 4) return '4th';
  const ot = period - 4;
  return ot === 1 ? 'OT' : `OT${ot}`;
}

// "PT05M23.00S" → "5:23"
export function formatClock(clock: string): string {
  const match = clock?.match(/PT(\d+)M([\d.]+)S/);
  if (!match) return '';
  const mins = parseInt(match[1], 10);
  const secs = Math.floor(parseFloat(match[2]));
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// "2nd 5:23 · 32-41" for live, "HALF · 32-41" at halftime, "Final · 32-41" for final.
// Score is shown as player's team first, then opponent.
export function formatGameInfo(live: LivePlayerStats): string {
  const isAway = live.matchup?.startsWith('@');
  const myScore = isAway ? live.away_score : live.home_score;
  const oppScore = isAway ? live.home_score : live.away_score;
  const scoreStr = `${myScore}-${oppScore}`;

  if (live.game_status === 3) return `Final · ${scoreStr}`;
  if (live.game_status === 2) {
    const clock = formatClock(live.game_clock);
    // Halftime: end of period 2 with no clock remaining
    if (live.period === 2 && (!clock || clock === '0:00')) return `HALF · ${scoreStr}`;
    const period = formatPeriod(live.period);
    return clock ? `${period} ${clock} · ${scoreStr}` : `${period} · ${scoreStr}`;
  }
  return '';
}

// Returns a map of player_id → LivePlayerStats for today's games.
// Performs an initial fetch then polls every 30s (matching the cron cadence).
// Tracks the current date so stale data from a previous day is cleared
// when the app resumes from background after midnight.
// Adaptive polling intervals:
// - 30s when any game is live (game_status === 2) — real-time feel
// - 5 min when data exists but all games are final — just checking for stragglers
// - 5 min when no data at all — waiting for games to start / offseason
const POLL_LIVE = 30_000;
const POLL_IDLE = 5 * 60_000;

export function useLivePlayerStats(
  playerIds: string[],
  enabled: boolean
): Map<string, LivePlayerStats> {
  const [liveMap, setLiveMap] = useState<Map<string, LivePlayerStats>>(new Map());
  const dateRef = useRef<string>(toDateStr(new Date()));
  const appActiveRef = useRef<boolean>(AppState.currentState === 'active');
  const hasLiveGameRef = useRef<boolean>(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Track date changes + app active state to skip polling when backgrounded
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      appActiveRef.current = state === 'active';
      if (state === 'active') {
        const now = toDateStr(new Date());
        if (now !== dateRef.current) {
          dateRef.current = now;
          // Clear stale live data from the previous day
          setLiveMap(new Map());
        }
      }
    });
    return () => sub.remove();
  }, []);

  const reschedule = useCallback((hasLive: boolean) => {
    const desired = hasLive ? POLL_LIVE : POLL_IDLE;
    const changed = hasLiveGameRef.current !== hasLive;
    hasLiveGameRef.current = hasLive;

    // Only restart the interval when the tier actually changes
    if (changed && intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => {
        if (appActiveRef.current) fetchStats(playerIdsRef.current);
      }, desired);
    }
  }, []);

  // Keep a ref to playerIds so the interval callback always has the latest list
  const playerIdsRef = useRef<string[]>(playerIds);
  playerIdsRef.current = playerIds;

  const fetchStats = useCallback(async (ids: string[]) => {
    const today = toDateStr(new Date());
    const yesterday = addDays(today, -1);
    dateRef.current = today;

    const liveCols = 'player_id, game_id, game_date, game_status, period, game_clock, matchup, home_score, away_score, oncourt, pts, reb, ast, blk, stl, tov, fgm, fga, "3pm", "3pa", ftm, fta, pf';
    const [todayRes, yesterdayRes] = await Promise.all([
      supabase
        .from('live_player_stats')
        .select(liveCols)
        .in('player_id', ids)
        .eq('game_date', today)
        .gte('game_status', 2),
      supabase
        .from('live_player_stats')
        .select(liveCols)
        .in('player_id', ids)
        .eq('game_date', yesterday)
        .gte('game_status', 2),
    ]);

    if (toDateStr(new Date()) !== today) return;
    const rows = [
      ...((todayRes.data ?? []) as LivePlayerStats[]),
      ...((yesterdayRes.data ?? []) as LivePlayerStats[]),
    ];
    const map = buildMap(rows);
    setLiveMap(map);

    // Adapt polling speed: 30s when any game is in progress, 5min otherwise
    const anyLive = [...map.values()].some((s) => s.game_status === 2);
    reschedule(anyLive);
  }, [reschedule]);

  useEffect(() => {
    if (!enabled || playerIds.length === 0) {
      setLiveMap(new Map());
      return;
    }

    // Initial fetch
    fetchStats(playerIds);

    // Start polling — defaults to idle speed; fetchStats will speed up if games are live
    hasLiveGameRef.current = false;
    intervalRef.current = setInterval(() => {
      if (appActiveRef.current) fetchStats(playerIds);
    }, POLL_IDLE);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, playerIds.join(','), fetchStats]);

  return liveMap;
}

function buildMap(rows: LivePlayerStats[]): Map<string, LivePlayerStats> {
  const map = new Map<string, LivePlayerStats>();
  for (const row of rows) {
    // Don't let yesterday's final row overwrite today's live row
    const existing = map.get(row.player_id);
    if (existing && existing.game_date > row.game_date) continue;
    map.set(row.player_id, row);
  }
  return map;
}

// Convert LivePlayerStats to the shape calculateGameFantasyPoints expects.
export function liveToGameLog(live: LivePlayerStats): Record<string, number | boolean> {
  const cats = [live.pts, live.reb, live.ast, live.stl, live.blk].filter(v => v >= 10).length;
  return {
    pts: live.pts, reb: live.reb, ast: live.ast, stl: live.stl,
    blk: live.blk, tov: live.tov, fgm: live.fgm, fga: live.fga,
    '3pm': live['3pm'], '3pa': live['3pa'] ?? 0, ftm: live.ftm,
    fta: live.fta, pf: live.pf, min: 0,
    double_double: cats >= 2,
    triple_double: cats >= 3,
  };
}

