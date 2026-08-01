/**
 * Offseason phase model — shared between the Home hero's pip-stepper and the
 * Matchup hero's phase ribbon so both read one source of truth.
 *
 * `computeOffseasonState` collapses the scattered `offseason_step` DB values
 * into the simplified, per-league-type step list. `getOffseasonMilestone`
 * layers the tip-off countdown on top for the Matchup hero.
 */
import { getSeasonStart, type Sport } from '@/constants/LeagueDefaults';
import { daysBetween } from '@/utils/dateMath';

/** `leagues.offseason_step` while a redraft/keeper league is asleep, waiting
 *  for its rookie class. Set by advance-season / finalize-keepers; cleared by
 *  the open-draft-season cron. */
export const DORMANT_STEP = 'offseason';

/** What we call that state everywhere the user can see it. */
export const BETWEEN_SEASONS_LABEL = 'Between Seasons';

/** Is this league asleep — history viewable, nothing else actionable? */
export function isBetweenSeasons(offseasonStep: string | null | undefined): boolean {
  return offseasonStep === DORMANT_STEP;
}

/**
 * The one dormant-state message, shared by every surface a between-seasons
 * league can reach and find nothing: the scoreboard, the schedule, the matchup
 * tab, the trade page. They each used to hand-roll their own "Offseason." copy,
 * which meant four different explanations of the same state.
 *
 * `upcomingSeason` is `leagues.season`, which advance-season has already rolled
 * forward — so it names the season the league will REOPEN for, not the one that
 * just finished.
 */
export function betweenSeasonsCopy(upcomingSeason: string): {
  title: string;
  subtitle: string;
  accessibilityLabel: string;
} {
  return {
    title: 'Between seasons.',
    subtitle: `THE LEAGUE REOPENS FOR THE ${upcomingSeason} DRAFT`,
    accessibilityLabel: `The league is between seasons. It reopens for the ${upcomingSeason} draft.`,
  };
}

export interface OffseasonState {
  stepIndex: number;
  stepCount: number;
  stepLabel: string;
  nextStepLabel: string | null;
  /** Ordered labels for every step, active step at `stepIndex`. Drives the
   *  Matchup hero's phase ribbon. */
  stepLabels: string[];
}

export function computeOffseasonState(
  leagueType: string,
  rookieDraftOrder: string,
  offseasonStep: string,
): OffseasonState {
  type Step = { label: string; dbKeys: string[] };
  const seasonOver: Step = { label: 'Season Over', dbKeys: ['season_complete'] };
  const lottery: Step = {
    label: 'Draft Lottery',
    dbKeys: ['lottery_pending', 'lottery_scheduled', 'lottery_revealing', 'lottery_complete'],
  };
  const keepers: Step = {
    label: 'Declare Keepers',
    dbKeys: ['keeper_pending', 'declare_keepers'],
  };
  const rookieDraft: Step = {
    label: 'Rookie Draft',
    dbKeys: ['rookie_draft_pending', 'rookie_draft_complete'],
  };
  // The dormant wait. A redraft/keeper league can't draft until the incoming
  // rookie class is in the player pool, which is months out for most sports —
  // so the wait is a real phase, not a gap between phases. `open-draft-season`
  // moves the league off it. See utils/draft/rookieClassGate.ts.
  //
  // Deliberately NOT called "Offseason": a dynasty offseason is a period of
  // activity (lottery, keepers, rookie draft, roster moves), and borrowing the
  // word made a redraft league look like it had that work to do when the
  // league is in fact asleep. "Between Seasons" says gap, not process.
  const dormant: Step = { label: BETWEEN_SEASONS_LABEL, dbKeys: [DORMANT_STEP] };
  const draft: Step = { label: 'Draft', dbKeys: ['ready_for_new_season', 'draft'] };
  const newSeason: Step = { label: 'New Season', dbKeys: ['new_season'] };

  let steps: Step[];
  if (leagueType === 'redraft') {
    steps = [dormant, draft, newSeason];
  } else if (leagueType === 'keeper') {
    steps = [keepers, dormant, draft, newSeason];
  } else if (rookieDraftOrder === 'lottery') {
    steps = [seasonOver, lottery, rookieDraft, newSeason];
  } else {
    steps = [seasonOver, rookieDraft, newSeason];
  }

  const activeIdx = Math.max(
    0,
    steps.findIndex((s) => s.dbKeys.includes(offseasonStep)),
  );

  return {
    stepIndex: activeIdx,
    stepCount: steps.length,
    stepLabel: steps[activeIdx]?.label ?? steps[0].label,
    nextStepLabel: steps[activeIdx + 1]?.label ?? null,
    stepLabels: steps.map((step) => step.label),
  };
}

export interface OffseasonMilestone {
  /** Ordered phase labels for the ribbon (Season Over → Draft Lottery → …). */
  phaseLabels: string[];
  /** Index of the phase the league is currently in. */
  phaseIndex: number;
  /** Whole days until next season's opening night, or null when it's unknown
   *  or already here. */
  countdownDays: number | null;
  /** Opening-night date (YYYY-MM-DD) for the next season, or null if unknown. */
  tipOffISO: string | null;
}

/**
 * The Matchup hero's offseason summary: which phase the league sits in, and how
 * long until the next season tips off. Pure + synchronous — `getSeasonStart`
 * reads the already-hydrated season-config cache.
 */
export function getOffseasonMilestone(
  sport: string,
  season: string,
  leagueType: string,
  rookieDraftOrder: string,
  offseasonStep: string,
  todayISO: string,
): OffseasonMilestone {
  const state = computeOffseasonState(leagueType, rookieDraftOrder, offseasonStep);
  const tipOffISO = getSeasonStart(sport as Sport, season) ?? null;
  const days = tipOffISO ? daysBetween(todayISO, tipOffISO) : null;
  return {
    phaseLabels: state.stepLabels,
    phaseIndex: state.stepIndex,
    countdownDays: days != null && days > 0 ? days : null,
    tipOffISO,
  };
}
