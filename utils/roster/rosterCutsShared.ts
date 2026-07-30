/**
 * Pure roster-cuts planning shared between client and edge runtimes.
 *
 * No `react-native`, no `@/lib/supabase`, no Deno-specific imports — this file
 * must stay safe to import from both Metro (client) and Deno (edge functions).
 *
 * Consumed by:
 *   - hooks/useCutsPlan.ts (client; previews the plan in OverCapBanner)
 *   - supabase/functions/_shared/rosterCuts.ts (edge; feeds enforce-roster-cuts)
 *
 * Rookie drafts deliberately don't enforce roster size, so a dynasty team can
 * finish the offseason over its active cap. Teams are allowed to sit over cap
 * through the offseason (the over-cap lock in overCapShared.ts is the penalty),
 * but `leagues.roster_cuts_deadline` eventually forces the roster legal so one
 * absent GM can't block the commissioner from starting the season.
 *
 * This module decides WHO gets resolved and in WHAT ORDER. The client shows
 * that plan to the GM ahead of time and the edge function applies exactly the
 * same plan — one function, so the warning can never disagree with the action.
 *
 * Rules:
 *   - Only the active pool counts (roster_slot NOT IN ('IR','TAXI')), matching
 *     the repo-wide invariant that `leagues.roster_size` caps that pool alone.
 *   - Exactly the `overBy` NEWEST acquisitions are resolved — never more, and
 *     never anyone else. Offseason adds are gated, so a team's newest rows ARE
 *     its just-drafted rookies: the last pick is first on the block.
 *   - Taxi seats are then handed out inside that set BEST ASSET FIRST — earliest
 *     rookie pick, then oldest acquisition. A seat is a rescue, so it saves the
 *     1st-rounder and lets the later pick be the one dropped. (The reverse —
 *     giving the seat to whoever was first in line to be cut — meant a team with
 *     one seat kept its 2nd-rounder and lost its 1st.)
 *   - Anyone in the set who can't take a seat (none open, or taxi-ineligible) is
 *     dropped, newest first. Leagues with no taxi seats degrade to all drops.
 *     A seat left open because everyone on the block is ineligible STAYS open —
 *     we don't reach past the cut set for an eligible body, because that would
 *     silently demote a player the GM was never warned about. Taxi-ineligible is
 *     not an edge case: `draft_year` is NULL for ~20% of NFL and ~52% of WNBA
 *     players, and BDL's "1st Season" bucket (real NFL UDFAs) maps to NULL on
 *     purpose — see utils/sports/nflExperience.ts.
 *
 * Untouched by design: IR players (outside the cap), players already on taxi,
 * and any team at or under the cap. A healthy player parked on IR is the
 * separate illegal-IR lock (illegalIRShared.ts), not this module's concern.
 */

// Explicit `.ts` extensions: Deno requires them, and this file is imported by
// both runtimes (precedent: utils/liveActivity/contentState.ts, which Metro
// bundles into the matchup screen).
import { ROSTER_SLOT } from './rosterSlotsShared.ts';
import { canSendToTaxi } from './taxiEligibility.ts';

export interface CutsCandidate {
  player_id: string;
  /** Display name, passed through to banner copy and push bodies. */
  name: string;
  roster_slot: string | null;
  /** ISO timestamptz from league_players.acquired_at. */
  acquired_at: string;
  promoted_from_taxi: boolean;
  /**
   * players.draft_year. NULL blocks taxi eligibility on any league with an
   * experience limit (NFL UDFAs have no BDL draft year), but a "No Max" league
   * accepts them — see isTaxiEligible.
   */
  draft_year: number | null;
  /** draft_picks.pick_number when acquired_via='rookie_draft', else null. */
  rookie_pick_number: number | null;
}

export interface CutsPlanConfig {
  rosterSize: number;
  /** Total taxi seats — the league_roster_config TAXI row, not leagues.taxi_slots. */
  taxiSeats: number;
  taxiMaxExperience: number | null;
  /** leagues.season, for taxi experience math. */
  currentSeason: string;
}

export interface CutsPlan {
  activeCount: number;
  /** The cap this plan was measured against, for display (e.g. "15/13"). */
  rosterSize: number;
  overBy: number;
  /** Players to move to taxi, in apply order. */
  toTaxi: CutsCandidate[];
  /** Players to drop, in apply order — first element is dropped first. */
  toDrop: CutsCandidate[];
}

/** Whole days from `fromIso` to `toIso` (both "YYYY-MM-DD"). */
export function daysBetweenIsoDates(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T12:00:00Z`);
  const to = Date.parse(`${toIso}T12:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

/**
 * Is this row part of the pool `leagues.roster_size` caps?
 *
 * IR and TAXI are extra capacity on purpose. Exported so every consumer counts
 * the active roster the same way — the repo already had four hand-rolled copies
 * of this comparison before it lived here.
 */
export function isActiveSlot(slot: string | null): boolean {
  return slot !== ROSTER_SLOT.IR && slot !== ROSTER_SLOT.TAXI;
}

/**
 * Newest-first comparator, fully deterministic.
 *
 * `acquired_at` alone is not enough: `apply_offline_draft` inserts every pick
 * of a commissioner-entered draft inside ONE transaction, so `now()` is
 * identical across the whole class. Falling back to pick number keeps the
 * intuitive semantics there too (a round-3 pick is cut before a round-1 pick).
 * Live and autodraft picks each get their own `now()`, so they're already
 * distinct. `player_id` is the final tiebreak so the plan the GM was warned
 * about is byte-for-byte the plan that gets applied.
 */
export function cutsSortKey(a: CutsCandidate, b: CutsCandidate): number {
  const aTime = Date.parse(a.acquired_at);
  const bTime = Date.parse(b.acquired_at);
  if (aTime !== bTime && !Number.isNaN(aTime) && !Number.isNaN(bTime)) {
    return bTime - aTime;
  }

  // Rows without a pick number (imports, trades, FA adds) sort last, so a
  // rookie sharing a timestamp with them is still cut first.
  const aPick = a.rookie_pick_number;
  const bPick = b.rookie_pick_number;
  if (aPick !== bPick) {
    if (aPick === null) return 1;
    if (bPick === null) return -1;
    return bPick - aPick;
  }

  return a.player_id < b.player_id ? 1 : a.player_id > b.player_id ? -1 : 0;
}

/**
 * Build the cuts plan for one team.
 *
 * `roster` must be the team's FULL roster (including IR and taxi rows) so taxi
 * occupancy can be measured. Callers filter `acquired_at <= now()` at the DB
 * layer, mirroring fetchOverCapState — a deferred add isn't on the roster yet.
 */
export function computeCutsPlan(
  roster: CutsCandidate[],
  config: CutsPlanConfig,
): CutsPlan {
  const active = roster.filter((p) => isActiveSlot(p.roster_slot));
  const activeCount = active.length;
  const overBy = Math.max(0, activeCount - config.rosterSize);
  if (overBy === 0) {
    return {
      activeCount,
      rosterSize: config.rosterSize,
      overBy: 0,
      toTaxi: [],
      toDrop: [],
    };
  }

  const taxiUsed = roster.filter((p) => p.roster_slot === ROSTER_SLOT.TAXI).length;
  let openSeats = Math.max(0, config.taxiSeats - taxiUsed);

  // Who leaves the active roster: the `overBy` newest, and nobody else. Slicing
  // here rather than looping with a running counter is what keeps a previously
  // safe player from being pulled in when someone on the block can't take a seat.
  const candidates = [...active].sort(cutsSortKey);
  const affected = candidates.slice(0, overBy);

  // Who gets rescued: best asset first. `affected` is newest-first, so reversing
  // it walks earliest rookie pick / oldest acquisition first — the 1st-rounder
  // takes the seat and the later pick is the one dropped.
  const toTaxi: CutsCandidate[] = [];
  const stashed = new Set<string>();
  for (const player of [...affected].reverse()) {
    if (openSeats === 0) break;
    const eligible = canSendToTaxi(
      player.draft_year,
      config.currentSeason,
      config.taxiMaxExperience,
      player.promoted_from_taxi,
    );
    if (!eligible) continue;
    toTaxi.push(player);
    stashed.add(player.player_id);
    openSeats -= 1;
  }

  // Everyone on the block who didn't get a seat, still newest-first.
  const toDrop = affected.filter((p) => !stashed.has(p.player_id));

  return { activeCount, rosterSize: config.rosterSize, overBy, toTaxi, toDrop };
}
