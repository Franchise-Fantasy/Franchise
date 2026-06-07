/**
 * Auto-end Matchup Live Activities once the day's NBA slate is done.
 *
 * iOS auto-dismisses Live Activities after ~8h on the lock screen, but absent
 * a server signal the activity will keep showing whatever the last push said —
 * a stale score sitting on the lock screen for hours. The matchup-screen
 * "foreground reconcile" cleans the DB row when the user reopens the app, but
 * users who never reopen leave activity_tokens rows lingering.
 *
 * This cron fires every 15 minutes during NBA hours and sends an APNs `end`
 * push for any token whose slate is over (no games left for today AND >= 30min
 * since the last final), then deletes the row. Falls back to a hard 3am ET
 * day-boundary safety net: any token older than the current sport day's
 * rollover gets ended unconditionally.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { pushActivityUpdate } from "../_shared/apns.ts";
import { corsResponse } from "../_shared/cors.ts";
import { recordHeartbeat } from "../_shared/heartbeat.ts";
import { handleError, jsonResponse } from "../_shared/http.ts";
import { getSportToday } from "../../../utils/leagueTime.ts";

import type { Database } from "../../../types/database.types.ts";

const supabase = createClient<Database>(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY")!,
);

const END_AFTER_FINAL_GRACE_MS = 30 * 60 * 1000;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();

  try {
    const authHeader = req.headers.get("Authorization");
    if (authHeader !== `Bearer ${Deno.env.get("CRON_SECRET")}`) {
      return jsonResponse({ ok: false, error: "unauthorized" }, 401);
    }

    // Pull active matchup tokens; nothing to do if none.
    const { data: tokens, error: tokenErr } = await supabase
      .from("activity_tokens")
      .select("id, league_id, schedule_id, matchup_id, created_at")
      .eq("activity_type", "matchup")
      .eq("stale", false);
    if (tokenErr) throw tokenErr;
    if (!tokens || tokens.length === 0) {
      await recordHeartbeat(supabase, "end-stale-live-activities", "ok").catch(() => {});
      return jsonResponse({ ok: true, processed: 0 });
    }

    const today = getSportToday(null);
    const now = Date.now();

    // Schedule rows tell us if today's slate has more games. Pull every game
    // for today in one query and bucket by status — any non-final means we
    // still need to wait.
    const { data: todayGames } = await supabase
      .from("game_schedule")
      .select("status, game_time_utc")
      .eq("game_date", today);
    const hasUnfinishedToday = (todayGames ?? []).some((g) => g.status !== "Final");
    const lastFinalMs = (todayGames ?? [])
      .filter((g) => g.status === "Final" && g.game_time_utc)
      .map((g) => Date.parse(g.game_time_utc!))
      .filter((ms) => Number.isFinite(ms))
      .reduce((max, ms) => Math.max(max, ms), 0);

    const slateIsOver =
      !hasUnfinishedToday &&
      (lastFinalMs === 0 || now - lastFinalMs >= END_AFTER_FINAL_GRACE_MS);

    // Per-token decision. Most tokens belong to the same league/today slate
    // so the slate-level check above covers them. The day-rollover safety
    // net catches tokens whose start day is no longer today (created
    // yesterday and never cleaned up).
    const tokensToEnd: typeof tokens = [];
    for (const t of tokens) {
      const createdMs = Date.parse(t.created_at);
      const createdDay = Number.isFinite(createdMs)
        ? getSportToday(null, new Date(createdMs))
        : today;
      const crossedDayBoundary = createdDay !== today;
      if (slateIsOver || crossedDayBoundary) {
        tokensToEnd.push(t);
      }
    }

    if (tokensToEnd.length === 0) {
      await recordHeartbeat(supabase, "end-stale-live-activities", "ok").catch(() => {});
      return jsonResponse({ ok: true, processed: 0, slateIsOver, totalTokens: tokens.length });
    }

    // Group by schedule_id + league_id so we hit pushActivityUpdate's filter
    // path once per group rather than per-token. iOS receives an `end` push
    // with a dismissalDate of "now" — immediate cleanup on the lock screen.
    const groups = new Map<string, { schedule_id: string; league_id: string; ids: string[] }>();
    for (const t of tokensToEnd) {
      if (!t.schedule_id || !t.league_id) continue;
      const key = `${t.schedule_id}::${t.league_id}`;
      const g = groups.get(key) ?? { schedule_id: t.schedule_id, league_id: t.league_id, ids: [] };
      g.ids.push(t.id);
      groups.set(key, g);
    }

    let pushed = 0;
    for (const g of groups.values()) {
      await pushActivityUpdate(
        supabase,
        "matchup",
        { schedule_id: g.schedule_id, league_id: g.league_id },
        // Minimal contentState — the widget will accept whatever; iOS dismisses
        // the activity 5s after this push lands so the user never really sees
        // it. We pass empty fields rather than re-fetching the last known
        // state.
        { mode: "points", scoreGap: 0 } as Record<string, unknown>,
        { end: true, dismissalDate: Math.floor(Date.now() / 1000) + 5 },
      ).catch((err) => console.warn("pushActivityUpdate(end) failed:", err));
      pushed += g.ids.length;
    }

    // Delete the now-ended rows. Cron is idempotent — a follow-up tick on
    // the same matchup just finds nothing.
    const idsToDelete = tokensToEnd.map((t) => t.id);
    if (idsToDelete.length > 0) {
      await supabase.from("activity_tokens").delete().in("id", idsToDelete);
    }

    await recordHeartbeat(supabase, "end-stale-live-activities", "ok").catch(() => {});
    console.log(
      `end-stale-live-activities ended=${pushed} groups=${groups.size} ` +
        `total_tokens=${tokens.length} slate_over=${slateIsOver}`,
    );
    return jsonResponse({ ok: true, processed: pushed, groups: groups.size });
  } catch (err: unknown) {
    await recordHeartbeat(
      supabase,
      "end-stale-live-activities",
      "error",
      String((err as Error)?.message ?? err),
    ).catch(() => {});
    return handleError(err, "end-stale-live-activities");
  }
});
