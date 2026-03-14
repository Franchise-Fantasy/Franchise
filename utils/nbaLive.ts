import { supabase } from '@/lib/supabase';
import { addDays, toDateStr } from '@/utils/dates';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

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
// Performs an initial fetch then subscribes to Realtime for push updates.
// Cleans up the channel when disabled or unmounted.
// Tracks the current date so stale data from a previous day is cleared
// when the app resumes from background after midnight.
export function useLivePlayerStats(
  playerIds: string[],
  enabled: boolean
): Map<string, LivePlayerStats> {
  const [liveMap, setLiveMap] = useState<Map<string, LivePlayerStats>>(new Map());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const dateRef = useRef<string>(toDateStr(new Date()));

  // Track date changes from AppState (background → foreground after midnight)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
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

  useEffect(() => {
    if (!enabled || playerIds.length === 0) {
      setLiveMap(new Map());
      return;
    }

    const today = toDateStr(new Date());
    const yesterday = addDays(today, -1);
    dateRef.current = today;

    // Fetch today's games (live + final) and yesterday's still-live games
    // (West Coast games that cross midnight). Exclude yesterday's finals
    // so they don't show as stale entries the next morning.
    Promise.all([
      supabase
        .from('live_player_stats')
        .select('*')
        .in('player_id', playerIds)
        .eq('game_date', today)
        .gte('game_status', 2),
      supabase
        .from('live_player_stats')
        .select('*')
        .in('player_id', playerIds)
        .eq('game_date', yesterday)
        .eq('game_status', 2),
    ]).then(([todayRes, yesterdayRes]) => {
      if (toDateStr(new Date()) !== today) return;
      const rows = [
        ...((todayRes.data ?? []) as LivePlayerStats[]),
        ...((yesterdayRes.data ?? []) as LivePlayerStats[]),
      ];
      setLiveMap(buildMap(rows));
    });

    // Realtime subscription for push updates
    const channel = supabase
      .channel(`live-stats-${playerIds.slice(0, 4).join('-')}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'live_player_stats' },
        (payload) => {
          const row = payload.new as LivePlayerStats;
          if (!playerIds.includes(row.player_id)) return;
          const cur = dateRef.current;
          const isToday = row.game_date === cur;
          const isYesterday = row.game_date === addDays(cur, -1);
          // Ignore games outside today/yesterday window
          if (!isToday && !isYesterday) return;
          // For yesterday's games, only accept while still live
          if (isYesterday && row.game_status === 3) return;
          setLiveMap((prev) => {
            const next = new Map(prev);
            next.set(row.player_id, row);
            return next;
          });
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, playerIds.join(',')]);

  return liveMap;
}

function buildMap(rows: LivePlayerStats[]): Map<string, LivePlayerStats> {
  const map = new Map<string, LivePlayerStats>();
  for (const row of rows) map.set(row.player_id, row);
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

