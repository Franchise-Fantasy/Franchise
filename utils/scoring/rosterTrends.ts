import { PlayerGameLog, ScoringWeight } from '@/types/player';
import { calculatePlayerInsights, TrendDirection } from '@/utils/scoring/playerInsights';

/**
 * Splits a roster into "heating up" and "cooling off" buckets by comparing each
 * player's recent-games form to their season average — the actionable core of
 * the non-dynasty analytics view (sell-high on hot, hold/don't-sell-low on cold).
 * Pure: reuses calculatePlayerInsights so a board row's trend matches the
 * player-detail modal exactly. Neutral players are counted but not bucketed.
 */

export interface RosterTrendEntry {
  playerId: string;
  name: string;
  trend: TrendDirection;
  trendPct: number; // % change of recent window vs season avg
  recentAvg: number;
  seasonAvg: number;
}

export interface RosterTrendBoard {
  heatingUp: RosterTrendEntry[]; // hot / scorching, sorted by |trendPct| desc
  coolingOff: RosterTrendEntry[]; // cold / frigid, sorted by |trendPct| desc
  evaluated: number; // players with enough games to assess (incl. neutral)
}

export function buildRosterTrendBoard(
  players: { player_id: string; name: string }[],
  gameLogsByPlayer: Map<string, PlayerGameLog[]>,
  weights: ScoringWeight[],
  seasonAvgFor: (playerId: string) => number,
  recentWindow = 10,
): RosterTrendBoard {
  const heatingUp: RosterTrendEntry[] = [];
  const coolingOff: RosterTrendEntry[] = [];
  let evaluated = 0;

  for (const p of players) {
    const games = gameLogsByPlayer.get(p.player_id);
    if (!games?.length) continue;
    const insights = calculatePlayerInsights(
      games,
      weights,
      seasonAvgFor(p.player_id),
      recentWindow,
    );
    if (!insights) continue; // < 5 played games — can't assess yet

    evaluated++;
    const entry: RosterTrendEntry = {
      playerId: p.player_id,
      name: p.name,
      trend: insights.trend,
      trendPct: insights.trendPct,
      recentAvg: insights.recentAvg,
      seasonAvg: seasonAvgFor(p.player_id),
    };

    if (insights.trend === 'hot' || insights.trend === 'scorching') {
      heatingUp.push(entry);
    } else if (insights.trend === 'cold' || insights.trend === 'frigid') {
      coolingOff.push(entry);
    }
    // neutral: counted in `evaluated`, shown in neither bucket
  }

  // Biggest movers first; name tiebreak keeps the order deterministic.
  const byMagnitude = (a: RosterTrendEntry, b: RosterTrendEntry) =>
    Math.abs(b.trendPct) - Math.abs(a.trendPct) || a.name.localeCompare(b.name);
  heatingUp.sort(byMagnitude);
  coolingOff.sort(byMagnitude);

  return { heatingUp, coolingOff, evaluated };
}
