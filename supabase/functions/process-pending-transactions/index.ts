import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { notifyLeague } from '../_shared/push.ts';
import { snapshotBeforeDrop } from '../_shared/snapshotBeforeDrop.ts';

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY")!,
);

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

Deno.serve(async (req: Request) => {
  const cronSecret = Deno.env.get('CRON_SECRET');
  const authHeader = req.headers.get('Authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const today = toDateStr(new Date());

  const { data: pending, error: fetchErr } = await supabase
    .from("pending_transactions")
    .select("*")
    .eq("status", "pending")
    .lte("execute_after", today);

  if (fetchErr) {
    return new Response(
      JSON.stringify({ ok: false, error: fetchErr.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  let processed = 0;
  const errors: string[] = [];

  for (const txn of pending ?? []) {
    try {
      let notifBody = '';

      // Fetch league waiver settings for drop actions
      let leagueWaiverType = 'none';
      let leagueWaiverDays = 0;
      if (txn.action_type === 'drop') {
        const { data: leagueSettings } = await supabase
          .from('leagues')
          .select('waiver_type, waiver_period_days')
          .eq('id', txn.league_id)
          .single();
        leagueWaiverType = leagueSettings?.waiver_type ?? 'none';
        leagueWaiverDays = leagueSettings?.waiver_period_days ?? 2;
      }

      if (txn.action_type === "drop") {
        // Snapshot roster slot before dropping so mid-week scoring is preserved
        await snapshotBeforeDrop(supabase, txn.league_id, txn.team_id, txn.player_id);

        const { error: delError } = await supabase
          .from("league_players").delete()
          .eq("league_id", txn.league_id).eq("team_id", txn.team_id).eq("player_id", txn.player_id);
        if (delError) throw delError;

        // Place dropped player on waivers so they don't become an instant free agent
        if (leagueWaiverType !== 'none' && leagueWaiverDays > 0) {
          const raw = new Date();
          raw.setDate(raw.getDate() + leagueWaiverDays);
          const until = new Date(Date.UTC(
            raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate(), 6, 0, 0, 0,
          ));
          if (raw.getTime() > until.getTime()) until.setUTCDate(until.getUTCDate() + 1);

          await supabase.from('league_waivers').insert({
            league_id: txn.league_id,
            player_id: txn.player_id,
            on_waivers_until: until.toISOString(),
            dropped_by_team_id: txn.team_id,
          });
        }

        const { data: playerData } = await supabase.from("players").select("name").eq("id", txn.player_id).single();
        const playerName = playerData?.name ?? "Unknown";
        notifBody = `${playerName} has been dropped (queued).`;

        const { data: leagueTxn, error: txnError } = await supabase
          .from("league_transactions")
          .insert({ league_id: txn.league_id, type: "waiver", notes: `Dropped ${playerName} (queued drop)`, team_id: txn.team_id })
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

  return new Response(
    JSON.stringify({
      ok: true,
      processed,
      total: pending?.length ?? 0,
      expired_reviews: expiredReviews?.length ?? 0,
      reviews_processed: reviewsProcessed,
      errors,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
