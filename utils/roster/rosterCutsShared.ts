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
 *   - Exactly `overBy` players are resolved — never more.
 *   - Newest acquisition first. Offseason adds are gated, so a team's newest
 *     rows ARE its just-drafted rookies: the last pick goes first.
 *   - Each candidate is stashed to an open taxi seat when eligible, and only
 *     dropped when taxi can't hold them. Leagues with no taxi seats degrade to
 *     an all-drops plan.
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

  const candidates = [...active].sort(cutsSortKey);
  const toTaxi: CutsCandidate[] = [];
  const stashed = new Set<string>();

  for (const player of candidates) {
    if (toTaxi.length >= overBy || openSeats === 0) break;
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

  const toDrop: CutsCandidate[] = [];
  for (const player of candidates) {
    if (toTaxi.length + toDrop.length >= overBy) break;
    if (stashed.has(player.player_id)) continue;
    toDrop.push(player);
  }

  return { activeCount, rosterSize: config.rosterSize, overBy, toTaxi, toDrop };
}
