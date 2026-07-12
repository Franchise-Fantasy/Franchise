/**
 * Auto-default lapsed playoff seed picks.
 *
 * The `higher_seed_picks` playoff format asks each higher seed to choose its
 * opponent, in seed order. If a manager never chooses, the whole bracket stalls
 * indefinitely — no matchups, no scoring — because nothing else advances it
 * (the "your turn to pick" push is best-effort and requires the manager to act;
 * see the Lady Chewers 2026 stall). This cron closes that gap: once a pick has
 * been pending longer than PICK_WINDOW_HOURS, it hands the bracket to
 * generate-playoff-round in `auto_resolve_picks` mode, which fills every
 * still-pending pick with the lowest available seed (the standard-bracket
 * default) and builds the round.
 *
 * Anchored to `created_at` — the picks are created at the slate rollover right
 * after the round's matchups finalize, so every manager gets the same ~1-day
 * window from when their seeding locked.
 *
 * Polled hourly by pg_cron (see the cron migration). Cheap: one indexed query
 * that returns nothing on the vast majority of runs.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsResponse } from "../_shared/cors.ts";
import { handleError, jsonResponse } from "../_shared/http.ts";
import { recordHeartbeat } from "../_shared/heartbeat.ts";
import { getArchivedLeagueIds } from "../_shared/archivedLeagues.ts";

import type { Database } from "../../../types/database.types.ts";

const supabase = createClient<Database>(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY")!,
);

// How long a manager has to choose a playoff opponent before the bracket
// defaults them to the lowest available seed.
const PICK_WINDOW_HOURS = 24;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();

  try {
    // Cron auth — Bearer CRON_SECRET. Reject if the secret itself is unset so
    // an attacker can't bypass with the literal string "Bearer undefined".
    const cronSecret = Deno.env.get("CRON_SECRET");
    const authHeader = req.headers.get("Authorization");
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      await recordHeartbeat(supabase, "resolve-stale-seed-picks", "error", "unauthorized").catch(() => {});
      return jsonResponse({ ok: false, error: "unauthorized" }, 401);
    }

    const cutoff = new Date(Date.now() - PICK_WINDOW_HOURS * 3600_000).toISOString();

    const { data: stale, error } = await supabase
      .from("playoff_seed_picks")
      .select("league_id, round")
      .is("picked_opponent_id", null)
      .lt("created_at", cutoff);
    if (error) throw error;

    if (!stale || stale.length === 0) {
      await recordHeartbeat(supabase, "resolve-stale-seed-picks", "ok", "no stale picks").catch(() => {});
      return jsonResponse({ ok: true, resolved: 0 });
    }

    const archived = await getArchivedLeagueIds(supabase);

    // One generate-playoff-round call per distinct (league, round) with a
    // lapsed pending pick. Archived leagues are skipped — their bracket UI is
    // gone, so there's no one to un-stick.
    const seen = new Set<string>();
    const targets: Array<{ league_id: string; round: number }> = [];
    for (const row of stale) {
      if (archived.has(row.league_id)) continue;
      const key = `${row.league_id}:${row.round}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ league_id: row.league_id, round: row.round });
    }

    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-playoff-round`;
    const results: Array<{ league_id: string; round: number; status: number }> = [];
    for (const t of targets) {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SB_SECRET_KEY")}`,
        },
        body: JSON.stringify({
          league_id: t.league_id,
          round: t.round,
          from_seed_picks: true,
          auto_resolve_picks: true,
        }),
      });
      results.push({ ...t, status: res.status });
      if (!res.ok) {
        console.warn(`generate-playoff-round failed for ${t.league_id} round ${t.round}: ${res.status}`);
      }
    }

    await recordHeartbeat(supabase, "resolve-stale-seed-picks", "ok").catch(() => {});
    return jsonResponse({ ok: true, resolved: targets.length, results });
  } catch (err) {
    await recordHeartbeat(supabase, "resolve-stale-seed-picks", "error", String((err as Error)?.message ?? err)).catch(() => {});
    return handleError(err, "resolve-stale-seed-picks");
  }
});
