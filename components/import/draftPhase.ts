/**
 * Shared types + pure helpers for the import wizards' draft-phase selector
 * and traded-future-pick editor. Used by both the Sleeper wizard
 * (`app/import-league.tsx`) and the Screenshot wizard
 * (`components/import/ScreenshotImport.tsx`).
 *
 * Identity note: a team is referenced by a `key` that differs per import
 * source — the Sleeper roster_id (as a string) or, for screenshots, the
 * team name. The edge function resolves the key back to a real team UUID
 * after the teams are created. The client never sees team UUIDs (teams
 * don't exist until the import runs).
 */
import { formatSeason, parseSeasonStartYear, type Sport } from '@/constants/LeagueDefaults';

export type DraftPhase = 'in_season' | 'pre_lottery' | 'lottery_done';

export interface ImportTeamRef {
  key: string;
  name: string;
}

export interface TradedPickDraft {
  season: string;
  round: number;
  /** Original owner (the pick originates from this team). */
  fromKey: string;
  /** New owner after the trade. */
  toKey: string;
}

/** Left-to-right (chronological) order for the segmented selector. */
export const DRAFT_PHASE_OPTIONS: { value: DraftPhase; label: string }[] = [
  { value: 'pre_lottery', label: 'Pre-Draft' },
  { value: 'lottery_done', label: 'Order Set' },
  { value: 'in_season', label: 'Drafted' },
];

export function draftPhaseHelp(phase: DraftPhase, usesLottery: boolean): string {
  switch (phase) {
    case 'pre_lottery':
      return usesLottery
        ? "This season's rookie draft hasn't happened yet. The lottery and rookie draft will run inside the app — import last season's standings on the History step so the lottery odds are accurate."
        : "This season's rookie draft hasn't happened yet. Draft order is set by reverse standings from your imported History.";
    case 'lottery_done':
      return 'The draft order is already decided. Set it below and the rookie draft will run in the app.';
    case 'in_season':
      return 'The rookie draft is already done and the rookies are on your rosters. Nothing more to set up.';
  }
}

/**
 * The seasons a traded pick can target. `S0` (the upcoming/draftable season,
 * == league.season) is only included when the rookie draft hasn't happened
 * yet — for an already-drafted league only future picks (`S1..SN`) exist.
 */
export function computeImportSeasons(
  season: string,
  sport: Sport,
  maxFutureSeasons: number,
  includeCurrent: boolean,
): string[] {
  const startYear = parseSeasonStartYear(season);
  const out = includeCurrent ? [season] : [];
  for (let offset = 1; offset <= maxFutureSeasons; offset++) {
    out.push(formatSeason(startYear + offset, sport));
  }
  return out;
}

/** A phase-(b) order must list every team exactly once. */
export function validateLotteryOrder(order: string[], teamCount: number): boolean {
  return order.length === teamCount && new Set(order).size === teamCount;
}

/** Whether the editor's in-progress pick is fully specified and self-consistent. */
export function isCompleteTradedPick(p: Partial<TradedPickDraft>): p is TradedPickDraft {
  return (
    !!p.season &&
    typeof p.round === 'number' &&
    !!p.fromKey &&
    !!p.toKey &&
    p.fromKey !== p.toKey
  );
}

/** True if a pick with this (season, round, fromKey) already exists. */
export function isDuplicateTradedPick(list: TradedPickDraft[], p: TradedPickDraft): boolean {
  return list.some(x => x.season === p.season && x.round === p.round && x.fromKey === p.fromKey);
}
