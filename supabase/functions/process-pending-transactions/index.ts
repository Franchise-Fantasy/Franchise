import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// esm.sh (not jsr:) so the SupabaseClient type matches _shared/push.ts,
// snapshotBeforeDrop.ts, and archivedLeagues.ts — the jsr and esm.sh builds
// produce nominally-different SupabaseClient types that don't interop.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { errorResponse, jsonResponse } from '../_shared/http.ts';
import { createLogger } from '../_shared/log.ts';
import { notifyLeague } from '../_shared/push.ts';
import { snapshotBeforeDrop } from '../_shared/snapshotBeforeDrop.ts';
import { getArchivedLeagueIds } from '../_shared/archivedLeagues.ts';

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY")!,
);

Deno.serve(async (req: Request) => {
  const cronSecret = Deno.env.get('CRON_SECRET');
  const authHeader = req.headers.get('Authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return errorResponse('Unauthorized', 401);
  }

  // execute_after is now a timestamptz holding the precise rollover moment;
  // fire whenever that moment has passed regardless of UTC vs ET calendar day.
  const { data: pending, error: fetchErr } = await supabase
    .from("pending_transactions")
    .select("*")
    .eq("status", "pending")
    .lte("execute_after", new Date().toISOString());

  if (fetchErr) {
    createLogger('process-pending-transactions').error('Failed to fetch pending transactions', fetchErr);
    return errorResponse('Internal server error', 500);
  }

  let processed = 0;
  const errors: string[] = [];

  // Archived leagues bypass RLS for the service role — never execute their
  // pending add/drops or push to members of a deleted league.
  const archivedLeagueIds = await getArchivedLeagueIds(supabase);

  for (const txn of pending ?? []) {
    if (archivedLeagueIds.has(txn.league_id)) continue;
    try {
      let notifBody = '';

      if (txn.action_type === "drop") {
        // Snapshot roster slot before dropping so mid-week scoring is preserved
        await snapshotBeforeDrop(supabase, txn.league_id, txn.team_id, txn.player_id);

        const { error: delError } = await supabase
          .from("league_players").delete()
          .eq("league_id", txn.league_id).eq("team_id", txn.team_id).eq("player_id", txn.player_id);
        if (delError) throw delError;

        // Place the dropped player on waivers so they don't become an instant
        // free agent. `waiver_until` owns the cadence for every writer of
        // league_waivers (basketball: rollover + period; NFL: the weekly
        // Wednesday clear) and returns NULL for a no-waiver league.
        const { data: until } = await supabase
          .rpc('waiver_until', { p_league_id: txn.league_id });
        if (until) {
          await supabase.from('league_waivers').insert({
            league_id: txn.league_id,
            player_id: txn.player_id,
            on_waivers_until: until,
            dropped_by_team_id: txn.team_id,
          });
        }

        const { data: playerData } = await supabase.from("players").select("name").eq("id", txn.player_id).single();
        const playerName = playerData?.name ?? "Unknown";

        // When this drop is the back half of an add+drop done in one user
        // action, the add already announced both sides at submit time. Carry
        // the shared group_id onto this row so the feed groups them, and stay
        // quiet here to avoid a duplicate push.
        const groupId = (txn.metadata as { group_id?: string } | null)?.group_id ?? null;
        notifBody = groupId ? '' : `${playerName} has been dropped (queued).`;

        const { data: leagueTxn, error: txnError } = await supabase
          .from("league_transactions")
          .insert({ league_id: txn.league_id, type: "waiver", notes: `Dropped ${playerName} (queued drop)`, team_id: txn.team_id, group_id: groupId })
          .select("id").single();
        if (txnError) throw txnError;

        await supabase.from("league_transaction_items").insert({
          transaction_id: leagueTxn.id, player_id: txn.player_id, team_from_id: txn.team_id,
        });

      } else if (txn.action_type === "trade" && txn.metadata?.proposal_id) {
        // Re-invoke execute-trade for delayed trades
        const res = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/execute-trade`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SB_SECRET_KEY')}`,
            },
            body: JSON.stringify({ proposal_id: txn.metadata.proposal_id }),
          },
        );
        const result = await res.json();
        if (!res.ok) throw new Error(result.error ?? 'Trade execution failed');
        notifBody = result.message ?? 'Delayed trade has been processed.';

      }

      await supabase.from("pending_transactions").update({ status: "completed" }).eq("id", txn.id);
      processed++;

      // Notify the league about the roster move
      if (notifBody) {
        try {
          const [{ data: leagueInfo }, { data: teamInfo }] = await Promise.all([
            supabase.from('leagues').select('name').eq('id', txn.league_id).single(),
            supabase.from('teams').select('name').eq('id', txn.team_id).single(),
          ]);
          const ln = leagueInfo?.name ?? 'Your League';
          const teamName = teamInfo?.name ?? 'A team';
          await notifyLeague(supabase, txn.league_id, 'roster_moves',
            `${ln} — Roster Move`,
            `${teamName}: ${notifBody}`,
            { screen: 'activity' }
          );
        } catch (notifyErr) {
          console.warn('Push notification failed (non-fatal):', notifyErr);
        }
      }
    } catch (err: any) {
      errors.push(`${txn.id}: ${err.message}`);
      console.error(`Failed to process pending transaction ${txn.id}:`, err.message);
    }
  }

  // Process expired trade reviews — execute trades whose review period has passed
  const now = new Date().toISOString();
  const { data: expiredReviews } = await supabase
    .from('trade_proposals')
    .select('id')
    .eq('status', 'in_review')
    .lte('review_expires_at', now);

  let reviewsProcessed = 0;
  for (const review of expiredReviews ?? []) {
    try {
      const res = await fetch(
        `${Deno.env.get('SUPABASE_URL')}/functions/v1/execute-trade`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SB_SECRET_KEY')}`,
          },
          body: JSON.stringify({ proposal_id: review.id }),
        },
      );
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? 'Trade execution failed');
      reviewsProcessed++;
    } catch (err: any) {
      errors.push(`trade-review ${review.id}: ${err.message}`);
      console.error(`Failed to process expired trade review ${review.id}:`, err.message);
    }
  }

  return jsonResponse({
    ok: true,
    processed,
    total: pending?.length ?? 0,
    expired_reviews: expiredReviews?.length ?? 0,
    reviews_processed: reviewsProcessed,
    errors,
  });
});
