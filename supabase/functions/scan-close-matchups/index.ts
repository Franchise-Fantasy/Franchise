/**
 * Sunday evening scanner — finds matchups that are close enough to be worth a
 * "your week is going down to the wire" push. Fired once a week by pg_cron
 * (Sunday 23:00 UTC = 6pm ET / 3pm PT — primetime NBA window, before late games
 * tip). Dedup table guarantees one notification per matchup per season.
 *
 * Closeness rule (opinionated, see CLAUDE.md / the design conversation):
 *   - h2h_points: |home - away| <= 30 fpts OR within 15% of the leader
 *     ("one starter's night could swing it")
 *   - h2h_categories: |homeWins - awayWins| <= 1 AND (homeWins+awayWins+ties) >= 3
 *     ("tied or 1 cat apart, with enough decided to not be noise")
 * Plus: matchup must not be finalized AND at least one starter on either roster
 * has a non-final game scheduled in America/New_York for "today" (Sunday).
 *
 * Recipients: both teams in qualifying matchups (parity — both sides have skin
 * in the game). Each receives a deep-link notification that opens the matchup
 * screen and highlights the Go Live CTA.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsResponse } from "../_shared/cors.ts";
import { handleError, jsonResponse } from "../_shared/http.ts";
import { recordHeartbeat } from "../_shared/heartbeat.ts";
import { notifyTeams } from "../_shared/push.ts";
import { getSportToday } from "../../../utils/leagueTime.ts";

import type { Database } from "../../../types/database.types.ts";

const POINTS_FLAT_THRESHOLD = 30;
const POINTS_PERCENT_THRESHOLD = 0.15;
const CATEGORY_GAP_MAX = 1;
const CATEGORY_MIN_DECIDED = 3;

const supabase = createClient<Database>(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY")!,
);

interface CloseCandidate {
  matchup_id: string;
  schedule_id: string;
  league_id: string;
  home_team_id: string;
  away_team_id: string;
  home_label: number;        // points: home_score; cats: home_cat_wins
  away_label: number;
  ties: number;
  isCategories: boolean;
}

function pointsClose(home: number, away: number): boolean {
  const gap = Math.abs(home - away);
  if (gap <= POINTS_FLAT_THRESHOLD) return true;
  const leader = Math.max(home, away, 1);
  return gap / leader <= POINTS_PERCENT_THRESHOLD;
}

function categoriesClose(homeWins: number, awayWins: number, ties: number): boolean {
  const decided = homeWins + awayWins + ties;
  if (decided < CATEGORY_MIN_DECIDED) return false;
  return Math.abs(homeWins - awayWins) <= CATEGORY_GAP_MAX;
}

function formatBody(c: CloseCandidate): string {
  if (c.isCategories) {
    const record = c.ties > 0
      ? `${c.home_label}-${c.away_label}-${c.ties}`
      : `${c.home_label}-${c.away_label}`;
    return `Your matchup is ${record} heading into tonight — every category counts.`;
  }
  const gap = Math.abs(c.home_label - c.away_label);
  return `Your matchup is within ${gap.toFixed(1)} pts — Sunday slate decides it.`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();

  try {
    // Cron auth — same Bearer CRON_SECRET pattern the other crons use
    const authHeader = req.headers.get("Authorization");
    if (authHeader !== `Bearer ${Deno.env.get("CRON_SECRET")}`) {
      return jsonResponse({ ok: false, error: "unauthorized" }, 401);
    }

    const today = getSportToday(null);

    // Live weeks across all leagues for today
    const { data: liveWeeks, error: weekErr } = await supabase
      .from("league_schedule")
      .select("id, league_id, start_date, end_date")
      .lte("start_date", today)
      .gte("end_date", today);
    if (weekErr) throw weekErr;
    if (!liveWeeks || liveWeeks.length === 0) {
      await recordHeartbeat(supabase, "scan-close-matchups", "ok", "no live weeks").catch(() => {});
      return jsonResponse({ ok: true, skipped: true, reason: "no live weeks" });
    }

    const leagueIds = [...new Set(liveWeeks.map((w) => w.league_id))];

    // Per-league scoring type
    const { data: leagueRows } = await supabase
      .from("leagues")
      .select("id, scoring_type")
      .in("id", leagueIds);
    const scoringTypeByLeague = new Map<string, string>();
    for (const l of leagueRows ?? []) {
      scoringTypeByLeague.set(l.id, l.scoring_type ?? "h2h_points");
    }

    // All matchups for these live weeks; pull scores + cat wins inline
    const scheduleIds = liveWeeks.map((w) => w.id);
    const { data: matchups, error: matchupErr } = await supabase
      .from("league_matchups")
      .select("id, schedule_id, home_team_id, away_team_id, home_score, away_score, home_category_wins, away_category_wins, category_ties, is_finalized")
      .in("schedule_id", scheduleIds)
      .eq("is_finalized", false);
    if (matchupErr) throw matchupErr;

    // Map schedule_id → league_id
    const leagueByScheduleId = new Map<string, string>();
    for (const w of liveWeeks) leagueByScheduleId.set(w.id, w.league_id);

    // Filter to "close" matchups per scoring type
    const candidates: CloseCandidate[] = [];
    for (const m of matchups ?? []) {
      if (!m.away_team_id) continue; // bye week
      const leagueId = leagueByScheduleId.get(m.schedule_id);
      if (!leagueId) continue;
      const isCats = scoringTypeByLeague.get(leagueId) === "h2h_categories";
      if (isCats) {
        const hw = m.home_category_wins ?? 0;
        const aw = m.away_category_wins ?? 0;
        const ties = m.category_ties ?? 0;
        if (!categoriesClose(hw, aw, ties)) continue;
        candidates.push({
          matchup_id: m.id,
          schedule_id: m.schedule_id,
          league_id: leagueId,
          home_team_id: m.home_team_id,
          away_team_id: m.away_team_id,
          home_label: hw,
          away_label: aw,
          ties,
          isCategories: true,
        });
      } else {
        const hs = Number(m.home_score ?? 0);
        const as = Number(m.away_score ?? 0);
        if (!pointsClose(hs, as)) continue;
        candidates.push({
          matchup_id: m.id,
          schedule_id: m.schedule_id,
          league_id: leagueId,
          home_team_id: m.home_team_id,
          away_team_id: m.away_team_id,
          home_label: hs,
          away_label: as,
          ties: 0,
          isCategories: false,
        });
      }
    }

    if (candidates.length === 0) {
      await recordHeartbeat(supabase, "scan-close-matchups", "ok").catch(() => {});
      return jsonResponse({ ok: true, qualified: 0, sent: 0 });
    }

    // Tonight's-game check: skip matchups where NEITHER roster has a starter
    // with a non-final game today. Avoids nudging on a slow Sunday where
    // there's nothing the user can do about the close score.
    const teamIds = new Set<string>();
    for (const c of candidates) {
      teamIds.add(c.home_team_id);
      teamIds.add(c.away_team_id);
    }
    const { data: lineups } = await supabase
      .from("daily_lineups")
      .select("team_id, player_id, roster_slot")
      .in("team_id", [...teamIds])
      .eq("lineup_date", today)
      .not("roster_slot", "in", '("BE","IR","TAXI","DROPPED")');
    const startersByTeam = new Map<string, Set<string>>();
    for (const l of lineups ?? []) {
      const set = startersByTeam.get(l.team_id) ?? new Set<string>();
      set.add(l.player_id);
      startersByTeam.set(l.team_id, set);
    }
    const allStarterIds = new Set<string>();
    for (const set of startersByTeam.values()) for (const pid of set) allStarterIds.add(pid);

    // Game schedule for today; status != 'Final'
    const { data: liveStats } = await supabase
      .from("live_player_stats")
      .select("player_id, game_status")
      .eq("game_date", today)
      .in("player_id", [...allStarterIds]);
    const activePlayerIds = new Set<string>();
    for (const ls of liveStats ?? []) {
      if (ls.game_status !== 3) activePlayerIds.add(ls.player_id);
    }

    const hasTonightStarter = (teamId: string): boolean => {
      const starters = startersByTeam.get(teamId);
      if (!starters || starters.size === 0) return false;
      for (const pid of starters) if (activePlayerIds.has(pid)) return true;
      return false;
    };

    // Filter out already-notified matchups via the dedup table
    const candidateIds = candidates.map((c) => c.matchup_id);
    const { data: alreadySent } = await supabase
      .from("close_matchup_notifications_sent")
      .select("matchup_id")
      .in("matchup_id", candidateIds);
    const sentSet = new Set((alreadySent ?? []).map((r) => r.matchup_id));

    let sent = 0;
    let suppressedByDedup = 0;
    let suppressedByNoGames = 0;
    for (const c of candidates) {
      if (sentSet.has(c.matchup_id)) {
        suppressedByDedup++;
        continue;
      }
      if (!hasTonightStarter(c.home_team_id) && !hasTonightStarter(c.away_team_id)) {
        suppressedByNoGames++;
        continue;
      }

      const title = "Close matchup tonight";
      const body = formatBody(c);
      const data = {
        screen: "matchup",
        matchupId: c.matchup_id,
        league_id: c.league_id,
        prompt_live_activity: "true",
      };

      await notifyTeams(
        supabase,
        [c.home_team_id, c.away_team_id],
        "matchup_closeup",
        title,
        body,
        data,
      ).catch((err) => console.warn("notifyTeams failed (non-fatal):", err));

      const { error: dedupErr } = await supabase
        .from("close_matchup_notifications_sent")
        .insert({
          matchup_id: c.matchup_id,
          schedule_id: c.schedule_id,
          league_id: c.league_id,
        });
      if (dedupErr && dedupErr.code !== "23505") {
        console.warn("Dedup insert failed:", dedupErr);
      }
      sent++;
    }

    await recordHeartbeat(supabase, "scan-close-matchups", "ok").catch(() => {});
    console.log(
      `scan-close-matchups qualified=${candidates.length} sent=${sent} ` +
        `suppressed_dedup=${suppressedByDedup} suppressed_no_games=${suppressedByNoGames}`,
    );

    return jsonResponse({
      ok: true,
      qualified: candidates.length,
      sent,
      suppressed_by_dedup: suppressedByDedup,
      suppressed_by_no_games: suppressedByNoGames,
    });
  } catch (err: unknown) {
    await recordHeartbeat(supabase, "scan-close-matchups", "error", String((err as Error)?.message ?? err)).catch(() => {});
    return handleError(err, "scan-close-matchups");
  }
});
