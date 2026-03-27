/** Default odds: worst team gets highest weight, linearly decreasing. */
export function generateDefaultOdds(numTeams: number): number[] {
  if (numTeams <= 0) return [];
  if (numTeams === 1) return [100];
  const weights = Array.from({ length: numTeams }, (_, i) => numTeams - i);
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map(w => Math.round((w / total) * 1000) / 10);
}

export interface LotteryTeam {
  id: string;
  name: string;
  wins: number;
  points_for: number;
}

export interface LotteryResultEntry {
  team_id: string;
  team_name: string;
  original_standing: number;
  lottery_position: number;
  was_drawn: boolean;
}

/**
 * Weighted lottery draw. Draws `drawCount` teams from the pool using
 * weighted random selection, then appends remaining teams in original order.
 */
export function runLotteryDraw(
  lotteryPool: LotteryTeam[],
  rawOdds: number[] | null,
  drawCount: number,
): LotteryResultEntry[] {
  const poolSize = lotteryPool.length;
  let odds = rawOdds ?? generateDefaultOdds(poolSize);
  if (odds.length > poolSize) odds = odds.slice(0, poolSize);
  else if (odds.length < poolSize) odds = generateDefaultOdds(poolSize);

  const oddsTotal = odds.reduce((a, b) => a + b, 0);
  const normalizedOdds = odds.map(o => o / oddsTotal);

  const draws = Math.min(drawCount, poolSize);
  const drawnTeams: LotteryTeam[] = [];
  const remainingPool = [...lotteryPool];
  let remainingOdds = [...normalizedOdds];

  for (let draw = 0; draw < draws; draw++) {
    const rand = Math.random();
    let cumulative = 0;
    let selectedIdx = remainingPool.length - 1;

    for (let i = 0; i < remainingOdds.length; i++) {
      cumulative += remainingOdds[i];
      if (rand <= cumulative) { selectedIdx = i; break; }
    }

    drawnTeams.push(remainingPool[selectedIdx]);
    remainingPool.splice(selectedIdx, 1);
    remainingOdds.splice(selectedIdx, 1);

    const remTotal = remainingOdds.reduce((a, b) => a + b, 0);
    if (remTotal > 0) remainingOdds = remainingOdds.map(o => o / remTotal);
  }

  return [
    ...drawnTeams.map((t, i) => ({
      team_id: t.id,
      team_name: t.name,
      original_standing: lotteryPool.findIndex(p => p.id === t.id) + 1,
      lottery_position: i + 1,
      was_drawn: true,
    })),
    ...remainingPool.map((t, i) => ({
      team_id: t.id,
      team_name: t.name,
      original_standing: lotteryPool.findIndex(p => p.id === t.id) + 1,
      lottery_position: drawnTeams.length + i + 1,
      was_drawn: false,
    })),
  ];
}
