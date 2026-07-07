import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifyTeams } from '../_shared/push.ts';
import { CORS_HEADERS } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { HttpError, handleError, jsonResponse } from '../_shared/http.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { parseBody, z } from '../_shared/validate.ts';

const Body = z.object({
  league_id: z.string().uuid(),
  round: z.number().int().min(1, 'round must be a positive integer'),
  opponent_team_id: z.string().uuid(),
});

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SB_SECRET_KEY')!
    );

    const user = await requireUser(req);

    const rateLimited = await checkRateLimit(supabase, user.id, 'submit-seed-pick');
    if (rateLimited) return rateLimited;

    const { league_id, round, opponent_team_id } = parseBody(Body, await req.json());

    const { data: myTeam } = await supabase
      .from('teams').select('id').eq('league_id', league_id).eq('user_id', user.id).single();
    if (!myTeam) throw new HttpError('Team not found in league', 403);
    if (opponent_team_id === myTeam.id) {
      throw new HttpError('Cannot pick your own team as an opponent');
    }

    const { data: myPick } = await supabase
      .from('playoff_seed_picks').select('id, picking_seed')
      .eq('league_id', league_id).eq('round', round)
      .eq('picking_team_id', myTeam.id).is('picked_opponent_id', null).single();
    if (!myPick) throw new HttpError('No pending pick found for your team');

    const { data: higherPicks } = await supabase
      .from('playoff_seed_picks').select('picking_seed, picked_opponent_id')
      .eq('league_id', league_id).eq('round', round)
      .lt('picking_seed', myPick.picking_seed);

    const allHigherDone = (higherPicks ?? []).every((p: any) => p.picked_opponent_id !== null);
    if (!allHigherDone) throw new HttpError('Not your turn yet \u2014 higher seeds must pick first', 403);

    const { data: takenPicks } = await supabase
      .from('playoff_seed_picks').select('picked_opponent_id')
      .eq('league_id', league_id).eq('round', round)
      .not('picked_opponent_id', 'is', null);

    const takenIds = new Set((takenPicks ?? []).map((p: any) => p.picked_opponent_id));
    if (takenIds.has(opponent_team_id)) {
      throw new HttpError('That opponent has already been picked by another team', 409);
    }

    const { error: updateErr } = await supabase
      .from('playoff_seed_picks')
      .update({ picked_opponent_id: opponent_team_id, picked_at: new Date().toISOString() })
      .eq('id', myPick.id);
    if (updateErr) throw updateErr;

    const { data: remaining } = await supabase
      .from('playoff_seed_picks').select('id')
      .eq('league_id', league_id).eq('round', round)
      .is('picked_opponent_id', null);

    if (remaining && remaining.length === 0) {
      const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-playoff-round`;
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Deno.env.get('SB_SECRET_KEY')}`,
        },
        body: JSON.stringify({ league_id, round, from_seed_picks: true }),
      });
      return jsonResponse({ success: true, all_picks_complete: true });
    }

    // Notify the next seed picker
    try {
      const [{ data: nextPick }, { data: leagueInfo }] = await Promise.all([
        supabase
          .from('playoff_seed_picks')
          .select('picking_team_id, picking_seed')
          .eq('league_id', league_id).eq('round', round)
          .is('picked_opponent_id', null)
          .order('picking_seed', { ascending: true })
          .limit(1)
          .maybeSingle(),
        supabase.from('leagues').select('name').eq('id', league_id).single(),
      ]);

      if (nextPick) {
        const ln = leagueInfo?.name ?? 'Your League';
        await notifyTeams(supabase, [nextPick.picking_team_id], 'playoffs',
          `${ln} — Your Turn to Pick`,
          `Seed #${nextPick.picking_seed}, choose your playoff opponent.`,
          { screen: 'playoff-bracket' }
        );
      }
    } catch (notifyErr) {
      console.warn('Push notification failed (non-fatal):', notifyErr);
    }

    return jsonResponse({ success: true, all_picks_complete: false });
  } catch (error) {
    return handleError(error, 'submit-seed-pick');
  }
});
