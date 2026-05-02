import type { ArchiveGame } from '@/types/archivePlayoff';

// A player's accumulated series profile, built from each game's top-5-by-
// minutes box. Includes both heroes and stinkers — anyone who logged real
// rotation time during the series shows up here, regardless of how their
// individual nights went.
export interface PlayerSeriesLine {
  player_id: string;
  player_name: string;
  franchise_id: string;
  games_played: number;
  total_minutes_seconds: number;
  total_pts: number;
  total_reb: number;
  total_ast: number;
  total_stl: number;
  total_blk: number;
  total_plus_minus: number;
}

export interface TopPlayersPerTeam {
  teamA: PlayerSeriesLine[];
  teamB: PlayerSeriesLine[];
}

function accumulateSide(
  tally: Map<string, PlayerSeriesLine>,
  game: ArchiveGame,
  side: 'a' | 'b',
  franchiseId: string,
): void {
  const lines = side === 'a' ? game.box?.a : game.box?.b;
  if (!lines) return;
  for (const line of lines) {
    if (!line.player_name) continue;
    // Pre-1984 games have null player_id (B-Ref scraper doesn't write them
    // unless a stable id is found). Fall back to player_name as the tally
    // key so series totals still accumulate across games.
    const tallyKey = line.player_id ?? line.player_name;
    const existing = tally.get(tallyKey) ?? {
      player_id: line.player_id ?? '',
      player_name: line.player_name,
      franchise_id: franchiseId,
      games_played: 0,
      total_minutes_seconds: 0,
      total_pts: 0,
      total_reb: 0,
      total_ast: 0,
      total_stl: 0,
      total_blk: 0,
      total_plus_minus: 0,
    };
    existing.games_played += 1;
    if (line.minutes_seconds != null) existing.total_minutes_seconds += line.minutes_seconds;
    if (line.pts != null) existing.total_pts += line.pts;
    if (line.reb != null) existing.total_reb += line.reb;
    if (line.ast != null) existing.total_ast += line.ast;
    if (line.stl != null) existing.total_stl += line.stl;
    if (line.blk != null) existing.total_blk += line.blk;
    if (line.plus_minus != null) existing.total_plus_minus += line.plus_minus;
    tally.set(tallyKey, existing);
  }
}

// Top N players per team for the series, ranked by total minutes played
// (with games_played as tiebreak). Surfacing by minutes captures the
// rotation regulars including stinker nights — sorting by +/- would
// quietly hide the worst performances.
export function topPlayersPerTeam(
  games: ArchiveGame[],
  franchiseAId: string | null,
  franchiseBId: string | null,
  n: number = 5,
): TopPlayersPerTeam {
  if (!franchiseAId || !franchiseBId) {
    return { teamA: [], teamB: [] };
  }
  const tallyA = new Map<string, PlayerSeriesLine>();
  const tallyB = new Map<string, PlayerSeriesLine>();
  for (const g of games) {
    accumulateSide(tallyA, g, 'a', franchiseAId);
    accumulateSide(tallyB, g, 'b', franchiseBId);
  }
  const sorter = (a: PlayerSeriesLine, b: PlayerSeriesLine) => {
    if (b.total_minutes_seconds !== a.total_minutes_seconds) {
      return b.total_minutes_seconds - a.total_minutes_seconds;
    }
    return b.games_played - a.games_played;
  };
  return {
    teamA: [...tallyA.values()].sort(sorter).slice(0, n),
    teamB: [...tallyB.values()].sort(sorter).slice(0, n),
  };
}
