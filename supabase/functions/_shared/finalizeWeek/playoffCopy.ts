// Copy builders for finalize-week's playoff result notifications.
//
// The 3rd place game is created ALONGSIDE the final and carries the SAME
// `playoff_round`, so the round number alone cannot tell them apart — only
// `playoff_bracket.is_third_place` can. Labelling off the round is what sent
// both 3rd-place teams a "🏆 Championship / you won the championship!" push.
//
// Import-free on purpose so the jest suite can unit-test it directly.

export interface PlayoffMatchupContext {
  /** `league_matchups.playoff_round` of the finalized matchup. */
  round: number;
  /** Total rounds in the bracket (calcRounds(playoff_teams)). */
  totalRounds: number;
  /** `playoff_bracket.is_third_place` — NOT derivable from `round`. */
  isThirdPlace: boolean;
  /** True when the semifinal losers still have the 3rd place game ahead. */
  thirdPlaceGameFollows?: boolean;
}

export interface PlayoffResult {
  won: boolean;
  tied: boolean;
  opponentName: string;
  scoreLine: string;
}

function isChampionship(ctx: PlayoffMatchupContext): boolean {
  return !ctx.isThirdPlace && ctx.round >= ctx.totalRounds;
}

function isSemifinal(ctx: PlayoffMatchupContext): boolean {
  return !ctx.isThirdPlace && ctx.round === ctx.totalRounds - 1;
}

export function playoffRoundLabel(ctx: PlayoffMatchupContext): string {
  if (ctx.isThirdPlace) return '3rd Place Game';
  if (ctx.round >= ctx.totalRounds) return 'Championship';
  if (ctx.round === ctx.totalRounds - 1) return 'Semifinals';
  if (ctx.round === ctx.totalRounds - 2) return 'Quarterfinals';
  return `Playoff Round ${ctx.round}`;
}

export function playoffRoundIcon(ctx: PlayoffMatchupContext): string {
  if (ctx.isThirdPlace) return '🥉';
  return ctx.round >= ctx.totalRounds ? '🏆' : '🏀';
}

export function playoffResultBody(ctx: PlayoffMatchupContext, result: PlayoffResult): string {
  const { opponentName, scoreLine } = result;

  if (result.tied) return `Tied ${scoreLine} vs ${opponentName}. What a battle.`;

  if (ctx.isThirdPlace) {
    return result.won
      ? `You beat ${opponentName} ${scoreLine} and took 3rd place! 🥉`
      : `${opponentName} wins ${scoreLine}. You finish 4th.`;
  }

  if (isChampionship(ctx)) {
    return result.won
      ? `You beat ${opponentName} ${scoreLine} and won the championship! 🏆`
      : `${opponentName} wins ${scoreLine}. Tough loss in the finals.`;
  }

  if (result.won) {
    const next = isSemifinal(ctx) ? 'On to the championship!' : 'You advance!';
    return `You beat ${opponentName} ${scoreLine}. ${next}`;
  }

  if (isSemifinal(ctx) && ctx.thirdPlaceGameFollows) {
    return `${opponentName} wins ${scoreLine}. On to the 3rd place game.`;
  }
  return `${opponentName} wins ${scoreLine}. Season over.`;
}
