// Per-team score computation. These functions used to fetch their own DB
// rows; now they take pre-indexed TeamData (from dataLoader.ts) so a full
// batch of N matchups runs zero queries here — the bulk loader handled
// everything up front.

import { NFL_GAME_COLUMNS } from '../../../../utils/scoring/nflStatLine.ts';
import { isActiveSlot } from '../resolveSlot.ts';

import type { TeamData } from './dataLoader.ts';
import {
  aggregateGameStats,
  calculateGameFpts,
  resolveSlotForGame,
  type PlayerGameEntry,
  type PlayerScoreEntry,
  type ScoringWeight,
} from './scoring.ts';

function todayYmd(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function buildPlayerGames(
  game: Record<string, unknown>,
  slot: string,
  fpts: number,
  sport?: string | null,
): PlayerGameEntry {
  let stats: Record<string, unknown>;
  if (sport === 'nfl') {
    // Nulls are skipped so a kicker's frozen payload doesn't carry 20 null
    // passing fields.
    stats = {};
    for (const col of NFL_GAME_COLUMNS) {
      if (game[col] != null) stats[col] = game[col];
    }
  } else {
    // Basketball payload unchanged — the client WeekSummarySheet/stat-line
    // readers key off exactly these fields.
    stats = {
      pts: game.pts, reb: game.reb, ast: game.ast, stl: game.stl, blk: game.blk,
      tov: game.tov, fgm: game.fgm, fga: game.fga, '3pm': game['3pm'],
      ftm: game.ftm, fta: game.fta, pf: game.pf,
      double_double: game.double_double, triple_double: game.triple_double,
    };
  }
  return {
    date: game.game_date as string,
    slot,
    fpts: Math.round(fpts * 100) / 100,
    stats,
    matchup: (game.matchup as string | null) ?? null,
  };
}

export function computeTeamScore(
  data: TeamData,
  weights: ScoringWeight[],
  sport?: string | null,
): { total: number; playerScores: PlayerScoreEntry[] } {
  if (data.allPlayerIds.length === 0) return { total: 0, playerScores: [] };

  const todayStr = todayYmd();
  let teamTotal = 0;
  const playerGamesMap = new Map<string, PlayerGameEntry[]>();
  const playerWeekPoints = new Map<string, number>();

  for (const game of data.gameLogs) {
    const date = game.game_date as string | undefined;
    if (!date) continue;
    const pid = game.player_id as string;
    const slot = resolveSlotForGame(
      data.dailyByPlayer.get(pid) ?? [],
      date,
      data.defaultSlotMap.get(pid) ?? 'BE',
      {
        isOnCurrentRoster: data.currentPlayerIds.has(pid),
        dropDate: data.dropDateMap.get(pid),
        acquiredDate: data.acquiredDateMap.get(pid),
        today: todayStr,
      },
    );

    const fpts = calculateGameFpts(game as Record<string, number>, weights, sport);

    if (isActiveSlot(slot)) {
      teamTotal += fpts;
      playerWeekPoints.set(pid, (playerWeekPoints.get(pid) ?? 0) + fpts);
    }

    if (!playerGamesMap.has(pid)) playerGamesMap.set(pid, []);
    playerGamesMap.get(pid)!.push(buildPlayerGames(game, slot, fpts, sport));
  }

  const playerScores: PlayerScoreEntry[] = data.allPlayerIds.map((pid) => {
    const info = data.playerInfo.get(pid);
    return {
      player_id: pid,
      name: info?.name ?? 'Unknown',
      position: info?.position ?? '—',
      pro_team: info?.pro_team ?? '—',
      external_id_nba: info?.external_id_nba ?? null,
      roster_slot: data.defaultSlotMap.get(pid) ?? 'BE',
      week_points: Math.round((playerWeekPoints.get(pid) ?? 0) * 100) / 100,
      games: playerGamesMap.get(pid) ?? [],
    };
  });

  return { total: Math.round(teamTotal * 100) / 100, playerScores };
}

export function computeTeamCategoryStats(
  data: TeamData,
  sport?: string | null,
): { teamStats: Record<string, number>; playerScores: PlayerScoreEntry[] } {
  if (data.allPlayerIds.length === 0) return { teamStats: {}, playerScores: [] };

  const todayStr = todayYmd();
  const activeGames: Record<string, unknown>[] = [];
  const playerGamesMap = new Map<string, PlayerGameEntry[]>();

  for (const game of data.gameLogs) {
    const date = game.game_date as string | undefined;
    if (!date) continue;
    const pid = game.player_id as string;
    const slot = resolveSlotForGame(
      data.dailyByPlayer.get(pid) ?? [],
      date,
      data.defaultSlotMap.get(pid) ?? 'BE',
      {
        isOnCurrentRoster: data.currentPlayerIds.has(pid),
        dropDate: data.dropDateMap.get(pid),
        acquiredDate: data.acquiredDateMap.get(pid),
        today: todayStr,
      },
    );

    if (isActiveSlot(slot)) activeGames.push(game);

    if (!playerGamesMap.has(pid)) playerGamesMap.set(pid, []);
    playerGamesMap.get(pid)!.push(buildPlayerGames(game, slot, 0, sport));
  }

  const playerScores: PlayerScoreEntry[] = data.allPlayerIds.map((pid) => {
    const info = data.playerInfo.get(pid);
    return {
      player_id: pid,
      name: info?.name ?? 'Unknown',
      position: info?.position ?? '—',
      pro_team: info?.pro_team ?? '—',
      external_id_nba: info?.external_id_nba ?? null,
      roster_slot: data.defaultSlotMap.get(pid) ?? 'BE',
      week_points: 0,
      games: playerGamesMap.get(pid) ?? [],
    };
  });

  return { teamStats: aggregateGameStats(activeGames, sport), playerScores };
}
