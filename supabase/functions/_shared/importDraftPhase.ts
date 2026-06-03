/**
 * Pure helpers shared by the two league-import edge functions
 * (`import-sleeper-league`, `import-screenshot-league`) for seeding draft
 * picks across the imported league's future seasons and the upcoming
 * (offset-0) rookie-draft season.
 *
 * Kept free of any Supabase/Deno imports so the logic is trivially
 * testable and runtime-agnostic. The edge functions own all DB writes;
 * these helpers only shape rows + season strings.
 *
 * Season-string formatting mirrors `constants/LeagueDefaults.ts`
 * (`formatSeason`) and `advance-season`'s `nextSeason` — NBA seasons span
 * two calendar years ("2027-28"), WNBA is single-year ("2027"). The
 * import functions previously hand-rolled the NBA-only form inline, which
 * silently produced wrong season strings for WNBA leagues (every consumer
 * filters by the canonical format and dropped them).
 */

export type ImportSport = 'nba' | 'wnba';

export function formatSeason(startYear: number, sport: ImportSport): string {
  if (sport === 'wnba') return String(startYear);
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export function parseSeasonStartYear(season: string): number {
  return parseInt(season.split('-')[0], 10);
}

export function nextSeason(season: string, sport: ImportSport): string {
  return formatSeason(parseSeasonStartYear(season) + 1, sport);
}

/** The offset 1..count future seasons after `currentSeason`. */
export function buildFutureSeasons(currentSeason: string, count: number, sport: ImportSport): string[] {
  const startYear = parseSeasonStartYear(currentSeason);
  const out: string[] = [];
  for (let offset = 1; offset <= count; offset++) {
    out.push(formatSeason(startYear + offset, sport));
  }
  return out;
}

/** A draft-pick row ready to insert (omits id/draft_id/player_id — defaults handle those). */
export interface DraftPickSeed {
  league_id: string;
  season: string;
  round: number;
  slot_number: number;
  pick_number: number | null;
  current_team_id: string;
  original_team_id: string;
}

/**
 * Build the per-team rookie picks for a single season. One pick per team per
 * round; `current_team_id` starts equal to `original_team_id` (traded-pick
 * overrides are applied separately via `applyTradedPicks`).
 *
 * `order` (a draft order of team UUIDs, index 0 = first overall pick) sets the
 * final `slot_number`/`pick_number` — used for phase (b) "lottery done" and
 * reverse-standings pre-draft seeding. Without it, picks are unordered
 * (`slot_number` = team index, `pick_number` null) — the convention for
 * tradable future picks, which `start-lottery` later re-numbers by standing.
 */
export function buildSeasonPicks(opts: {
  leagueId: string;
  teamIds: string[];
  rounds: number;
  season: string;
  order?: string[];
}): DraftPickSeed[] {
  const { leagueId, teamIds, rounds, season, order } = opts;
  const teamCount = teamIds.length;
  const orderPos = new Map<string, number>();
  if (order) order.forEach((id, i) => orderPos.set(id, i));

  const rows: DraftPickSeed[] = [];
  for (let round = 1; round <= rounds; round++) {
    teamIds.forEach((teamId, idx) => {
      const pos = order ? (orderPos.get(teamId) ?? idx) : idx;
      rows.push({
        league_id: leagueId,
        season,
        round,
        slot_number: pos + 1,
        pick_number: order ? (round - 1) * teamCount + (pos + 1) : null,
        current_team_id: teamId,
        original_team_id: teamId,
      });
    });
  }
  return rows;
}

/** A traded future pick already resolved to team UUIDs by the caller. */
export interface ResolvedTradedPick {
  season: string;
  round: number;
  originalTeamId: string;
  newOwnerTeamId: string;
}

/**
 * Rewrite `current_team_id` on every pick that matches a traded entry by
 * (season, round, originalTeamId). Mutates + returns `rows` (they're freshly
 * built, so in-place is fine). Unmatched trades are no-ops.
 */
export function applyTradedPicks(rows: DraftPickSeed[], traded: ResolvedTradedPick[]): DraftPickSeed[] {
  if (!traded.length) return rows;
  for (const tp of traded) {
    for (const row of rows) {
      if (row.season === tp.season && row.round === tp.round && row.original_team_id === tp.originalTeamId) {
        row.current_team_id = tp.newOwnerTeamId;
      }
    }
  }
  return rows;
}

export type DraftPhase = 'in_season' | 'pre_lottery' | 'lottery_done';

export interface OffseasonUpdate {
  offseason_step: string;
  lottery_status: string;
}

export interface DraftPhaseSeedPlan {
  pickRows: DraftPickSeed[];
  offseasonUpdate: OffseasonUpdate | null;
}

/**
 * Plan the draft-pick rows + offseason flip for an imported dynasty league —
 * the single source of truth for the phase→DB-state decision, shared by both
 * import functions.
 *
 * Always seeds the future tradable picks (S1..SN). When the upcoming rookie
 * draft hasn't happened yet (`draftPhase !== 'in_season'`), it also seeds the
 * offset-0 season's rookie picks and returns the offseason state to flip into:
 *   - pre_lottery + lottery        → 'lottery_pending'      (in-app lottery runs)
 *   - pre_lottery + reverse_record → 'rookie_draft_pending' (order pre-applied)
 *   - lottery_done                 → 'rookie_draft_pending' (order pre-applied)
 *
 * `order` (resolved team UUIDs, index 0 = first pick) sets the S0 slot/pick
 * numbers for the ordered cases; pass `undefined` for the lottery case
 * (start-lottery numbers those later from standings). Traded-pick overrides are
 * applied across every seeded season.
 *
 * Identity resolution (roster_id vs team name), order validation, and the
 * reverse-standings derivation stay with the caller — they differ per source.
 */
export function planDraftPhaseSeeding(opts: {
  leagueId: string;
  teamIds: string[];
  rounds: number;
  currentSeason: string;
  sport: ImportSport;
  maxFutureSeasons: number;
  draftPhase: DraftPhase;
  usesLottery: boolean;
  order?: string[];
  resolvedTraded: ResolvedTradedPick[];
}): DraftPhaseSeedPlan {
  const {
    leagueId, teamIds, rounds, currentSeason, sport,
    maxFutureSeasons, draftPhase, usesLottery, order, resolvedTraded,
  } = opts;

  const pickRows: DraftPickSeed[] = [];
  for (const season of buildFutureSeasons(currentSeason, maxFutureSeasons, sport)) {
    pickRows.push(...buildSeasonPicks({ leagueId, teamIds, rounds, season }));
  }

  let offseasonUpdate: OffseasonUpdate | null = null;
  if (draftPhase !== 'in_season') {
    pickRows.push(...buildSeasonPicks({ leagueId, teamIds, rounds, season: currentSeason, order }));
    offseasonUpdate = draftPhase === 'pre_lottery' && usesLottery
      ? { offseason_step: 'lottery_pending', lottery_status: 'pending' }
      : { offseason_step: 'rookie_draft_pending', lottery_status: draftPhase === 'lottery_done' ? 'complete' : 'pending' };
  }

  applyTradedPicks(pickRows, resolvedTraded);
  return { pickRows, offseasonUpdate };
}
