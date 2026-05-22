import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { notifyLeague } from '../_shared/push.ts';
import { corsResponse } from '../_shared/cors.ts';
import { HttpError, handleError, jsonResponse } from '../_shared/http.ts';
import { runLotteryDraw } from '../_shared/lottery.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { parseBody, z } from '../_shared/validate.ts';

const Body = z.object({
  league_id: z.string().uuid(),
});

/**
 * Durable log of what the lottery did to protected picks and pick swaps,
 * stored on lottery_results.pick_resolution. Captured here because the
 * resolution loops below mutate draft_picks in place (clearing protection
 * columns) and mark swaps resolved — after the draw the "why" is gone.
 * Team names are snapshotted at draw time (this is a historical record).
 */
type ResolutionEvent =
  | { kind: 'protected'; round: number; slot: number | null; threshold: number; fromTeam: string; toTeam: string }
  | { kind: 'conveyed'; round: number; slot: number | null; threshold: number; toTeam: string; protectedBy: string }
  | { kind: 'swap_executed'; round: number; teamA: string; teamB: string }
  | { kind: 'swap_voided'; round: number; teamA: string; teamB: string; missing: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SB_SECRET_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new HttpError('Missing authorization header', 401);
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SB_PUBLISHABLE_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new HttpError('Unauthorized', 401);

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'start-lottery');
    if (rateLimited) return rateLimited;

    const { league_id } = parseBody(Body, await req.json());

    const { data: league, error: leagueErr } = await supabaseAdmin
      .from('leagues')
      .select('created_by, name, season, teams, playoff_teams, playoff_weeks, lottery_draws, lottery_odds, rookie_draft_rounds, offseason_step')
      .eq('id', league_id)
      .single();
    if (leagueErr || !league) throw new HttpError('League not found', 404);
    if (league.created_by !== user.id) throw new HttpError('Only the commissioner can run the lottery', 403);

    // Validate offseason state
    const validSteps = ['lottery_pending', 'lottery_scheduled'];
    if (!validSteps.includes(league.offseason_step ?? '')) {
      throw new HttpError(`Cannot run lottery in current state: ${league.offseason_step}`);
    }

    const season = league.season;

    // Get archived standings from team_seasons. CRITICAL: filter to the most
    // recent archived season only — for any league past year 1, querying
    // without a season filter returns one row per team per past season,
    // duplicating teams in the lottery pool and corrupting the draft order.
    const { data: allArchived } = await supabaseAdmin
      .from('team_seasons')
      .select('team_id, wins, points_for, season')
      .eq('league_id', league_id)
      .order('season', { ascending: false });

    let orderedTeams: Array<{ id: string; name: string; wins: number; points_for: number }>;

    if (allArchived && allArchived.length > 0) {
      const latestSeason = allArchived[0].season;
      const archivedStats = allArchived
        .filter(r => r.season === latestSeason)
        .sort((a, b) =>
          a.wins - b.wins || Number(a.points_for) - Number(b.points_for),
        );

      const teamIds = archivedStats.map(s => s.team_id);
      const { data: teamNames } = await supabaseAdmin
        .from('teams')
        .select('id, name')
        .in('id', teamIds);
      const nameMap = new Map((teamNames ?? []).map(t => [t.id, t.name]));

      orderedTeams = archivedStats.map(s => ({
        id: s.team_id,
        name: nameMap.get(s.team_id) ?? 'Unknown',
        wins: s.wins,
        points_for: Number(s.points_for),
      }));
    } else {
      const { data: allTeams } = await supabaseAdmin
        .from('teams')
        .select('id, name, wins, points_for')
        .eq('league_id', league_id)
        .order('wins', { ascending: true })
        .order('points_for', { ascending: true });
      orderedTeams = (allTeams ?? []).map(t => ({ ...t, points_for: Number(t.points_for) }));
    }

    const totalTeams = orderedTeams.length;
    const playoffTeams = league.playoff_teams ?? Math.min(2 ** (league.playoff_weeks ?? 3), totalTeams);
    const lotteryPoolSize = Math.max(0, totalTeams - playoffTeams);

    if (lotteryPoolSize === 0) {
      throw new HttpError('No lottery pool: all teams make the playoffs');
    }

    const lotteryPool = orderedTeams.slice(0, lotteryPoolSize);

    const finalOrder = runLotteryDraw(lotteryPool, league.lottery_odds, league.lottery_draws ?? 4);

    // Store results
    const { error: resultErr } = await supabaseAdmin
      .from('lottery_results')
      .upsert({ league_id, season, results: finalOrder }, { onConflict: 'league_id,season' });
    if (resultErr) throw resultErr;

    // Build full draft order: lottery teams first, then playoff teams in
    // worst-record-first order (worst playoff team gets the next pick after
    // the lottery; best record picks last). `orderedTeams` is already sorted
    // ascending by wins, and the lottery pool was the first N entries (the
    // worst N), so filtering out the lottery teams leaves the playoff teams
    // already in [worst-playoff, ..., best-playoff] order — no reverse needed.
    const lotteryTeamIds = new Set(finalOrder.map(e => e.team_id));
    const playoffTeamsPicks = orderedTeams.filter(t => !lotteryTeamIds.has(t.id));

    const fullDraftOrder = [
      ...finalOrder.map(e => e.team_id),
      ...playoffTeamsPicks.map(t => t.id),
    ];

    // Compute the resolution IN MEMORY and STAGE it on lottery_results. We do
    // NOT mutate draft_picks/pick_swaps here — the picks stay pre-lottery (odds
    // + pending conditions everywhere) until the commissioner taps "Done", which
    // runs create-rookie-draft to apply these assignments. This removes the
    // "drawn but not finalized" limbo where the draft hub showed resolved picks
    // before the lottery was committed.
    const teamNameMap = new Map(orderedTeams.map(t => [t.id, t.name]));
    const teamName = (id: string | null) => (id ? teamNameMap.get(id) ?? 'Unknown' : 'Unknown');
    const resolutionEvents: ResolutionEvent[] = [];

    const { data: seasonPicks } = await supabaseAdmin
      .from('draft_picks')
      .select('id, round, slot_number, pick_number, current_team_id, original_team_id, protection_threshold, protection_owner_id')
      .eq('league_id', league_id)
      .eq('season', season)
      .is('player_id', null)
      .is('draft_id', null);

    interface WorkPick {
      id: string;
      round: number;
      slot_number: number | null;
      pick_number: number | null;
      current_team_id: string | null;
      original_team_id: string | null;
      protection_threshold: number | null;
      protection_owner_id: string | null;
    }
    const work: WorkPick[] = (seasonPicks ?? []).map(p => ({ ...p }));

    // 1. Slot/pick number from the draw, keyed on the ORIGINATING team (whose
    //    standing/lottery position produced the slot), not the current owner.
    const posByTeam = new Map<string, number>();
    fullDraftOrder.forEach((teamId, i) => posByTeam.set(teamId, i));
    const orderLen = fullDraftOrder.length;
    for (const p of work) {
      const pos = p.original_team_id != null ? posByTeam.get(p.original_team_id) : undefined;
      if (pos != null) {
        p.slot_number = pos + 1;
        p.pick_number = (p.round - 1) * orderLen + (pos + 1);
      }
    }

    // 2. Protections: within threshold → reverts to the protection owner; else
    //    conveys to the current holder. Either way the protection clears.
    for (const p of work) {
      if (p.protection_threshold != null) {
        if (p.slot_number != null && p.slot_number <= p.protection_threshold) {
          resolutionEvents.push({
            kind: 'protected', round: p.round, slot: p.slot_number, threshold: p.protection_threshold,
            fromTeam: teamName(p.current_team_id), toTeam: teamName(p.protection_owner_id),
          });
          p.current_team_id = p.protection_owner_id;
        } else {
          resolutionEvents.push({
            kind: 'conveyed', round: p.round, slot: p.slot_number, threshold: p.protection_threshold,
            toTeam: teamName(p.current_team_id), protectedBy: teamName(p.protection_owner_id),
          });
        }
        p.protection_threshold = null;
        p.protection_owner_id = null;
      }
    }

    // 3. Swaps, evaluated against the post-protection ownership.
    const { data: unresolvedSwaps } = await supabaseAdmin
      .from('pick_swaps')
      .select('id, round, beneficiary_team_id, counterparty_team_id')
      .eq('league_id', league_id)
      .eq('season', season)
      .eq('resolved', false);

    const swapWarnings: string[] = [];
    const swapsResolved: string[] = [];
    for (const swap of unresolvedSwaps ?? []) {
      const benefName = teamName(swap.beneficiary_team_id);
      const counterName = teamName(swap.counterparty_team_id);
      const benefPick = work.find(p => p.round === swap.round && p.current_team_id === swap.beneficiary_team_id);
      const counterPick = work.find(p => p.round === swap.round && p.current_team_id === swap.counterparty_team_id);
      if (benefPick && counterPick) {
        if ((counterPick.slot_number ?? 999) < (benefPick.slot_number ?? 999)) {
          // Beneficiary takes the better (counterparty's) pick.
          counterPick.current_team_id = swap.beneficiary_team_id;
          benefPick.current_team_id = swap.counterparty_team_id;
          resolutionEvents.push({ kind: 'swap_executed', round: swap.round, teamA: benefName, teamB: counterName });
        }
        // else: beneficiary's own pick was already better/equal — no change.
      } else {
        const missing = !benefPick && !counterPick ? 'both teams' : !benefPick ? benefName : counterName;
        resolutionEvents.push({ kind: 'swap_voided', round: swap.round, teamA: benefName, teamB: counterName, missing });
        swapWarnings.push(`Rd ${swap.round} swap between ${benefName} and ${counterName} voided — ${missing} no longer holds a pick in this round (protection triggered).`);
        console.warn(`Swap voided: Rd ${swap.round} ${benefName} vs ${counterName} — ${missing} missing pick`);
      }
      swapsResolved.push(swap.id);
    }

    // Stage the resolution (applied at "Done" by create-rookie-draft). Includes
    // the events for the summary + the per-pick assignments to commit.
    const pickAssignments = {
      picks: work.map(p => ({
        id: p.id,
        round: p.round,
        original_team_id: p.original_team_id,
        slot_number: p.slot_number,
        pick_number: p.pick_number,
        current_team_id: p.current_team_id,
      })),
      swaps_resolved: swapsResolved,
    };

    await supabaseAdmin
      .from('lottery_results')
      .update({ pick_resolution: resolutionEvents, pick_assignments: pickAssignments })
      .eq('league_id', league_id)
      .eq('season', season);

    // Notify commissioner if any swaps were voided. Deep-links to the lottery
    // room where the full resolution summary is shown post-reveal.
    if (swapWarnings.length > 0) {
      try {
        const ln = league.name ?? 'Your League';
        await notifyLeague(supabaseAdmin, league_id, 'draft',
          `${ln} — Lottery Notice`,
          `${swapWarnings.length} pick swap(s) voided due to protection: ${swapWarnings.join(' ')}`,
          { screen: 'lottery-room' }
        );
      } catch (notifyErr) {
        console.warn('Swap warning notification failed (non-fatal):', notifyErr);
      }
    }

    // Update league state. `lottery_revealing` is the intermediate step where
    // the RNG has run and results are persisted, but the ceremony hasn't been
    // marked done yet. The home hero shows a "Watch the Reveal" CTA visible to
    // everyone in this state. Lottery-room's `handleDone` advances to
    // `lottery_complete` once the commissioner closes the ceremony.
    await supabaseAdmin
      .from('leagues')
      .update({
        lottery_status: 'complete',
        offseason_step: 'lottery_revealing',
      })
      .eq('id', league_id);

    return jsonResponse({
      message: swapWarnings.length > 0
        ? `Lottery completed! Note: ${swapWarnings.length} pick swap(s) voided due to protection.`
        : 'Lottery completed!',
      results: finalOrder,
      lottery_pool_size: lotteryPoolSize,
      draws: league.lottery_draws ?? 4,
      swap_warnings: swapWarnings,
    });
  } catch (error) {
    return handleError(error, 'start-lottery');
  }
});
