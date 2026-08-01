import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { deferWork } from '../_shared/background.ts';
import { recordHeartbeat } from '../_shared/heartbeat.ts';
import { errorResponse, handleError, jsonResponse } from '../_shared/http.ts';
import { notifyLeague } from '../_shared/push.ts';
import { shuffle } from '../_shared/shuffle.ts';
import { buildDraftPicks } from '../../../utils/draft/buildDraftPicks.ts';
import { isRookieClassAvailable } from '../../../utils/draft/rookieClassGate.ts';
import { getSportToday } from '../../../utils/leagueTime.ts';
import type { Database } from '../../../types/database.types.ts';

/**
 * Wakes redraft/keeper leagues out of their dormant offseason.
 *
 * These leagues wipe their rosters at season's end and re-draft from scratch,
 * so their entire offseason is "wait for the next draft". They can't hold it
 * immediately: the incoming rookie class isn't in `players` until that sport's
 * real draft has happened and sync-players has ingested it. That date is
 * `season_config.creation_opens_at` (falling back to a per-sport month/day) —
 * see utils/draft/rookieClassGate.ts, shared with the client so the countdown
 * the commissioner sees is the same date this enforces.
 *
 * Until then the league sits at `offseason_step = 'offseason'` showing history
 * and final standings. Once the gate passes this builds the season draft —
 * correctly, which the old client-side path did not — and flips the league to
 * `ready_for_new_season`, where the only thing left is picking a date.
 *
 * Two entry points, same logic:
 *   - cron (daily, empty body): sweeps every dormant league.
 *   - advance-season / finalize-keepers (`{ league_id }`): opens one league
 *     immediately when its gate is already in the past, so a league that
 *     finishes late doesn't sit dormant waiting for the next cron tick.
 *
 * Deploy with --no-verify-jwt.
 */

const JOB_NAME = 'open-draft-season';

type LeagueRow = {
  id: string;
  name: string | null;
  sport: string;
  season: string;
  league_type: string | null;
  roster_size: number | null;
  initial_draft_order: string | null;
  offseason_step: string | null;
};

/**
 * Slot order for the new draft, honouring the league's `initial_draft_order`.
 *
 * Returns an EMPTY array for `manual`, which leaves every pick unassigned — the
 * commissioner sets the order from the home hero's "Set Order" pill before the
 * draft can be scheduled. (Empty rather than null because Postgres can't
 * express a nullable parameter, so the generated Args type is a bare `string[]`;
 * the RPC indexes an empty array to NULL, which is the same outcome as its
 * explicit IS NULL branch.) `reverse_standings` reads the season advance-season
 * just archived (worst finisher drafts first); it falls back to a shuffle when
 * there's no archived season to rank, which is the honest answer rather than
 * an arbitrary-but-official-looking order.
 */
async function resolveSlotOrder(
  supabase: ReturnType<typeof createClient<Database>>,
  league: LeagueRow,
  teamIds: string[],
): Promise<string[]> {
  const order = league.initial_draft_order ?? 'random';
  if (order === 'manual') return [];

  if (order === 'reverse_standings') {
    const { data: archived, error } = await supabase
      .from('team_seasons')
      .select('team_id, wins, points_for, final_standing, season')
      .eq('league_id', league.id)
      .order('season', { ascending: false });
    if (error) throw error;

    const rows = (archived ?? []).filter((r) => r.season === archived?.[0]?.season);
    if (rows.length === teamIds.length) {
      const ranked = [...rows].sort((a, b) => {
        if (a.final_standing != null && b.final_standing != null) {
          return b.final_standing - a.final_standing;
        }
        if (a.wins !== b.wins) return (a.wins ?? 0) - (b.wins ?? 0);
        return Number(a.points_for ?? 0) - Number(b.points_for ?? 0);
      });
      return ranked.map((r) => r.team_id);
    }
  }

  return shuffle(teamIds);
}

/**
 * Build the season draft for one league and open it.
 *
 * Returns null when the league isn't ready (gate still closed, no teams) so the
 * caller can skip it silently — a closed gate is the normal case, not an error.
 */
async function openLeague(
  supabase: ReturnType<typeof createClient<Database>>,
  league: LeagueRow,
  creationOpensAt: string | null,
): Promise<{ draftId: string; created: boolean } | null> {
  const today = getSportToday(league.sport);
  if (!isRookieClassAvailable(league.sport, league.season, creationOpensAt, today)) {
    return null;
  }

  const { data: teams, error: teamsErr } = await supabase
    .from('teams')
    .select('id')
    .eq('league_id', league.id);
  if (teamsErr) throw teamsErr;

  const teamIds = (teams ?? []).map((t) => t.id);
  if (teamIds.length === 0) return null;

  // Rounds fill the whole roster — that IS the draft for these league types.
  // (Taxi squads are dynasty-only, so roster_size is the entire board.)
  const rounds = league.roster_size ?? 0;
  if (rounds <= 0) return null;

  // Inherit the clock and snake/linear choice from the league's previous
  // SEASON draft. Rookie drafts are excluded: their slow multi-hour clock must
  // not leak into a startup draft just because it ran more recently.
  const { data: prevDraft } = await supabase
    .from('drafts')
    .select('draft_type, time_limit')
    .eq('league_id', league.id)
    .neq('type', 'rookie')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const draftType = (prevDraft?.draft_type === 'linear' ? 'linear' : 'snake') as
    | 'snake'
    | 'linear';
  const timeLimit = prevDraft?.time_limit ?? 120;

  const slotOrder = await resolveSlotOrder(supabase, league, teamIds);
  const picks = buildDraftPicks(teamIds.length, rounds, league.season, draftType);

  const { data, error } = await supabase.rpc('create_season_draft_atomic', {
    p_league_id: league.id,
    p_season: league.season,
    p_rounds: rounds,
    p_picks_per_round: teamIds.length,
    p_draft_type: draftType,
    p_time_limit: timeLimit,
    p_picks: picks,
    p_slot_team_ids: slotOrder,
  });
  if (error) {
    // Lost the race to a concurrent run — the league is already open.
    if ((error as { code?: string }).code === '23505') return null;
    throw error;
  }

  const result = data as unknown as { draft_id: string; created: boolean } | null;
  if (!result) return null;
  return { draftId: result.draft_id, created: result.created };
}

Deno.serve(async (req) => {
  try {
    // Cron and function-to-function only — there is no user-initiated path.
    const cronSecret = Deno.env.get('CRON_SECRET') ?? '';
    const serviceKey = Deno.env.get('SB_SECRET_KEY') ?? '';
    const authHeader = req.headers.get('Authorization') ?? '';
    const authorized =
      (!!cronSecret && authHeader === `Bearer ${cronSecret}`) ||
      (!!serviceKey && authHeader === `Bearer ${serviceKey}`);
    if (!authorized) return errorResponse('Unauthorized', 401);

    const supabaseAdmin = createClient<Database>(
      Deno.env.get('SUPABASE_URL') ?? '',
      serviceKey,
    );

    let singleLeagueId: string | null = null;
    try {
      const body = await req.json();
      singleLeagueId = typeof body?.league_id === 'string' ? body.league_id : null;
    } catch {
      // Cron posts '{}'; a missing/!JSON body just means "sweep everything".
    }

    // Service role bypasses the RLS that hides archived leagues from clients,
    // so filter them here or we'd build drafts for a deleted league.
    //
    // 'ready_for_new_season' is swept alongside the dormant step on purpose:
    // it's where the old client path stranded leagues with a pick-less draft
    // shell, and create_season_draft_atomic heals exactly that. A league whose
    // board is already built is returned untouched.
    let query = supabaseAdmin
      .from('leagues')
      .select('id, name, sport, season, league_type, roster_size, initial_draft_order, offseason_step')
      .in('league_type', ['redraft', 'keeper'])
      .in('offseason_step', ['offseason', 'ready_for_new_season'])
      .is('archived_at', null);
    if (singleLeagueId) query = query.eq('id', singleLeagueId);

    const { data: leagues, error: leaguesErr } = await query;
    if (leaguesErr) throw leaguesErr;

    const candidates = (leagues ?? []) as LeagueRow[];

    // One lookup for every (sport, season) in play rather than per league.
    const gates = new Map<string, string | null>();
    if (candidates.length > 0) {
      const { data: configs, error: configErr } = await supabaseAdmin
        .from('season_config')
        .select('sport, season, creation_opens_at')
        .in('sport', [...new Set(candidates.map((l) => l.sport))])
        .in('season', [...new Set(candidates.map((l) => l.season))]);
      if (configErr) throw configErr;
      for (const row of configs ?? []) {
        gates.set(`${row.sport}:${row.season}`, row.creation_opens_at);
      }
    }

    const opened: string[] = [];
    const failed: string[] = [];
    const announcements: { leagueId: string; name: string; season: string }[] = [];

    for (const league of candidates) {
      try {
        const result = await openLeague(
          supabaseAdmin,
          league,
          gates.get(`${league.sport}:${league.season}`) ?? null,
        );
        if (!result) continue;
        opened.push(league.id);
        // Only announce a draft we actually built. Healing a stranded shell or
        // re-flipping a step is bookkeeping nobody needs a push about.
        if (result.created) {
          announcements.push({
            leagueId: league.id,
            name: league.name ?? 'Your League',
            season: league.season,
          });
        }
      } catch (err) {
        console.error(`[${JOB_NAME}] league ${league.id} failed:`, err);
        failed.push(league.id);
      }
    }

    // Nobody is waiting on this response, but the pushes still have to outlive
    // it — a bare unawaited promise races isolate teardown.
    if (announcements.length > 0) {
      deferWork(
        (async () => {
          for (const a of announcements) {
            try {
              await notifyLeague(
                supabaseAdmin,
                a.leagueId,
                'draft',
                `${a.name} — Draft Season Is Open`,
                `The ${a.season} rookie class is in. Your draft is ready to schedule.`,
                { screen: 'home' },
              );
            } catch (err) {
              console.warn(`[${JOB_NAME}] notify ${a.leagueId} failed:`, err);
            }
          }
        })(),
        `${JOB_NAME}:notify`,
      );
    }

    await recordHeartbeat(
      supabaseAdmin,
      JOB_NAME,
      failed.length > 0 ? 'error' : 'ok',
      failed.length > 0 ? `${failed.length} league(s) failed` : undefined,
    );

    return jsonResponse({
      scanned: candidates.length,
      opened: opened.length,
      failed,
    });
  } catch (error) {
    return handleError(error, JOB_NAME);
  }
});
