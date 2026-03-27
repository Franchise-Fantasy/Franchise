import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { notifyTeams } from '../_shared/push.ts';
import { corsResponse, CORS_HEADERS } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return corsResponse();

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Verify caller JWT
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader : `Bearer ${authHeader}`;
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: token ?? '' } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'mark-payment');
    if (rateLimited) return rateLimited;

    const body = await req.json();
    const { league_id, team_id, season } = body;

    // Resolve action: new action-based API or legacy paid boolean
    let action: 'self_report' | 'confirm' | 'deny';
    if (body.action) {
      action = body.action;
    } else if (typeof body.paid === 'boolean') {
      action = body.paid ? 'confirm' : 'deny';
    } else {
      return json({ error: 'league_id, team_id, season, and action (or paid boolean) are required' }, 400);
    }

    if (!league_id || !team_id || !season) {
      return json({ error: 'league_id, team_id, and season are required' }, 400);
    }

    // Fetch league info
    const { data: league } = await supabaseAdmin
      .from('leagues')
      .select('name, created_by')
      .eq('id', league_id)
      .single();
    if (!league) return json({ error: 'League not found' }, 404);

    const isCommissioner = league.created_by === user.id;

    // Fetch the team for name + ownership verification
    const { data: team } = await supabaseAdmin
      .from('teams')
      .select('name, user_id')
      .eq('id', team_id)
      .single();
    if (!team) return json({ error: 'Team not found' }, 404);

    const leagueName = league.name ?? 'Your League';
    const teamName = team.name ?? 'A team';

    // ── Helper: post a chat message attributed to a team ──
    async function postChat(fromTeamId: string, content: string) {
      try {
        const { data: leagueChat } = await supabaseAdmin
          .from('chat_conversations')
          .select('id')
          .eq('league_id', league_id)
          .eq('type', 'league')
          .single();
        if (leagueChat) {
          await supabaseAdmin.from('chat_messages').insert({
            conversation_id: leagueChat.id,
            team_id: fromTeamId,
            content,
            type: 'text',
            league_id,
          });
        }
      } catch (e) {
        console.warn('Payment chat message failed (non-fatal):', e);
      }
    }

    // ── SELF REPORT ──────────────────────────────────────────────
    if (action === 'self_report') {
      // Caller must own the team
      if (team.user_id !== user.id) {
        return json({ error: 'You can only self-report for your own team' }, 403);
      }

      const { error: upsertErr } = await supabaseAdmin
        .from('league_payments')
        .upsert(
          {
            league_id,
            team_id,
            season,
            status: 'self_reported',
            self_reported_at: new Date().toISOString(),
          },
          { onConflict: 'league_id,team_id,season' },
        );
      if (upsertErr) throw upsertErr;

      // Notify commissioner
      try {
        const { data: commTeam } = await supabaseAdmin
          .from('teams')
          .select('id')
          .eq('league_id', league_id)
          .eq('user_id', league.created_by)
          .single();
        if (commTeam) {
          await notifyTeams(
            supabaseAdmin,
            [commTeam.id],
            'commissioner',
            `${leagueName} — Payment Self-Reported`,
            `${teamName} reports they have paid.`,
            { screen: 'league-info', league_id },
          );
        }
      } catch (e) {
        console.warn('Self-report push failed (non-fatal):', e);
      }

      await postChat(team_id, `${teamName} reports they have paid the buy-in`);

      return json({ ok: true });
    }

    // ── CONFIRM / DENY — commissioner only ───────────────────────
    if (!isCommissioner) {
      return json({ error: 'Only the commissioner can confirm or deny payments' }, 403);
    }

    if (action === 'confirm') {
      const { error: upsertErr } = await supabaseAdmin
        .from('league_payments')
        .upsert(
          {
            league_id,
            team_id,
            season,
            paid: true,
            paid_at: new Date().toISOString(),
            marked_by: user.id,
            status: 'confirmed',
          },
          { onConflict: 'league_id,team_id,season' },
        );
      if (upsertErr) throw upsertErr;

      try {
        await notifyTeams(
          supabaseAdmin,
          [team_id],
          'commissioner',
          `${leagueName} — Payment Confirmed`,
          `Your payment has been confirmed by the commissioner.`,
          { screen: 'league-info', league_id },
        );
      } catch (e) {
        console.warn('Confirm push failed (non-fatal):', e);
      }

      // Find commissioner's team for chat attribution
      const { data: commTeam } = await supabaseAdmin
        .from('teams')
        .select('id')
        .eq('league_id', league_id)
        .eq('user_id', user.id)
        .single();
      if (commTeam) {
        await postChat(commTeam.id, `${teamName}'s payment has been confirmed`);
      }

      return json({ ok: true });
    }

    if (action === 'deny') {
      const { error: upsertErr } = await supabaseAdmin
        .from('league_payments')
        .upsert(
          {
            league_id,
            team_id,
            season,
            paid: false,
            paid_at: null,
            marked_by: null,
            status: 'unpaid',
            self_reported_at: null,
          },
          { onConflict: 'league_id,team_id,season' },
        );
      if (upsertErr) throw upsertErr;

      // Private notification to the team owner — no chat message
      try {
        await notifyTeams(
          supabaseAdmin,
          [team_id],
          'commissioner',
          `${leagueName} — Payment Not Confirmed`,
          `The commissioner has not confirmed your payment. Please reach out.`,
          { screen: 'league-info', league_id },
        );
      } catch (e) {
        console.warn('Deny push failed (non-fatal):', e);
      }

      return json({ ok: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err: any) {
    console.error('mark-payment error:', err);
    return json({ error: err?.message ?? String(err) }, 500);
  }
});
