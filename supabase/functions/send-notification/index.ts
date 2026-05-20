import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { notifyTeams, notifyLeague } from '../_shared/push.ts';
import { CORS_HEADERS } from '../_shared/cors.ts';
import { handleError, jsonResponse, errorResponse } from '../_shared/http.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { parseBody, z } from '../_shared/validate.ts';

const NOTIFICATION_CATEGORIES = ['draft', 'trades', 'trade_rumors', 'trade_block', 'matchups', 'matchup_daily', 'waivers', 'injuries', 'playoffs', 'commissioner', 'league_activity', 'roster_reminders', 'lottery', 'chat', 'roster_moves'] as const;

const Body = z.object({
  league_id: z.string().uuid(),
  team_ids: z.array(z.string().uuid()).optional(),
  category: z.enum(NOTIFICATION_CATEGORIES, {
    errorMap: () => ({ message: `Invalid category. Must be one of: ${NOTIFICATION_CATEGORIES.join(', ')}` }),
  }),
  title: z.string().min(1),
  body: z.string().min(1),
  data: z.record(z.unknown()).optional(),
});

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SB_SECRET_KEY')!,
    );

    // Verify the caller's JWT
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader : `Bearer ${authHeader}`;
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SB_PUBLISHABLE_KEY')!,
      { global: { headers: { Authorization: token ?? '' } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return errorResponse('Unauthorized', 401);
    }

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'send-notification');
    if (rateLimited) return rateLimited;

    const { league_id, team_ids, category, title, body, data } = parseBody(Body, await req.json());

    // Verify caller is a member of this league
    const { data: callerTeam } = await supabaseAdmin
      .from('teams')
      .select('id')
      .eq('league_id', league_id)
      .eq('user_id', user.id)
      .single();

    if (!callerTeam) {
      return errorResponse('Not a member of this league', 403);
    }

    // Prepend league name to title
    const { data: leagueInfo } = await supabaseAdmin.from('leagues').select('name').eq('id', league_id).single();
    const prefixedTitle = `${leagueInfo?.name ?? 'Your League'} — ${title}`;

    // Send to specific teams or entire league, excluding the caller
    const excludeUserIds = [user.id];
    if (team_ids && Array.isArray(team_ids) && team_ids.length > 0) {
      await notifyTeams(supabaseAdmin, team_ids, category, prefixedTitle, body, data, excludeUserIds);
    } else {
      await notifyLeague(supabaseAdmin, league_id, category, prefixedTitle, body, data, excludeUserIds);
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    return handleError(error, 'send-notification');
  }
});
