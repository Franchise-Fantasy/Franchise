import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Receiver } from 'https://esm.sh/@upstash/qstash';
import { handleError, jsonResponse, errorResponse } from '../_shared/http.ts';
import { notifyTeams } from '../_shared/push.ts';
import { parseBody, z } from '../_shared/validate.ts';
import { formatPickClock, pickDeadlineMs } from '../../../utils/draft/pickClock.ts';
import type { Database } from '../../../types/database.types.ts';

/**
 * Slow-draft pick reminder. Scheduled via QStash (see _shared/qstash.ts
 * schedulePickReminder) alongside the autodraft clock whenever a pick starts
 * with a slow (>= 30 min) limit, delayed to fire when ~a quarter of the clock
 * remains. Like autodraft, it's idempotent against stale deliveries: it
 * no-ops unless the draft is still in_progress on the SAME pick number with
 * no player selected. Auth is the QStash signature — deploy --no-verify-jwt.
 */

const Body = z.object({
  draft_id: z.string().uuid(),
  pick_number: z.number().int().positive(),
});

Deno.serve(async (req) => {
  try {
    const receiver = new Receiver({
      currentSigningKey: Deno.env.get('QSTASH_CURRENT_SIGNING_KEY') ?? '',
      nextSigningKey: Deno.env.get('QSTASH_NEXT_SIGNING_KEY') ?? '',
    });

    const bodyText = await req.text();
    const reminderUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/draft-pick-reminder`;

    try {
      await receiver.verify({
        signature: req.headers.get('Upstash-Signature') ?? '',
        body: bodyText,
        url: reminderUrl,
      });
    } catch {
      return errorResponse('Unauthorized', 401);
    }

    const { draft_id, pick_number } = parseBody(Body, JSON.parse(bodyText));

    const supabaseAdmin = createClient<Database>(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SB_SECRET_KEY') ?? ''
    );

    const [draftResult, pickResult] = await Promise.all([
      supabaseAdmin
        .from('drafts')
        .select('current_pick_number, current_pick_timestamp, current_pick_time_limit, time_limit, status, type, league_id')
        .eq('id', draft_id)
        .single(),
      supabaseAdmin
        .from('draft_picks')
        .select('current_team_id, player_id')
        .eq('draft_id', draft_id)
        .eq('pick_number', pick_number)
        .single(),
    ]);

    const { data: draft } = draftResult;
    const { data: pick } = pickResult;

    // Stale or irrelevant delivery — the pick was made, the draft moved on,
    // was paused, or completed. All expected; QStash messages can't be
    // cancelled, so these no-ops ARE the cancellation mechanism.
    if (
      !draft || !pick || !pick.current_team_id ||
      draft.status !== 'in_progress' ||
      draft.current_pick_number !== pick_number ||
      pick.player_id
    ) {
      return jsonResponse({ message: 'Reminder not needed' });
    }
    const onClockTeamId = pick.current_team_id;

    // If the team already opted into autopick, their pick resolves on its own.
    const { data: teamStatus } = await supabaseAdmin
      .from('draft_team_status')
      .select('autopick_on')
      .eq('draft_id', draft_id)
      .eq('team_id', onClockTeamId)
      .maybeSingle();
    if (teamStatus?.autopick_on) {
      return jsonResponse({ message: 'Team is on autopick' });
    }

    // Remaining time from the live clock anchor. A resume can have shifted
    // the deadline after this message was scheduled — recompute rather than
    // trusting the original lead. If the clock somehow already expired,
    // autodraft is imminent; stay quiet.
    const limitSeconds = draft.current_pick_time_limit ?? draft.time_limit;
    const remainingMs = pickDeadlineMs(draft.current_pick_timestamp, limitSeconds) - Date.now();
    if (remainingMs <= 0) {
      return jsonResponse({ message: 'Clock already expired' });
    }

    const { data: league } = await supabaseAdmin
      .from('leagues')
      .select('name, archived_at')
      .eq('id', draft.league_id)
      .single();
    // League archived (soft-deleted) since this reminder was scheduled (up to
    // 18h earlier for a 1-day clock). Don't push a deep link into a league the
    // client can no longer open — notifyTeams (singular) has no archived
    // backstop, unlike the Bulk senders.
    if (!league || league.archived_at) {
      return jsonResponse({ message: 'League archived; reminder skipped' });
    }
    const ln = league.name ?? 'Your League';

    await notifyTeams(supabaseAdmin, [onClockTeamId], 'draft',
      draft.type === 'rookie' ? `${ln} — Rookie Draft reminder` : `${ln} — Draft reminder`,
      `Still on the clock — about ${formatPickClock(Math.round(remainingMs / 1000))} left before autopick makes your pick.`,
      { screen: 'draft-room', draft_id }
    );

    return jsonResponse({ message: 'Reminder sent' });
  } catch (error) {
    return handleError(error, 'draft-pick-reminder');
  }
});
