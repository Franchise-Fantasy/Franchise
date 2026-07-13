/**
 * Down-to-the-wire scanner — finds matchups that are close enough, on the LAST
 * day of their week, to be worth a "your week is going down to the wire" push,
 * and times the push to each matchup's actual deciding games. Polled every 30
 * min by pg_cron across the game window (see the cron migration); the dedup
 * table guarantees one notification per matchup per season.
 *
 * Why poll instead of a single fixed Sunday-evening fire: different leagues —
 * and different matchups within a league — have their last games end at
 * different times. One clock-hour send arrives after some matchups are already
 * decided and hours before others. Instead we fire per matchup the moment it's
 * "down to the wire": close, and the only starter games it has left today are
 * live or about to tip (no later game still looming that could swing it).
 *
 * Gates, in order:
 *   - today == the matchup week's end_date (the games that "decide it")
 *   - matchup not finalized
 *   - close:
 *       h2h_points: |home - away| <= 30 fpts OR within 15% of the leader
 *       h2h_categories: |homeWins - awayWins| <= 1 AND (decided) >= 3
 *
 * Score sources differ by scoring type, and getting this wrong is the whole
 * ballgame: `league_matchups.home_score`/`away_score` are written ONLY by
 * finalize-week, so mid-week they are 0.00 for every live matchup. The live
 * running points total lives in `week_scores` (upserted by get-week-scores).
 * Category wins DO live on league_matchups (get-week-scores updates them live).
 *   - down to the wire: >= 1 non-final starter game today, and EVERY non-final
 *     starter game is live now or tips within DECIDING_HORIZON_MS
 *
 * Recipients: both teams in qualifying matchups (parity). Each receives a
 * deep-link notification that opens the matchup screen and lights the Go Live CTA.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsResponse } from "../_shared/cors.ts";
import { handleError, jsonResponse } from "../_shared/http.ts";
import { recordHeartbeat } from "../_shared/heartbeat.ts";
import { notifyTeams } from "../_shared/push.ts";
import { getArchivedLeagueIds } from "../_shared/archivedLeagues.ts";
import { categoriesClose, pointsClose } from "../../../utils/liveActivity/closeMatchup.ts";
import { getSportToday } from "../../../utils/leagueTime.ts";

import type { Database } from "../../../types/database.types.ts";

const supabase = createClient<Database>(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY")!,
);

// How close (ms before tipoff) a still-scheduled game must be to count as part
// of the "deciding" cluster. A matchup fires only when every game it has left
// today is either live or within this horizon — so no later game is still
// looming that could swing the result.
const DECIDING_HORIZON_MS = 90 * 60 * 1000;

interface CloseCandidate {
  matchup_id: string;
  schedule_id: string;
  league_id: string;
  league_name: string;
  home_team_id: string;
  away_team_id: string;
  home_label: number;        // points: live week score; cats: home_cat_wins
  away_label: number;
  ties: number;
  isCategories: boolean;
}

interface GameInfo {
  gameId: string;
  isFinal: boolean;
  isLive: boolean;
  tipMs: number | null;      // null = TBD/untimed game
}

function formatBody(c: CloseCandidate): string {
  if (c.isCategories) {
    const record = c.ties > 0
      ? `${c.home_label}-${c.away_label}-${c.ties}`
      : `${c.home_label}-${c.away_label}`;
    return `Your matchup is ${record} with the final games left — every category counts.`;
  }
  const gap = Math.abs(c.home_label - c.away_label);
  return `Your matchup is within ${gap.toFixed(1)} pts — the final games decide it.`;
}

/**
 * Postgres timestamptz comes back as "2026-09-25 02:00:00+00" (space separator,
 * bare "+00" offset). Normalize to strict ISO so Date.parse is reliable across
 * runtimes; returns null for TBD/untimed games (game_time_utc is null) or any
 * unparseable value.
 */
function parseTipMs(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const iso = raw.trim().replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();

  try {
    // Cron auth — Bearer CRON_SECRET. Reject if the secret itself is unset so
    // an attacker can't bypass with the literal string "Bearer undefined".
    // jsonResponse(401) (rather than throwing HttpError) matches the
    // project-wide cron convention; heartbeat is written so the watchdog
    // sees the rejection instead of false-negative success.
    const cronSecret = Deno.env.get("CRON_SECRET");
    const authHeader = req.headers.get("Authorization");
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      await recordHeartbeat(supabase, "scan-close-matchups", "error", "unauthorized").catch(() => {});
      return jsonResponse({ ok: false, error: "unauthorized" }, 401);
    }

    const today = getSportToday(null);

    // Only the LAST day of a matchup week can be "down to the wire" — those are
    // the games that decide it. Every other day (and every off-window poll)
    // early-exits here after a single cheap query.
    const { data: endingWeeks, error: weekErr } = await supabase
      .from("league_schedule")
      .select("id, league_id")
      .eq("end_date", today);
    if (weekErr) throw weekErr;
    if (!endingWeeks || endingWeeks.length === 0) {
      await recordHeartbeat(supabase, "scan-close-matchups", "ok", "no weeks ending today").catch(() => {});
      return jsonResponse({ ok: true, skipped: true, reason: "no weeks ending today" });
    }

    const leagueIds = [...new Set(endingWeeks.map((w) => w.league_id))];

    // Archived leagues bypass RLS (service role) — don't push close-matchup
    // alerts to members of a deleted league.
    const archivedLeagueIds = await getArchivedLeagueIds(supabase);

    // Per-league scoring type + name (the name goes in the push title so a
    // multi-league user knows which matchup is down to the wire)
    const { data: leagueRows } = await supabase
      .from("leagues")
      .select("id, name, scoring_type")
      .in("id", leagueIds);
    const scoringTypeByLeague = new Map<string, string>();
    const nameByLeague = new Map<string, string>();
    for (const l of leagueRows ?? []) {
      scoringTypeByLeague.set(l.id, l.scoring_type ?? "h2h_points");
      nameByLeague.set(l.id, l.name ?? "Your League");
    }

    // All matchups for these ending weeks; pull scores + cat wins inline
    const scheduleIds = endingWeeks.map((w) => w.id);
    const { data: matchups, error: matchupErr } = await supabase
      .from("league_matchups")
      .select("id, schedule_id, home_team_id, away_team_id, home_score, away_score, home_category_wins, away_category_wins, category_ties, is_finalized")
      .in("schedule_id", scheduleIds)
      .eq("is_finalized", false);
    if (matchupErr) throw matchupErr;

    // Map schedule_id → league_id
    const leagueByScheduleId = new Map<string, string>();
    for (const w of endingWeeks) leagueByScheduleId.set(w.id, w.league_id);

    // Live running point totals for the ending weeks. league_matchups.home_score
    // is still 0.00 until finalize-week writes it, so points leagues MUST read
    // here — otherwise every unfinalized matchup looks like a 0-0 tie and
    // "close" degenerates to "always true".
    const { data: weekScoreRows, error: weekScoreErr } = await supabase
      .from("week_scores")
      .select("schedule_id, team_id, score")
      .in("schedule_id", scheduleIds);
    if (weekScoreErr) throw weekScoreErr;
    const liveScores = new Map<string, number>();
    for (const r of weekScoreRows ?? []) {
      liveScores.set(`${r.schedule_id}:${r.team_id}`, Number(r.score ?? 0));
    }

    // Filter to "close" matchups per scoring type
    const candidates: CloseCandidate[] = [];
    let skippedUnscored = 0;
    for (const m of matchups ?? []) {
      if (!m.away_team_id) continue; // bye week
      const leagueId = leagueByScheduleId.get(m.schedule_id);
      if (!leagueId) continue;
      if (archivedLeagueIds.has(leagueId)) continue;
      const leagueName = nameByLeague.get(leagueId) ?? "Your League";
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
          league_name: leagueName,
          home_team_id: m.home_team_id,
          away_team_id: m.away_team_id,
          home_label: hw,
          away_label: aw,
          ties,
          isCategories: true,
        });
      } else {
        const hs = liveScores.get(`${m.schedule_id}:${m.home_team_id}`);
        const as = liveScores.get(`${m.schedule_id}:${m.away_team_id}`);
        // No week_scores row (get-week-scores hasn't run for this week yet), or
        // a scoreless 0-0 week: we can't tell a real nail-biter from an unscored
        // one, and a "within 0.0 pts" push is worse than no push. Wait for the
        // next poll.
        if (hs === undefined || as === undefined || (hs === 0 && as === 0)) {
          skippedUnscored++;
          continue;
        }
        if (!pointsClose(hs, as)) continue;
        candidates.push({
          matchup_id: m.id,
          schedule_id: m.schedule_id,
          league_id: leagueId,
          league_name: leagueName,
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
      return jsonResponse({ ok: true, qualified: 0, sent: 0, skipped_unscored: skippedUnscored });
    }

    // Down-to-the-wire inputs: each candidate matchup's starters today, mapped
    // to their pro team's game (final? live? tipoff time?). downToTheWire below
    // fires only when a matchup's last remaining games are imminent.
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

    // Map each starter to their pro_team abbreviation so we can correlate with
    // game_schedule. (`live_player_stats` would miss pre-tip starters because
    // poll-live-stats only upserts rows once games tip.)
    // Tricode keys are qualified by sport ("nba:PHX") — NBA and WNBA share
    // several city codes, so bare tricodes can match the wrong sport's game
    // when both have a slate today.
    const { data: playerRows } = await supabase
      .from("players")
      .select("id, pro_team, sport")
      .in("id", [...allStarterIds]);
    const proTeamByPlayer = new Map<string, string>();
    for (const p of playerRows ?? []) {
      if (p.pro_team) proTeamByPlayer.set(p.id, `${p.sport}:${p.pro_team}`);
    }

    // Today's slate keyed by sport-qualified pro_team. status is lowercase
    // "final"/"live"/"scheduled" (set by sync-game-schedule + poll-live-stats).
    // sport-scope: intentionally spans sports (one fetch for all leagues in
    // the run); disambiguated by the qualified keys.
    const { data: todayGames } = await supabase
      .from("game_schedule")
      .select("game_id, home_team, away_team, status, game_time_utc, sport")
      .eq("game_date", today);
    const gameByProTeam = new Map<string, GameInfo>();
    for (const g of todayGames ?? []) {
      const info: GameInfo = {
        gameId: g.game_id,
        isFinal: g.status === "final",
        isLive: g.status === "live",
        tipMs: parseTipMs(g.game_time_utc),
      };
      if (g.home_team) gameByProTeam.set(`${g.sport}:${g.home_team}`, info);
      if (g.away_team) gameByProTeam.set(`${g.sport}:${g.away_team}`, info);
    }

    const now = Date.now();

    // A matchup is "down to the wire" when the only starter games it has left
    // today are live now or about to tip — i.e. no later game is still hours
    // away to swing it. False if nothing's left to play (already decided) or a
    // later game still looms (fire on a subsequent poll, closer to the end).
    const downToTheWire = (c: CloseCandidate): boolean => {
      const games = new Map<string, GameInfo>();
      for (const teamId of [c.home_team_id, c.away_team_id]) {
        const starters = startersByTeam.get(teamId);
        if (!starters) continue;
        for (const pid of starters) {
          const pro = proTeamByPlayer.get(pid);
          const g = pro ? gameByProTeam.get(pro) : undefined;
          if (g) games.set(g.gameId, g);
        }
      }
      const remaining = [...games.values()].filter((g) => !g.isFinal);
      if (remaining.length === 0) return false;
      return remaining.every(
        (g) => g.isLive || (g.tipMs != null && g.tipMs <= now + DECIDING_HORIZON_MS),
      );
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
    let suppressedNotImminent = 0;
    for (const c of candidates) {
      if (sentSet.has(c.matchup_id)) {
        suppressedByDedup++;
        continue;
      }
      if (!downToTheWire(c)) {
        suppressedNotImminent++;
        continue;
      }

      const title = `${c.league_name} — Close matchup tonight`;
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
        `suppressed_dedup=${suppressedByDedup} suppressed_not_imminent=${suppressedNotImminent} ` +
        `skipped_unscored=${skippedUnscored}`,
    );

    return jsonResponse({
      ok: true,
      qualified: candidates.length,
      sent,
      suppressed_by_dedup: suppressedByDedup,
      suppressed_not_imminent: suppressedNotImminent,
      skipped_unscored: skippedUnscored,
    });
  } catch (err: unknown) {
    await recordHeartbeat(supabase, "scan-close-matchups", "error", String((err as Error)?.message ?? err)).catch(() => {});
    return handleError(err, "scan-close-matchups");
  }
});
