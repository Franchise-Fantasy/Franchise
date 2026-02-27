import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { notifyTeams } from './push.ts';

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

Deno.serve(async (req: Request) => {
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (cronSecret) {
    const authHeader = req.headers.get('Authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      });
    }
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

      if (txn.action_type === "drop") {
        const { error: delError } = await supabase
          .from("league_players").delete()
          .eq("league_id", txn.league_id).eq("team_id", txn.team_id).eq("player_id", txn.player_id);
        if (delError) throw delError;

        const { data: playerData } = await supabase.from("players").select("name").eq("id", txn.player_id).single();
        const playerName = playerData?.name ?? "Unknown";
        notifBody = `${playerName} has been dropped (queued).`;

        const { data: leagueTxn, error: txnError } = await supabase
          .from("league_transactions")
          .insert({ league_id: txn.league_id, type: "waiver", notes: `Dropped ${playerName} (queued drop)` })
          .select("id").single();
        if (txnError) throw txnError;

        await supabase.from("league_transaction_items").insert({
          transaction_id: leagueTxn.id, player_id: txn.player_id, team_from_id: txn.team_id,
        });

      } else if (txn.action_type === "add_drop" && txn.target_player_id) {
        const { error: delError } = await supabase
          .from("league_players").delete()
          .eq("league_id", txn.league_id).eq("team_id", txn.team_id).eq("player_id", txn.player_id);
        if (delError) throw delError;

        const { data: players } = await supabase
          .from("players").select("id, name, position").in("id", [txn.player_id, txn.target_player_id]);
        const dropPlayer = players?.find((p: any) => p.id === txn.player_id);
        const addPlayer = players?.find((p: any) => p.id === txn.target_player_id);
        notifBody = `Added ${addPlayer?.name ?? 'Unknown'}, dropped ${dropPlayer?.name ?? 'Unknown'} (queued).`;

        const { error: addError } = await supabase.from("league_players").insert({
          league_id: txn.league_id, player_id: txn.target_player_id, team_id: txn.team_id,
          acquired_via: "free_agent", acquired_at: new Date().toISOString(),
          position: addPlayer?.position ?? "Unknown",
        });
        if (addError) throw addError;

        const { data: leagueTxn, error: txnError } = await supabase
          .from("league_transactions")
          .insert({ league_id: txn.league_id, type: "waiver", notes: `Added ${addPlayer?.name ?? "Unknown"} (dropped ${dropPlayer?.name ?? "Unknown"}) (queued)` })
          .select("id").single();
        if (txnError) throw txnError;

        await supabase.from("league_transaction_items").insert([
          { transaction_id: leagueTxn.id, player_id: txn.target_player_id, team_to_id: txn.team_id },
          { transaction_id: leagueTxn.id, player_id: txn.player_id, team_from_id: txn.team_id },
        ]);
      }

      await supabase.from("pending_transactions").update({ status: "completed" }).eq("id", txn.id);
      processed++;

      // Notify the team owner
      if (notifBody) {
        try {
          const { data: leagueInfo } = await supabase.from('leagues').select('name').eq('id', txn.league_id).single();
          const ln = leagueInfo?.name ?? 'Your League';
          await notifyTeams(supabase, [txn.team_id], 'roster_reminders',
            `${ln} — Queued Transaction Processed`,
            notifBody,
            { screen: 'roster' }
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

  return new Response(
    JSON.stringify({ ok: true, processed, total: pending?.length ?? 0, errors }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
