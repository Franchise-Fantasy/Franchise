import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { requireUser } from '../_shared/auth.ts';
import { deferWork } from '../_shared/background.ts';
import { corsResponse } from '../_shared/cors.ts';
import { findBestSlot } from '../_shared/findBestSlot.ts';
import { HttpError, handleError, jsonResponse } from '../_shared/http.ts';
import { notifyLeague } from '../_shared/push.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { parseBody, z } from '../_shared/validate.ts';
import type { Database } from '../../../types/database.types.ts';

// A single staged selection. Only picks the commissioner actually filled are
// sent — an empty pick is simply omitted.
const StagedPick = z.object({
  pick_number: z.number().int().positive(),
  player_id: z.string().uuid(),
});

const Body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('save'),
    draft_id: z.string().uuid(),
    picks: z.array(StagedPick),
  }),
  z.object({
    action: z.literal('publish'),
    draft_id: z.string().uuid(),
    picks: z.array(StagedPick).min(1, 'Enter at least one pick before publishing'),
  }),
  z.object({
    action: z.literal('reopen'),
    draft_id: z.string().uuid(),
  }),
]);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  try {
    const supabase = createClient<Database>(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SB_SECRET_KEY') ?? '',
    );

    const user = await requireUser(req);
    const body = parseBody(Body, await req.json());

    // Load the draft + its league; verify the caller is the commissioner and
    // this is actually an offline rookie draft.
    const { data: draft, error: draftErr } = await supabase
      .from('drafts')
      .select('id, league_id, type, is_offline, rounds, picks_per_round, leagues(created_by, name, sport)')
      .eq('id', body.draft_id)
      .single();
    if (draftErr || !draft) throw new HttpError('Draft not found', 404);

    const league = draft.leagues as unknown as { created_by: string; name: string | null; sport: string } | null;
    if (!league) throw new HttpError('League not found', 404);
    if (league.created_by !== user.id) throw new HttpError('Only the commissioner can enter offline draft results', 403);
    if (!draft.is_offline) throw new HttpError('This draft is not in offline mode', 409);

    const leagueId = draft.league_id;

    // ── reopen ────────────────────────────────────────────────────────────
    if (body.action === 'reopen') {
      const { error: rpcErr } = await supabase.rpc('apply_offline_draft', {
        p_draft_id: draft.id,
        p_league_id: leagueId,
        p_mode: 'reopen',
      });
      if (rpcErr) throw rpcErr;
      return jsonResponse({ message: 'Offline draft reopened for editing' });
    }

    // No two picks can select the same player (save + publish).
    const playerIds = body.picks.map((p) => p.player_id);
    if (new Set(playerIds).size !== playerIds.length) {
      throw new HttpError('The same player is assigned to more than one pick', 400);
    }

    // Persist the staged selections either way, so a reopen/re-edit starts from
    // what the commissioner last entered.
    const { error: stageErr } = await supabase
      .from('drafts')
      .update({ offline_picks: body.picks })
      .eq('id', draft.id);
    if (stageErr) throw stageErr;

    // ── save ──────────────────────────────────────────────────────────────
    if (body.action === 'save') {
      return jsonResponse({ message: 'Draft saved', picks: body.picks.length });
    }

    // ── publish ───────────────────────────────────────────────────────────
    const rateLimited = await checkRateLimit(supabase, user.id, 'offline-draft-publish');
    if (rateLimited) return rateLimited;

    // Map every pick number to its owning team.
    const { data: draftPicks, error: dpErr } = await supabase
      .from('draft_picks')
      .select('pick_number, current_team_id, player_id')
      .eq('draft_id', draft.id);
    if (dpErr) throw dpErr;
    const teamByPick = new Map<number, string>();
    const currentDraftPlayerIds = new Set<string>();
    for (const dp of draftPicks ?? []) {
      if (dp.pick_number != null && dp.current_team_id) teamByPick.set(dp.pick_number, dp.current_team_id);
      if (dp.player_id) currentDraftPlayerIds.add(dp.player_id);
    }
    for (const p of body.picks) {
      if (!teamByPick.has(p.pick_number)) {
        throw new HttpError(`Pick ${p.pick_number} has no owning team`, 409);
      }
    }

    // Resolve each drafted player's position + validate they belong to this
    // league's sport. ids belong to exactly one sport, so the .in() is scoped.
    const { data: players, error: plErr } = await supabase
      .from('players')
      .select('id, name, position, sport')
      .in('id', playerIds);
    if (plErr) throw plErr;
    const playerById = new Map((players ?? []).map((pl) => [pl.id, pl]));
    for (const id of playerIds) {
      const pl = playerById.get(id);
      if (!pl) throw new HttpError('One of the selected players could not be found', 404);
      if (pl.sport !== league.sport) throw new HttpError(`${pl.name} is not a ${league.sport} player`, 400);
    }

    // Reject players already rostered by other means (trade/FA/prior season).
    // Players currently drafted by THIS draft are exempt — publish tears them
    // down first, so re-publishing over them is fine.
    const { data: rostered } = await supabase
      .from('league_players')
      .select('player_id')
      .eq('league_id', leagueId)
      .in('player_id', playerIds);
    const conflicts = (rostered ?? [])
      .map((r) => r.player_id)
      .filter((id): id is string => !!id && !currentDraftPlayerIds.has(id));
    if (conflicts.length > 0) {
      const names = conflicts.map((id) => playerById.get(id)?.name ?? 'a player').join(', ');
      throw new HttpError(`Already on a roster in this league: ${names}`, 409);
    }

    // Compute each pick's roster_slot exactly like the live draft: build every
    // team's baseline roster (excluding this draft's own picks, which get torn
    // down), then assign picks in order, growing the in-memory roster as we go
    // so a team's later picks see its earlier ones as occupied.
    const { data: rosterConfig } = await supabase
      .from('league_roster_config')
      .select('position, slot_count')
      .eq('league_id', leagueId);
    const configs = rosterConfig ?? [];

    const { data: allRoster } = await supabase
      .from('league_players')
      .select('team_id, position, roster_slot, player_id')
      .eq('league_id', leagueId);
    const rosterByTeam = new Map<string, Array<{ roster_slot: string | null }>>();
    for (const lp of allRoster ?? []) {
      if (!lp.team_id) continue;
      // Skip this draft's own players — they're removed before re-inserting.
      if (lp.player_id && currentDraftPlayerIds.has(lp.player_id)) continue;
      const list = rosterByTeam.get(lp.team_id) ?? [];
      list.push({ roster_slot: lp.roster_slot });
      rosterByTeam.set(lp.team_id, list);
    }

    const resolved = [...body.picks]
      .sort((a, b) => a.pick_number - b.pick_number)
      .map((p) => {
        const teamId = teamByPick.get(p.pick_number)!;
        const position = playerById.get(p.player_id)?.position ?? '';
        const roster = rosterByTeam.get(teamId) ?? [];
        const rosterSlot = findBestSlot(configs, roster, position);
        roster.push({ roster_slot: rosterSlot });
        rosterByTeam.set(teamId, roster);
        return { pick_number: p.pick_number, player_id: p.player_id, team_id: teamId, position, roster_slot: rosterSlot };
      });

    const { error: rpcErr } = await supabase.rpc('apply_offline_draft', {
      p_draft_id: draft.id,
      p_league_id: leagueId,
      p_mode: 'publish',
      p_picks: resolved,
    });
    if (rpcErr) {
      if (rpcErr.code === '23505') throw new HttpError('One of these players is already rostered', 409);
      throw rpcErr;
    }

    const ln = league.name ?? 'Your League';
    deferWork(
      notifyLeague(
        supabase,
        leagueId,
        'draft',
        `${ln} — Rookie Draft Results Are In`,
        'The commissioner has published the offline rookie draft results. Check your new players.',
        { screen: 'roster' },
      ),
      'offline-draft-publish push',
    );

    return jsonResponse({ message: 'Offline draft published', picks: resolved.length });
  } catch (error) {
    return handleError(error, 'offline-draft');
  }
});
