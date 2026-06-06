import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsResponse } from "../_shared/cors.ts";
import { errorResponse, handleError, jsonResponse } from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { pushActivityUpdate } from "../_shared/apns.ts";
import { resolveSlot as sharedResolveSlot, isActiveSlot } from "../_shared/resolveSlot.ts";
import { parseBody, z } from "../_shared/validate.ts";
import { getSportToday, addSlateDays } from "../../../utils/leagueTime.ts";

const Body = z.object({
  league_id: z.string().uuid().optional(),
  schedule_id: z.string().uuid().optional(),
});

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY")!,
);

// ── Scoring helpers ─────────────────────────────────────────────────────────

const STAT_TO_GAME: Record<string, string> = {
  PTS: "pts", REB: "reb", AST: "ast", STL: "stl", BLK: "blk",
  TO: "tov", "3PM": "3pm", "3PA": "3pa", FGM: "fgm", FGA: "fga",
  FTM: "ftm", FTA: "fta", PF: "pf", DD: "double_double", TD: "triple_double",
};

interface ScoringWeight {
  stat_name: string;
  point_value: number;
  is_enabled?: boolean;
  inverse?: boolean;
}

// ── Category scoring helpers ────────────────────────────────────────────────

const PERCENTAGE_STATS: Record<string, { numerator: string; denominator: string }> = {
  'FG%': { numerator: 'fgm', denominator: 'fga' },
  'FT%': { numerator: 'ftm', denominator: 'fta' },
};

function aggregateGameStats(
  gameLogs: Record<string, any>[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const game of gameLogs) {
    for (const [, gameKey] of Object.entries(STAT_TO_GAME)) {
      const raw = game[gameKey];
      if (raw == null) continue;
      const val = typeof raw === 'boolean' ? (raw ? 1 : 0) : Number(raw);
      totals[gameKey] = (totals[gameKey] ?? 0) + val;
    }
  }
  return totals;
}

function compareCategoryStats(
  homeStats: Record<string, number>,
  awayStats: Record<string, number>,
  categories: ScoringWeight[],
): { homeWins: number; awayWins: number; ties: number } {
  let homeWins = 0;
  let awayWins = 0;
  let ties = 0;

  for (const cat of categories) {
    if (!cat.is_enabled) continue;
    const pctDef = PERCENTAGE_STATS[cat.stat_name];
    let homeVal: number;
    let awayVal: number;

    if (pctDef) {
      const hNum = homeStats[pctDef.numerator] ?? 0;
      const hDen = homeStats[pctDef.denominator] ?? 0;
      const aNum = awayStats[pctDef.numerator] ?? 0;
      const aDen = awayStats[pctDef.denominator] ?? 0;
      homeVal = hDen > 0 ? Math.round((hNum / hDen) * 1000) / 1000 : 0;
      awayVal = aDen > 0 ? Math.round((aNum / aDen) * 1000) / 1000 : 0;
    } else {
      const gameKey = STAT_TO_GAME[cat.stat_name];
      if (!gameKey) continue;
      homeVal = homeStats[gameKey] ?? 0;
      awayVal = awayStats[gameKey] ?? 0;
    }

    if (homeVal === awayVal) {
      ties++;
    } else if (cat.inverse) {
      if (homeVal < awayVal) homeWins++; else awayWins++;
    } else {
      if (homeVal > awayVal) homeWins++; else awayWins++;
    }
  }

  return { homeWins, awayWins, ties };
}

function calcFpts(
  game: Record<string, number | boolean>,
  weights: ScoringWeight[],
): number {
  let total = 0;
  for (const w of weights) {
    const field = STAT_TO_GAME[w.stat_name];
    if (!field || game[field] == null) continue;
    const val = typeof game[field] === "boolean"
      ? (game[field] ? 1 : 0)
      : (game[field] as number);
    total += val * w.point_value;
  }
  return total;
}

function liveToGameLog(
  live: Record<string, number>,
): Record<string, number | boolean> {
  const cats = [live.pts, live.reb, live.ast, live.stl, live.blk].filter(
    (v) => v >= 10,
  ).length;
  return {
    pts: live.pts, reb: live.reb, ast: live.ast, stl: live.stl,
    blk: live.blk, tov: live.tov, fgm: live.fgm, fga: live.fga,
    "3pm": live["3pm"], "3pa": live["3pa"] ?? 0, ftm: live.ftm,
    fta: live.fta, pf: live.pf,
    double_double: cats >= 2,
    triple_double: cats >= 3,
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// addDays is sport-TZ-anchored via the shared helper so this cron's "today"
// matches what GMs and other crons see for the same wall-clock moment.
const addDays = (dateStr: string, days: number) => addSlateDays(dateStr, days);

// ── Score computation for a single league/week ──────────────────────────────

interface WeekScoreResult {
  teamScores: Record<string, number>;
  isCategories: boolean;
  categoryUpdates: Array<{
    matchupId: string;
    homeWins: number;
    awayWins: number;
    ties: number;
  }>;
}

async function computeWeekScores(
  leagueId: string,
  scheduleId: string,
): Promise<WeekScoreResult> {
  // Single RPC call fetches ALL data (week, scoring, matchups, rosters, lineups, games, live)
  // in one DB round trip instead of 3 sequential rounds.
  const { data: bundle, error: rpcError } = await supabase.rpc("get_week_score_data", {
    p_league_id: leagueId,
    p_schedule_id: scheduleId,
  });

  if (rpcError) throw rpcError;
  if (bundle?.error) throw new Error(bundle.error);

  const today = getSportToday(null);

  const week = bundle.week;
  const weights: ScoringWeight[] = bundle.scoring ?? [];
  const matchups = bundle.matchups ?? [];
  const scoringType: string = bundle.scoring_type ?? 'h2h_points';
  const isCategories = scoringType === 'h2h_categories';

  // Collect all unique team IDs
  const teamIds = new Set<string>();
  for (const m of matchups) {
    teamIds.add(m.home_team_id);
    if (m.away_team_id) teamIds.add(m.away_team_id);
  }
  const teamIdList = [...teamIds];

  if (teamIdList.length === 0) return { teamScores: {}, isCategories, categoryUpdates: [] };

  const leaguePlayers = bundle.rosters ?? [];
  const dailyEntries = bundle.lineups ?? [];
  const gameLogs = bundle.games ?? [];
  const liveStats = bundle.live ?? [];

  // Build lookup structures
  const teamPlayerMap = new Map<string, Set<string>>();
  const defaultSlotMap = new Map<string, string>();
  const acquiredDateMap = new Map<string, string>();

  for (const lp of leaguePlayers) {
    if (!teamPlayerMap.has(lp.team_id)) {
      teamPlayerMap.set(lp.team_id, new Set());
    }
    teamPlayerMap.get(lp.team_id)!.add(lp.player_id);
    defaultSlotMap.set(lp.player_id, lp.roster_slot ?? "BE");
    if (lp.acquired_at) {
      acquiredDateMap.set(lp.player_id, getSportToday(null, new Date(lp.acquired_at)));
    }
  }

  const dailyByTeamPlayer = new Map<
    string,
    Array<{ lineup_date: string; roster_slot: string }>
  >();
  const droppedByTeam = new Map<string, Set<string>>();

  for (const entry of dailyEntries) {
    const key = `${entry.team_id}:${entry.player_id}`;
    if (!dailyByTeamPlayer.has(key)) {
      dailyByTeamPlayer.set(key, []);
    }
    dailyByTeamPlayer.get(key)!.push(entry);

    const teamPlayers = teamPlayerMap.get(entry.team_id);
    if (
      (!teamPlayers || !teamPlayers.has(entry.player_id)) &&
      entry.lineup_date >= week.start_date &&
      entry.lineup_date <= week.end_date
    ) {
      if (!droppedByTeam.has(entry.team_id)) {
        droppedByTeam.set(entry.team_id, new Set());
      }
      droppedByTeam.get(entry.team_id)!.add(entry.player_id);
    }
  }

  // Build drop-date map for players no longer on their team
  const dropDateByTeamPlayer = new Map<string, string>();
  for (const [key, entries] of dailyByTeamPlayer) {
    const droppedEntry = entries.find((e) => e.roster_slot === "DROPPED");
    if (droppedEntry) dropDateByTeamPlayer.set(key, droppedEntry.lineup_date);
  }

  function resolveSlot(teamId: string, playerId: string, day: string): string {
    const key = `${teamId}:${playerId}`;
    const teamPlayers = teamPlayerMap.get(teamId);
    const isOnCurrentRoster = !!(teamPlayers && teamPlayers.has(playerId));
    return sharedResolveSlot({
      dailyEntries: dailyByTeamPlayer.get(key) ?? [],
      day,
      defaultSlot: defaultSlotMap.get(playerId) ?? "BE",
      isOnCurrentRoster,
      dropDate: dropDateByTeamPlayer.get(key),
      acquiredDate: acquiredDateMap.get(playerId),
      today,
    });
  }

  // 4. Compute scores from completed games
  const teamScores: Record<string, number> = {};
  const completedToday = new Set<string>();

  const allPlayersByTeam = new Map<string, Set<string>>();
  for (const tid of teamIdList) {
    const set = new Set(teamPlayerMap.get(tid) ?? []);
    const dropped = droppedByTeam.get(tid);
    if (dropped) {
      for (const pid of dropped) set.add(pid);
    }
    allPlayersByTeam.set(tid, set);
  }

  for (const game of gameLogs) {
    for (const [tid, playerSet] of allPlayersByTeam) {
      if (!playerSet.has(game.player_id)) continue;
      const slot = resolveSlot(tid, game.player_id, game.game_date);
      if (!isActiveSlot(slot)) continue;
      const fp = calcFpts(game as Record<string, number | boolean>, weights);
      teamScores[tid] = (teamScores[tid] ?? 0) + fp;
      if (game.game_date === today) completedToday.add(game.player_id);
      break;
    }
  }

  // 5. Add live stats
  for (const live of liveStats) {
    if (completedToday.has(live.player_id) && live.game_date === today) continue;
    for (const [tid, playerSet] of allPlayersByTeam) {
      if (!playerSet.has(live.player_id)) continue;
      const slot = resolveSlot(tid, live.player_id, live.game_date);
      if (!isActiveSlot(slot)) continue;
      const gameLog = liveToGameLog(live as Record<string, number>);
      const fp = calcFpts(gameLog, weights);
      teamScores[tid] = (teamScores[tid] ?? 0) + fp;
      break;
    }
  }

  // Round all scores
  for (const k of Object.keys(teamScores)) {
    teamScores[k] = round2(teamScores[k]);
  }

  // 6. For category leagues, compute per-matchup category wins from raw stats
  const categoryUpdates: WeekScoreResult['categoryUpdates'] = [];
  if (isCategories) {
    // Build per-team aggregated stats (completed games + live)
    const teamStats = new Map<string, Record<string, number>>();
    for (const tid of teamIdList) teamStats.set(tid, {});

    for (const game of gameLogs) {
      for (const [tid, playerSet] of allPlayersByTeam) {
        if (!playerSet.has(game.player_id)) continue;
        const slot = resolveSlot(tid, game.player_id, game.game_date);
        if (!isActiveSlot(slot)) continue;
        const stats = teamStats.get(tid)!;
        for (const [, gameKey] of Object.entries(STAT_TO_GAME)) {
          const raw = game[gameKey];
          if (raw == null) continue;
          const val = typeof raw === 'boolean' ? (raw ? 1 : 0) : Number(raw);
          stats[gameKey] = (stats[gameKey] ?? 0) + val;
        }
        break;
      }
    }

    for (const live of liveStats) {
      if (completedToday.has(live.player_id) && live.game_date === today) continue;
      for (const [tid, playerSet] of allPlayersByTeam) {
        if (!playerSet.has(live.player_id)) continue;
        const slot = resolveSlot(tid, live.player_id, live.game_date);
        if (!isActiveSlot(slot)) continue;
        const gameLog = liveToGameLog(live as Record<string, number>);
        const stats = teamStats.get(tid)!;
        for (const [, gameKey] of Object.entries(STAT_TO_GAME)) {
          const raw = gameLog[gameKey];
          if (raw == null) continue;
          const val = typeof raw === 'boolean' ? (raw ? 1 : 0) : Number(raw);
          stats[gameKey] = (stats[gameKey] ?? 0) + val;
        }
        break;
      }
    }

    // Compare each matchup
    for (const m of matchups) {
      if (!m.away_team_id) continue;
      const homeStats = teamStats.get(m.home_team_id) ?? {};
      const awayStats = teamStats.get(m.away_team_id) ?? {};
      const result = compareCategoryStats(homeStats, awayStats, weights);
      categoryUpdates.push({
        matchupId: m.id,
        homeWins: result.homeWins,
        awayWins: result.awayWins,
        ties: result.ties,
      });
    }
  }

  return { teamScores, isCategories, categoryUpdates };
}

// ── Upsert scores into week_scores table ────────────────────────────────────

async function upsertScores(
  leagueId: string,
  scheduleId: string,
  scores: Record<string, number>,
): Promise<void> {
  if (Object.keys(scores).length === 0) return;

  const rows = Object.entries(scores).map(([teamId, score]) => ({
    league_id: leagueId,
    schedule_id: scheduleId,
    team_id: teamId,
    score,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("week_scores")
    .upsert(rows, { onConflict: "league_id,schedule_id,team_id" });

  if (error) throw error;

  // Broadcast scores so clients get instant updates without postgres_changes overhead
  await supabase.channel(`scores:${scheduleId}`).send({
    type: "broadcast",
    event: "score_update",
    payload: { schedule_id: scheduleId, scores },
  });
}

// ── Update live category wins on league_matchups ───────────────────────────

async function upsertCategoryWins(
  updates: WeekScoreResult['categoryUpdates'],
): Promise<void> {
  if (updates.length === 0) return;

  // Batch update all matchups in parallel
  await Promise.all(
    updates.map(({ matchupId, homeWins, awayWins, ties }) =>
      supabase
        .from("league_matchups")
        .update({
          home_category_wins: homeWins,
          away_category_wins: awayWins,
          category_ties: ties,
        })
        .eq("id", matchupId)
    ),
  );
}

// ── Game activity check ─────────────────────────────────────────────────────

/** Returns true if any game (any sport) has tipped off today. Reads from
 *  game_schedule rather than BDL so a single check covers both leagues without
 *  paying for two API calls.
 *  Between midnight–3am ET, also checks yesterday for late West Coast games. */
async function hasActiveOrFinishedGames(): Promise<boolean> {
  try {
    // ET-anchored: this cron's "today" must match game_schedule.game_date,
    // which is also ET-anchored (see bdlGameSlateDate). Get the ET wall-clock
    // via Intl.DateTimeFormat — never via the new Date(toLocaleString())
    // antipattern, which has locale-parsing bugs across JS engines.
    const today = getSportToday(null);
    const etParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date());
    const hour = parseInt(etParts.find((p) => p.type === 'hour')!.value, 10);
    const datesToCheck = hour < 3 ? [today, addSlateDays(today, -1)] : [today];

    const { data } = await supabase
      .from('game_schedule')
      .select('game_id', { head: false, count: 'exact' })
      .in('game_date', datesToCheck)
      .lte('game_time_utc', new Date().toISOString())
      .limit(1);

    return (data?.length ?? 0) > 0;
  } catch {
    return true; // On error, assume games are happening
  }
}

// ── Live Activity dispatch ──────────────────────────────────────────────────

// expo-widgets pushes REPLACE the entire ContentState — every dispatch must
// send the full props the JS widget expects (see widgets/MatchupActivity.tsx).
const TRICODE_FROM_NAME = (name: string) =>
  name.trim().substring(0, 3).toUpperCase() || '???';

async function dispatchMatchupActivities(
  weekResults: Array<{ league_id: string; schedule_id: string; teamScores: Record<string, number> }>,
): Promise<void> {
  // Check if any Live Activities are registered before doing work
  const scheduleIds = weekResults.map(w => w.schedule_id);
  if (scheduleIds.length === 0) return;

  const { data: tokens } = await supabase
    .from('activity_tokens')
    .select('id, team_id, schedule_id, league_id, matchup_id')
    .eq('activity_type', 'matchup')
    .eq('stale', false)
    .in('schedule_id', scheduleIds);

  if (!tokens || tokens.length === 0) return;

  // Resolve team display info for every team referenced by any token's matchup
  const matchupIds = [...new Set(tokens.map(t => t.matchup_id).filter(Boolean))];
  const { data: matchupRows } = await supabase
    .from('league_matchups')
    .select('id, home_team_id, away_team_id')
    .in('id', matchupIds);

  const matchupById = new Map((matchupRows ?? []).map(m => [m.id, m]));

  const allTeamIds = new Set<string>();
  for (const t of tokens) {
    if (t.team_id) allTeamIds.add(t.team_id);
    const m = matchupById.get(t.matchup_id);
    if (m?.home_team_id) allTeamIds.add(m.home_team_id);
    if (m?.away_team_id) allTeamIds.add(m.away_team_id);
  }

  const { data: teamRows } = await supabase
    .from('league_teams')
    .select('id, team_name, tricode')
    .in('id', [...allTeamIds]);

  const teamInfo = new Map<string, { name: string; tricode: string }>();
  for (const t of teamRows ?? []) {
    teamInfo.set(t.id, {
      name: t.team_name ?? '',
      tricode: t.tricode?.trim() || TRICODE_FROM_NAME(t.team_name ?? ''),
    });
  }

  for (const weekResult of weekResults) {
    const weekTokens = tokens.filter(t => t.schedule_id === weekResult.schedule_id);
    if (weekTokens.length === 0) continue;

    for (const token of weekTokens) {
      const matchup = matchupById.get(token.matchup_id);
      if (!matchup) continue;

      const myTeamId = token.team_id;
      const oppTeamId = matchup.home_team_id === myTeamId
        ? matchup.away_team_id
        : matchup.home_team_id;
      if (!myTeamId || !oppTeamId) continue;

      const myScore = weekResult.teamScores[myTeamId] ?? 0;
      const oppScore = weekResult.teamScores[oppTeamId] ?? 0;

      const myMeta = teamInfo.get(myTeamId) ?? { name: '', tricode: '???' };
      const oppMeta = teamInfo.get(oppTeamId) ?? { name: '', tricode: '???' };

      const contentState = {
        myTeamName: myMeta.name,
        opponentTeamName: oppMeta.name,
        myTeamTricode: myMeta.tricode,
        opponentTeamTricode: oppMeta.tricode,
        myScore,
        opponentScore: oppScore,
        scoreGap: Math.round((myScore - oppScore) * 10) / 10,
        biggestContributor: '',
        myActivePlayers: 0,
        opponentActivePlayers: 0,
        players: [],
      };

      await pushActivityUpdate(supabase, 'matchup', {
        schedule_id: weekResult.schedule_id,
        league_id: weekResult.league_id,
      }, contentState).catch(() => {});
    }
  }
}

// ── Main handler ────────────────────────────────────────────────────────────
// Two modes:
// 1. Cron mode (no league_id in body): compute scores for ALL leagues with live weeks
// 2. Client mode (league_id + schedule_id): compute for a specific week (non-live / fallback)

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();

  try {
    // Parse body — cron sends {} or empty, client sends league_id + schedule_id
    let rawBody: unknown = {};
    try {
      rawBody = await req.json();
    } catch {
      // Empty body = cron mode
    }

    const { league_id, schedule_id } = parseBody(Body, rawBody);

    if (league_id && schedule_id) {
      // ── Client mode: verify auth + rate limit ──
      const authHeader = req.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader : `Bearer ${authHeader}`;
      const userClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SB_PUBLISHABLE_KEY')!,
        { global: { headers: { Authorization: token ?? '' } } },
      );
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) {
        return errorResponse('Unauthorized', 401);
      }

      const rateLimited = await checkRateLimit(supabase, user.id, 'get-week-scores');
      if (rateLimited) return rateLimited;

      const result = await computeWeekScores(league_id, schedule_id);
      await upsertScores(league_id, schedule_id, result.teamScores);
      if (result.isCategories) await upsertCategoryWins(result.categoryUpdates);

      return jsonResponse({ scores: result.teamScores });
    }

    // ── Cron mode: verify CRON_SECRET ──
    const cronSecret = Deno.env.get('CRON_SECRET');
    const cronAuth = req.headers.get('Authorization');
    if (!cronSecret || cronAuth !== `Bearer ${cronSecret}`) {
      return errorResponse('Unauthorized', 401);
    }

    // ── Cron mode: skip during 3–10am ET when no NBA games are running ──
    const etCronParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date());
    const hour = parseInt(etCronParts.find((p) => p.type === 'hour')!.value, 10);
    if (hour >= 3 && hour < 10) {
      return jsonResponse({ ok: true, skipped: true, reason: "off-hours (3-10am ET)" });
    }

    // ── Skip if no live fantasy weeks — cheap local-DB check, avoids the
    //    BDL call entirely during offseason and between-week gaps. ──
    const today = getSportToday(null);

    const { data: liveWeeks, error: weekErr } = await supabase
      .from("league_schedule")
      .select("id, league_id, start_date, end_date")
      .lte("start_date", today)
      .gte("end_date", today);

    if (weekErr) throw weekErr;

    if (!liveWeeks || liveWeeks.length === 0) {
      return jsonResponse({ ok: true, skipped: true, reason: "no live weeks" });
    }

    // ── Skip if no NBA games are active or recently finished ──
    const gamesActive = await hasActiveOrFinishedGames();
    if (!gamesActive) {
      return jsonResponse({ ok: true, skipped: true, reason: "no active/finished games" });
    }

    const settled = await Promise.allSettled(
      (liveWeeks ?? []).map(async (week) => {
        const result = await computeWeekScores(week.league_id, week.id);
        await upsertScores(week.league_id, week.id, result.teamScores);
        if (result.isCategories) await upsertCategoryWins(result.categoryUpdates);
        return {
          league_id: week.league_id,
          schedule_id: week.id,
          teams: Object.keys(result.teamScores).length,
          teamScores: result.teamScores,
        };
      }),
    );

    const results: Array<{ league_id: string; schedule_id: string; teams: number }> = [];
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        results.push(r.value);
      } else {
        console.error('Failed to compute scores for a league/week:', r.reason);
      }
    }

    // ── Dispatch Live Activity updates (non-blocking) ──
    // Fire-and-forget: don't let activity push failures slow down the cron
    dispatchMatchupActivities(results.map(r => ({
      league_id: r.league_id,
      schedule_id: r.schedule_id,
      teamScores: (settled.find(
        s => s.status === 'fulfilled' && s.value.league_id === r.league_id && s.value.schedule_id === r.schedule_id,
      ) as PromiseFulfilledResult<any>)?.value?.teamScores ?? {},
    }))).catch(err => console.warn('Live activity dispatch error (non-fatal):', err));

    return jsonResponse({ ok: true, processed: results.length, results });
  } catch (err: unknown) {
    return handleError(err, 'get-week-scores');
  }
});
