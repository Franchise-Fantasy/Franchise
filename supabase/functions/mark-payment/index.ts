import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsResponse } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { handleError, jsonResponse, errorResponse } from '../_shared/http.ts';
import { notifyTeams } from '../_shared/push.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { parseBody, z } from '../_shared/validate.ts';

// Body accepts either the new action-based API or the legacy `paid` boolean.
// `action` and `paid` are both optional in the schema; the handler resolves
// the effective action below and errors if neither is present.
const Body = z.object({
  league_id: z.string().uuid(),
  team_id: z.string().uuid(),
  season: z.string().min(1),
  action: z.enum(['self_report', 'confirm', 'deny']).optional(),
  paid: z.boolean().optional(),
});

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return corsResponse();

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SB_SECRET_KEY')!,
    );

    // Verify caller JWT
    const user = await requireUser(req);

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'mark-payment');
    if (rateLimited) return rateLimited;

    const body = parseBody(Body, await req.json());
    const { league_id, team_id, season } = body;

    // Resolve action: new action-based API or legacy paid boolean
    let action: 'self_report' | 'confirm' | 'deny';
    if (body.action) {
      action = body.action;
    } else if (typeof body.paid === 'boolean') {
      action = body.paid ? 'confirm' : 'deny';
    } else {
      return errorResponse('league_id, team_id, season, and action (or paid boolean) are required', 400);
    }

    // Fetch league info
    const { data: league } = await supabaseAdmin
      .from('leagues')
      .select('name, created_by')
      .eq('id', league_id)
      .single();
    if (!league) return errorResponse('League not found', 404);

    const isCommissioner = league.created_by === user.id;

    // Fetch the team for name + ownership verification
    const { data: team } = await supabaseAdmin
      .from('teams')
      .select('name, user_id')
      .eq('id', team_id)
      .single();
    if (!team) return errorResponse('Team not found', 404);

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
        return errorResponse('You can only self-report for your own team', 403);
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

      return jsonResponse({ ok: true });
    }

    // ── CONFIRM / DENY — commissioner only ───────────────────────
    if (!isCommissioner) {
      return errorResponse('Only the commissioner can confirm or deny payments', 403);
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

      return jsonResponse({ ok: true });
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

      return jsonResponse({ ok: true });
    }

    return errorResponse(`Unknown action: ${action}`, 400);
  } catch (err) {
    return handleError(err, 'mark-payment');
  }
});
