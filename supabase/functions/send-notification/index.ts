import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { notifyTeams, notifyLeague } from '../_shared/push.ts';
import { CORS_HEADERS } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Verify the caller's JWT
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader : `Bearer ${authHeader}`;
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: token ?? '' } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'send-notification');
    if (rateLimited) return rateLimited;

    const { league_id, team_ids, category, title, body, data } = await req.json();
    if (!league_id || !category || !title || !body) {
      return new Response(JSON.stringify({ error: 'league_id, category, title, and body are required' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const validCategories = ['draft', 'trades', 'trade_block', 'matchups', 'matchup_daily', 'waivers', 'injuries', 'playoffs', 'commissioner', 'league_activity', 'roster_reminders', 'lottery', 'roster_moves'];
    if (!validCategories.includes(category)) {
      return new Response(JSON.stringify({ error: `Invalid category. Must be one of: ${validCategories.join(', ')}` }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Verify caller is a member of this league
    const { data: callerTeam } = await supabaseAdmin
      .from('teams')
      .select('id')
      .eq('league_id', league_id)
      .eq('user_id', user.id)
      .single();

    if (!callerTeam) {
      return new Response(JSON.stringify({ error: 'Not a member of this league' }), {
        status: 403,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
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

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('send-notification error:', err);
    return new Response(JSON.stringify({ error: err?.message ?? String(err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
