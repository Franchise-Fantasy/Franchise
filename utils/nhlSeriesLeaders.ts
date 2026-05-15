import type { NhlArchiveGame } from '@/types/archiveNhlPlayoff';

// A player's accumulated series profile, built from each game's top-5-by-
// ice-time box. Includes both heroes and stinkers — anyone who logged real
// rotation time during the series shows up here, regardless of how their
// individual nights went.
export interface NhlPlayerSeriesLine {
  player_id: string;
  player_name: string;
  position: string | null;
  franchise_id: string;
  games_played: number;
  total_toi_seconds: number;
  total_goals: number;
  total_assists: number;
  total_points: number;
  total_plus_minus: number;
  total_sog: number;
  total_pim: number;
  // Goalie-only sums (skaters keep these at 0 — UI gates on position to
  // decide which columns to render per row).
  total_saves: number;
  total_shots_against: number;
  total_goals_against: number;
}

export interface NhlTopPlayersPerTeam {
  teamA: NhlPlayerSeriesLine[];
  teamB: NhlPlayerSeriesLine[];
}

function accumulateSide(
  tally: Map<string, NhlPlayerSeriesLine>,
  game: NhlArchiveGame,
  side: 'a' | 'b',
  franchiseId: string,
): void {
  const lines = side === 'a' ? game.box?.a : game.box?.b;
  if (!lines) return;
  for (const line of lines) {
    if (!line.player_name) continue;
    const tallyKey = line.player_id ?? line.player_name;
    const existing = tally.get(tallyKey) ?? {
      player_id: line.player_id ?? '',
      player_name: line.player_name,
      position: line.position,
      franchise_id: franchiseId,
      games_played: 0,
      total_toi_seconds: 0,
      total_goals: 0,
      total_assists: 0,
      total_points: 0,
      total_plus_minus: 0,
      total_sog: 0,
      total_pim: 0,
      total_saves: 0,
      total_shots_against: 0,
      total_goals_against: 0,
    };
    existing.games_played += 1;
    if (line.toi_seconds != null) existing.total_toi_seconds += line.toi_seconds;
    if (line.goals != null) existing.total_goals += line.goals;
    if (line.assists != null) existing.total_assists += line.assists;
    if (line.points != null) existing.total_points += line.points;
    if (line.plus_minus != null) existing.total_plus_minus += line.plus_minus;
    if (line.sog != null) existing.total_sog += line.sog;
    if (line.pim != null) existing.total_pim += line.pim;
    if (line.saves != null) existing.total_saves += line.saves;
    if (line.shots_against != null) existing.total_shots_against += line.shots_against;
    if (line.goals_against != null) existing.total_goals_against += line.goals_against;
    tally.set(tallyKey, existing);
  }
}

// Top N players per team for the series, ranked by total ice time (with
// games_played as tiebreak). Surfacing by TOI captures the rotation regulars
// including their off nights — sorting by points or save% would quietly hide
// the worst performances.
export function nhlTopPlayersPerTeam(
  games: NhlArchiveGame[],
  franchiseAId: string | null,
  franchiseBId: string | null,
  n: number = 7,
): NhlTopPlayersPerTeam {
  if (!franchiseAId || !franchiseBId) {
    return { teamA: [], teamB: [] };
  }
  const tallyA = new Map<string, NhlPlayerSeriesLine>();
  const tallyB = new Map<string, NhlPlayerSeriesLine>();
  for (const g of games) {
    accumulateSide(tallyA, g, 'a', franchiseAId);
    accumulateSide(tallyB, g, 'b', franchiseBId);
  }
  const sorter = (a: NhlPlayerSeriesLine, b: NhlPlayerSeriesLine) => {
    if (b.total_toi_seconds !== a.total_toi_seconds) {
      return b.total_toi_seconds - a.total_toi_seconds;
    }
    return b.games_played - a.games_played;
  };
  return {
    teamA: [...tallyA.values()].sort(sorter).slice(0, n),
    teamB: [...tallyB.values()].sort(sorter).slice(0, n),
  };
}
