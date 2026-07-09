import type { TimeRange } from "@/hooks/usePlayerFilter";
import type { PlayerGameLog, PlayerSeasonStats } from "@/types/player";
import { gameWindowSize, type GameWindow } from "@/utils/scoring/fantasyPoints";
import { dedupeGameLogsByDate } from "@/utils/scoring/gameLogDedup";
import { lastNPlayedGames } from "@/utils/scoring/windowAverages";

// Pure stat transforms for the free-agent list. Extracted from FreeAgentList so
// the time-range aggregation and "minutes up" derivation can be reasoned about
// (and tested) independently of the component's query/render plumbing.

/**
 * Players whose recent 5-game minutes average is >10% above their SEASON
 * average minutes — powers the "Minutes Up" filter. Always compares against
 * season avg_min, not the time-range-adjusted average.
 */
export function deriveMinutesUpPlayerIds(
  recentGameLogs: any[] | undefined,
  allPlayers: PlayerSeasonStats[] | undefined,
): Set<string> | undefined {
  if (!recentGameLogs || !allPlayers) return undefined;
  const playerGames = new Map<string, number[]>();
  for (const g of recentGameLogs) {
    if (g.min == null) continue;
    const mins = playerGames.get(g.player_id);
    if (!mins) {
      playerGames.set(g.player_id, [g.min]);
    } else if (mins.length < 5) {
      mins.push(g.min);
    }
  }
  const seasonAvgMin = new Map<string, number>();
  for (const p of allPlayers) {
    if (p.avg_min > 0) seasonAvgMin.set(p.player_id, p.avg_min);
  }
  const set = new Set<string>();
  for (const [pid, mins] of playerGames) {
    if (mins.length < 3) continue;
    const avg = mins.reduce((a, b) => a + b, 0) / mins.length;
    const seasonAvg = seasonAvgMin.get(pid);
    if (seasonAvg && avg > seasonAvg * 1.1) {
      set.add(pid);
    }
  }
  return set;
}

/**
 * Time-range-adjusted player stats. For "season" returns the players as-is.
 * For "lastSeason" merges historical averages onto the current roster identity.
 * For "L5"/"L10"/"L15" aggregates the player's last N PLAYED games (DNPs
 * skipped) — the same game-based window the roster pages and analytics use, so
 * a player's "L10" reads identically across the app regardless of how many
 * games their team happened to play in the calendar window.
 */
export function buildAdjustedPlayers(
  allPlayers: PlayerSeasonStats[] | undefined,
  recentGameLogs: any[] | undefined,
  historicalStats: any[] | undefined | null,
  timeRange: TimeRange,
): PlayerSeasonStats[] | undefined {
  if (!allPlayers) return undefined;
  if (timeRange === "season") return allPlayers;

  // Last-season pill: merge per-player historical averages onto the
  // current player roster identity so name/position/team stay current
  // but the stat columns reflect last year's body of work.
  if (timeRange === "lastSeason") {
    if (!historicalStats) return allPlayers;
    const histMap = new Map(historicalStats.map((h: any) => [h.player_id, h]));
    return allPlayers
      .filter((p) => histMap.has(p.player_id))
      .map((p) => {
        const h = histMap.get(p.player_id)!;
        // FPTS (calculateAvgFantasyPoints) reads the total_* columns. But
        // player_historical_stats persists only dd/td totals — not the box-score
        // totals — and the spread `...p` carries the CURRENT-season matview
        // totals (all zero in the offseason). So rebuild EVERY box total from
        // avg × games, exactly the way the detail modal's seasonAvgRowToFpts
        // does; otherwise the FA "Last Season" FPTS silently drops the
        // FG/3P/FT/PF scoring terms and disagrees with the modal for the same
        // player + season.
        const gp = Number(h.games_played ?? 0);
        const tot = (avg: number | null | undefined) => Math.round(Number(avg ?? 0) * gp);
        return {
          ...p,
          games_played: gp,
          avg_pts: h.avg_pts ?? 0,
          avg_reb: h.avg_reb ?? 0,
          avg_ast: h.avg_ast ?? 0,
          avg_stl: h.avg_stl ?? 0,
          avg_blk: h.avg_blk ?? 0,
          avg_tov: h.avg_tov ?? 0,
          avg_fgm: h.avg_fgm ?? 0,
          avg_fga: h.avg_fga ?? 0,
          avg_3pm: h.avg_3pm ?? 0,
          avg_3pa: h.avg_3pa ?? 0,
          avg_ftm: h.avg_ftm ?? 0,
          avg_fta: h.avg_fta ?? 0,
          avg_pf: h.avg_pf ?? 0,
          avg_min: h.avg_min ?? 0,
          total_pts: tot(h.avg_pts),
          total_reb: tot(h.avg_reb),
          total_ast: tot(h.avg_ast),
          total_stl: tot(h.avg_stl),
          total_blk: tot(h.avg_blk),
          total_tov: tot(h.avg_tov),
          total_fgm: tot(h.avg_fgm),
          total_fga: tot(h.avg_fga),
          total_3pm: tot(h.avg_3pm),
          total_3pa: tot(h.avg_3pa),
          total_ftm: tot(h.avg_ftm),
          total_fta: tot(h.avg_fta),
          total_pf: tot(h.avg_pf),
          total_dd: h.total_dd ?? 0,
          total_td: h.total_td ?? 0,
        } as PlayerSeasonStats;
      });
  }

  if (!recentGameLogs) return allPlayers;

  const windowSize = gameWindowSize(timeRange as GameWindow);
  if (windowSize == null) return allPlayers; // only L5/L10/L15 reach here

  // Group game logs by player (the query returns them DESC by game_date, the
  // order lastNPlayedGames expects). Dedupe same-date ghost rows the same way
  // the roster hooks do, then slice each player's last N PLAYED games.
  const grouped = new Map<string, any[]>();
  for (const g of recentGameLogs) {
    const arr = grouped.get(g.player_id);
    if (arr) arr.push(g);
    else grouped.set(g.player_id, [g]);
  }

  const round = (v: number) => Math.round(v * 10) / 10;

  return allPlayers
    .map((p) => {
      const all = grouped.get(p.player_id);
      if (!all) return null;
      const games = lastNPlayedGames(
        dedupeGameLogsByDate(all as PlayerGameLog[]),
        windowSize,
      );
      if (games.length === 0) return null;
      const gp = games.length;
      const t = {
        pts: 0,
        reb: 0,
        ast: 0,
        stl: 0,
        blk: 0,
        tov: 0,
        fgm: 0,
        fga: 0,
        threepm: 0,
        threepa: 0,
        ftm: 0,
        fta: 0,
        pf: 0,
        min: 0,
        dd: 0,
        td: 0,
      };
      for (const g of games) {
        t.pts += g.pts ?? 0;
        t.reb += g.reb ?? 0;
        t.ast += g.ast ?? 0;
        t.stl += g.stl ?? 0;
        t.blk += g.blk ?? 0;
        t.tov += g.tov ?? 0;
        t.fgm += g.fgm ?? 0;
        t.fga += g.fga ?? 0;
        t.threepm += g["3pm"] ?? 0;
        t.threepa += g["3pa"] ?? 0;
        t.ftm += g.ftm ?? 0;
        t.fta += g.fta ?? 0;
        t.pf += g.pf ?? 0;
        t.min += g.min ?? 0;
        t.dd += g.double_double ? 1 : 0;
        t.td += g.triple_double ? 1 : 0;
      }
      return {
        ...p,
        games_played: gp,
        total_pts: t.pts,
        avg_pts: round(t.pts / gp),
        total_reb: t.reb,
        avg_reb: round(t.reb / gp),
        total_ast: t.ast,
        avg_ast: round(t.ast / gp),
        total_stl: t.stl,
        avg_stl: round(t.stl / gp),
        total_blk: t.blk,
        avg_blk: round(t.blk / gp),
        total_tov: t.tov,
        avg_tov: round(t.tov / gp),
        total_fgm: t.fgm,
        avg_fgm: round(t.fgm / gp),
        total_fga: t.fga,
        avg_fga: round(t.fga / gp),
        total_3pm: t.threepm,
        avg_3pm: round(t.threepm / gp),
        total_3pa: t.threepa,
        avg_3pa: round(t.threepa / gp),
        total_ftm: t.ftm,
        avg_ftm: round(t.ftm / gp),
        total_fta: t.fta,
        avg_fta: round(t.fta / gp),
        total_pf: t.pf,
        avg_pf: round(t.pf / gp),
        total_dd: t.dd,
        total_td: t.td,
        avg_min: round(t.min / gp),
      } as PlayerSeasonStats;
    })
    .filter((p): p is PlayerSeasonStats => p !== null);
}
