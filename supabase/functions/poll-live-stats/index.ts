import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { bdlFetch, bdlGameSlateDate, mapGameStatus, toIsoDuration, type Sport } from "../_shared/bdl.ts";
import { pushActivityUpdate } from "../_shared/apns.ts";
import { createLogger } from "../_shared/log.ts";
import { recordHeartbeat } from "../_shared/heartbeat.ts";

const log = createLogger("poll-live-stats");

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY")!,
);

function computeDoubles(
  s: { pts: number; reb: number; ast: number; stl: number; blk: number },
): { double_double: boolean; triple_double: boolean } {
  const cats = [
    s.pts >= 10, s.reb >= 10, s.ast >= 10, s.stl >= 10, s.blk >= 10,
  ].filter(Boolean).length;
  return { double_double: cats >= 2, triple_double: cats >= 3 };
}

interface StatSnapshot {
  pts: number; reb: number; ast: number;
  stl: number; blk: number; tov: number;
  fgm: number; ftm: number; fg3m: number;
  fga: number; fta: number; fg3a: number; pf: number;
}

interface DerivedEvent {
  kind:
    | 'MADE_3PT' | 'MADE_2PT' | 'MADE_FT'
    | 'MISSED_3PT' | 'MISSED_2PT' | 'MISSED_FT'
    | 'AST' | 'REB' | 'STL' | 'BLK' | 'TOV' | 'PF'
    | 'DD' | 'TD';
  value: number;
}

/** Count box-score categories at >=10 (the threshold that defines a DD/TD). */
function countCats(s: { pts: number; reb: number; ast: number; stl: number; blk: number }): number {
  return [s.pts >= 10, s.reb >= 10, s.ast >= 10, s.stl >= 10, s.blk >= 10].filter(Boolean).length;
}

/**
 * Diff two stat snapshots and return the discrete plays that occurred
 * between them. Each kind carries a `value` count (e.g. MADE_3PT value=2
 * means two 3-pointers between the polls). Negative deltas (BDL stat
 * corrections) are silently ignored so we don't spam an "unmade" event
 * tape.
 *
 * Every category that can move fantasy points emits an event: makes AND
 * misses (since FGA/FTA carry penalties in most leagues), rebounds, and
 * fouls. Display layer uses league-specific weights to compute the
 * fantasy-points delta — events with weight 0 still render as `0.0`,
 * intentionally so users can see that the stat happened.
 *
 * DD/TD fire only on threshold-cross, not every poll while the player is
 * already at the threshold.
 */
function deriveEvents(prev: StatSnapshot, curr: StatSnapshot): DerivedEvent[] {
  const events: DerivedEvent[] = [];

  const fg3mDelta = Math.max(0, curr.fg3m - prev.fg3m);
  if (fg3mDelta > 0) events.push({ kind: 'MADE_3PT', value: fg3mDelta });

  // 2-pt makes = total FGM growth minus 3-pt makes captured above
  const fgmDelta = Math.max(0, curr.fgm - prev.fgm);
  const twoPtMadeDelta = Math.max(0, fgmDelta - fg3mDelta);
  if (twoPtMadeDelta > 0) events.push({ kind: 'MADE_2PT', value: twoPtMadeDelta });

  // Missed 3PT = 3PA growth minus 3PM growth
  const fg3aDelta = Math.max(0, curr.fg3a - prev.fg3a);
  const missed3PtDelta = Math.max(0, fg3aDelta - fg3mDelta);
  if (missed3PtDelta > 0) events.push({ kind: 'MISSED_3PT', value: missed3PtDelta });

  // Missed 2PT = (FGA - 3PA) growth minus 2PT-make growth
  const fgaDelta = Math.max(0, curr.fga - prev.fga);
  const twoPtAttDelta = Math.max(0, fgaDelta - fg3aDelta);
  const missed2PtDelta = Math.max(0, twoPtAttDelta - twoPtMadeDelta);
  if (missed2PtDelta > 0) events.push({ kind: 'MISSED_2PT', value: missed2PtDelta });

  const ftmDelta = Math.max(0, curr.ftm - prev.ftm);
  if (ftmDelta > 0) events.push({ kind: 'MADE_FT', value: ftmDelta });

  const ftaDelta = Math.max(0, curr.fta - prev.fta);
  const missedFtDelta = Math.max(0, ftaDelta - ftmDelta);
  if (missedFtDelta > 0) events.push({ kind: 'MISSED_FT', value: missedFtDelta });

  const rebDelta = Math.max(0, curr.reb - prev.reb);
  if (rebDelta > 0) events.push({ kind: 'REB', value: rebDelta });

  const astDelta = Math.max(0, curr.ast - prev.ast);
  if (astDelta > 0) events.push({ kind: 'AST', value: astDelta });

  const stlDelta = Math.max(0, curr.stl - prev.stl);
  if (stlDelta > 0) events.push({ kind: 'STL', value: stlDelta });

  const blkDelta = Math.max(0, curr.blk - prev.blk);
  if (blkDelta > 0) events.push({ kind: 'BLK', value: blkDelta });

  const tovDelta = Math.max(0, curr.tov - prev.tov);
  if (tovDelta > 0) events.push({ kind: 'TOV', value: tovDelta });

  const pfDelta = Math.max(0, curr.pf - prev.pf);
  if (pfDelta > 0) events.push({ kind: 'PF', value: pfDelta });

  const prevCats = countCats(prev);
  const currCats = countCats(curr);
  if (prevCats < 2 && currCats >= 2) events.push({ kind: 'DD', value: 0 });
  if (prevCats < 3 && currCats >= 3) events.push({ kind: 'TD', value: 0 });

  return events;
}

/** Parse BDL min string (e.g. "23:45", "34") to integer minutes. */
function parseMinutes(min: string | null): number {
  if (!min) return 0;
  const parts = min.split(":");
  return parseInt(parts[0], 10) || 0;
}

// ── Live Activity dispatch: push player stat lines to active activities ──

async function dispatchPlayerTickerUpdates(
  liveRows: any[],
): Promise<void> {
  if (liveRows.length === 0) return;

  // Check for any active matchup Live Activities
  const { data: tokens } = await supabase
    .from('activity_tokens')
    .select('id, team_id, schedule_id, league_id, matchup_id')
    .eq('activity_type', 'matchup')
    .eq('stale', false);

  if (!tokens || tokens.length === 0) return;

  // Build a lookup: player_id → live stat row
  const liveByPlayer = new Map<string, any>(
    liveRows.map(r => [r.player_id, r]),
  );

  // Get unique team IDs from active tokens
  const teamIds = [...new Set(tokens.map(t => t.team_id))];

  // Fetch rostered players for those teams
  const { data: rosterPlayers } = await supabase
    .from('league_players')
    .select('player_id, team_id, roster_slot, players!inner(name)')
    .in('team_id', teamIds)
    .not('roster_slot', 'in', '("BE","IR","TAXI")');

  if (!rosterPlayers || rosterPlayers.length === 0) return;

  // Group roster by team
  const rosterByTeam = new Map<string, any[]>();
  for (const rp of rosterPlayers) {
    const list = rosterByTeam.get(rp.team_id) ?? [];
    list.push(rp);
    rosterByTeam.set(rp.team_id, list);
  }

  // Also need scoring weights per league to compute FPTS
  const leagueIds = [...new Set(tokens.map(t => t.league_id))];
  const { data: scoringRows } = await supabase
    .from('scoring_weights')
    .select('league_id, stat_name, point_value, is_enabled')
    .in('league_id', leagueIds);

  const scoringByLeague = new Map<string, any[]>();
  for (const sw of scoringRows ?? []) {
    const list = scoringByLeague.get(sw.league_id) ?? [];
    list.push(sw);
    scoringByLeague.set(sw.league_id, list);
  }

  // Build all the contentState payloads first, then push in parallel
  const pushTasks: Array<Promise<unknown>> = [];

  for (const token of tokens) {
    const roster = rosterByTeam.get(token.team_id) ?? [];
    const weights = scoringByLeague.get(token.league_id) ?? [];

    const playerLines: any[] = [];
    for (const rp of roster) {
      const live = liveByPlayer.get(rp.player_id);
      if (!live || live.game_status < 2) continue;

      const player = (rp as any).players;
      const fullName = (player?.name ?? '').trim();
      const parts = fullName.split(/\s+/);
      const name = parts.length >= 2
        ? `${parts[0].charAt(0)}. ${parts.slice(1).join(' ')}`
        : fullName;

      let fpts = 0;
      for (const w of weights) {
        if (!w.is_enabled) continue;
        const gameKey = STAT_TO_GAME[w.stat_name];
        if (!gameKey) continue;
        const val = live[gameKey] ?? 0;
        fpts += val * w.point_value;
      }

      playerLines.push({
        name,
        statLine: `${live.pts}p ${live.reb}r ${live.ast}a`,
        fantasyPoints: Math.round(fpts * 10) / 10,
        gameStatus: live.game_status === 3
          ? 'Final'
          : live.game_clock
            ? `${ordinal(live.period)} ${formatClock(live.game_clock)}`
            : `${ordinal(live.period)}`,
        isOnCourt: live.oncourt ?? false,
      });
    }

    playerLines.sort((a, b) => b.fantasyPoints - a.fantasyPoints);
    const top5 = playerLines.slice(0, 5);

    const biggest = top5[0];
    const biggestContributor = biggest
      ? `${biggest.name} ${biggest.statLine}`
      : '';

    if (top5.length === 0) continue;

    const contentState = {
      myScore: 0,
      opponentScore: 0,
      scoreGap: 0,
      biggestContributor,
      myActivePlayers: playerLines.filter(p => p.gameStatus !== 'Final').length,
      opponentActivePlayers: 0,
      players: top5,
    };

    pushTasks.push(
      pushActivityUpdate(supabase, 'matchup', {
        schedule_id: token.schedule_id,
        league_id: token.league_id,
      }, contentState).catch(() => {}),
    );
  }

  // Push all tokens in parallel — APNs is per-token so concurrency is fine
  await Promise.all(pushTasks);
}

// Stat key mapping (matches get-week-scores)
const STAT_TO_GAME: Record<string, string> = {
  PTS: "pts", REB: "reb", AST: "ast", STL: "stl", BLK: "blk",
  TO: "tov", "3PM": "3pm", "3PA": "3pa", FGM: "fgm", FGA: "fga",
  FTM: "ftm", FTA: "fta", PF: "pf",
};

function ordinal(period: number): string {
  if (period === 1) return '1st';
  if (period === 2) return '2nd';
  if (period === 3) return '3rd';
  if (period === 4) return '4th';
  return `OT${period - 4}`;
}

function formatClock(isoDuration: string): string {
  // Parse ISO duration like PT5M23S → "5:23"
  const match = isoDuration.match(/PT(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/);
  if (!match) return isoDuration;
  const min = match[1] ?? '0';
  const sec = Math.floor(parseFloat(match[2] ?? '0'));
  return `${min}:${String(sec).padStart(2, '0')}`;
}

Deno.serve(async (req: Request) => {
  // Verify cron secret
  const cronSecret = Deno.env.get('CRON_SECRET');
  const authHeader = req.headers.get('Authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Sport from request body. Defaults to 'nba' so legacy cron entries keep working.
  // Optional `gameIds` override lets a recovery call replay specific games (e.g.
  // games whose Final transition was missed because of a status mapping gap).
  let sport: Sport = 'nba';
  let overrideGameIds: number[] | null = null;
  try {
    const body = await req.json();
    if (body?.sport === 'wnba') sport = 'wnba';
    if (Array.isArray(body?.gameIds) && body.gameIds.length > 0) {
      overrideGameIds = body.gameIds.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n));
    }
  } catch {
    // No body / not JSON — default sport stays 'nba'.
  }

  try {
    const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const hour = nowET.getHours();
    // Skip during 5–10am ET when no NBA or WNBA games are running.
    // West Coast tipoffs (10pm PT = 1am ET) can run with OT past 4am ET, so
    // the off-hours window starts at 5am ET to keep polling those games.
    // Recovery calls (overrideGameIds) bypass the off-hours skip.
    if (!overrideGameIds && hour >= 5 && hour < 10) {
      await recordHeartbeat(supabase, `poll-live-stats:${sport}`, 'ok');
      return new Response(
        JSON.stringify({ ok: true, sport, skipped: true, reason: "off-hours (5-10am ET)" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Use ET date since both leagues' games are scheduled in Eastern time.
    // Between midnight–5am ET, also check yesterday since West Coast games
    // (10pm PT tip) can run past midnight ET. From late afternoon onward,
    // also check tomorrow's UTC date — 8pm+ ET tipoffs are filed by BDL
    // under the next UTC day (8pm ET = 00:00 UTC tomorrow), so without this
    // those late games are invisible to the poll until the next morning,
    // by which point they're already FINAL and we've missed the live diff
    // window — leaving live_scoring_events empty for the whole game.
    const gameDate = nowET.toISOString().slice(0, 10);
    const yesterdayET = new Date(nowET.getTime() - 86_400_000).toISOString().slice(0, 10);
    const tomorrowET = new Date(nowET.getTime() + 86_400_000).toISOString().slice(0, 10);
    const datesToCheck = hour < 5
      ? [gameDate, yesterdayET]
      : hour >= 17
        ? [gameDate, tomorrowET]
        : [gameDate];

    // Off-day skip: if game_schedule has no rows for this sport on any of
    // datesToCheck, there's nothing for BDL to return — bail before paying
    // for the /games + /stats round-trips. Recovery calls bypass since they
    // explicitly target specific historical game IDs.
    if (!overrideGameIds) {
      const { count: scheduledCount, error: scheduleErr } = await supabase
        .from("game_schedule")
        .select("id", { count: "exact", head: true })
        .eq("sport", sport)
        .in("game_date", datesToCheck);
      if (scheduleErr) {
        log.warn("game_schedule precheck error", { error: scheduleErr.message });
      } else if ((scheduledCount ?? 0) === 0) {
        await recordHeartbeat(supabase, `poll-live-stats:${sport}`, 'ok');
        return new Response(
          JSON.stringify({ ok: true, sport, skipped: true, reason: "no games on schedule", dates: datesToCheck }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
    }

    // Recovery path widens the lookback window so games from up to a week ago
    // can be replayed. /games doesn't support game_ids[], so we fetch by date
    // and filter to the override IDs locally.
    const gamesDateRange = overrideGameIds
      ? Array.from({ length: 8 }, (_, i) =>
          new Date(nowET.getTime() - i * 86_400_000).toISOString().slice(0, 10))
      : datesToCheck;

    const gamesResults = await Promise.all(
      gamesDateRange.map(d => bdlFetch(sport, "/games", { "dates[]": d })),
    );
    let allGames: any[] = gamesResults.flatMap((r: any) => r?.data ?? []);
    if (overrideGameIds) {
      const wanted = new Set(overrideGameIds);
      allGames = allGames.filter((g: any) => wanted.has(g.id));
    }

    // Recovery path treats whatever BDL returns as "active" so post-status
    // games still flow through the upsert + player_games write.
    const activeGames = overrideGameIds ? allGames : allGames.filter((g: any) => {
      // Playoff games flow into live_player_stats for the live UI, but are
      // excluded from the player_games write below so season totals stay clean.
      const s = mapGameStatus(g.status ?? "");
      return s === 2 || s === 3;
    });

    if (activeGames.length === 0) {
      await recordHeartbeat(supabase, `poll-live-stats:${sport}`, 'ok');
      return new Response(
        JSON.stringify({ ok: true, games: 0, allGames: allGames.length }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Build game lookup: gameId → game metadata
    const gameMap = new Map<number, any>();
    for (const g of activeGames) gameMap.set(g.id, g);

    // Step 2: fetch /stats scoped to the active game IDs. WNBA's /player_stats
    // returns no rows when scoped by `dates[]` for in-progress games — only
    // `game_ids[]` works. NBA accepts both, so unifying on game_ids[] keeps
    // both sports on one path and avoids paying for stats from games we don't
    // care about.
    const gameIdParams = [...gameMap.keys()].map(String);
    const allStats: any[] = [];
    let cursor: string | undefined;
    do {
      const params: Record<string, string | string[]> = {
        "game_ids[]": gameIdParams,
        per_page: "100",
      };
      if (cursor) params.cursor = cursor;
      const page = await bdlFetch(sport, "/stats", params);
      allStats.push(...(page?.data ?? []));
      cursor = page?.meta?.next_cursor ? String(page.meta.next_cursor) : undefined;
    } while (cursor);

    const activeStats = allStats;

    if (activeStats.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, games: activeGames.length, players: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Collect BDL player IDs
    const allBdlIds = new Set<number>();
    for (const s of activeStats) {
      if (s.player?.id) allBdlIds.add(s.player.id);
    }

    // Look up internal player IDs by external_id_bdl, scoped to this sport
    // (BDL uses separate ID namespaces per sport — same numeric ID can mean
    // a different player in NBA vs WNBA). `name` is denormalized onto the
    // live_scoring_events row so the ticker doesn't need a separate join.
    const { data: playerRows, error: playerErr } = await supabase
      .from("players")
      .select("id, external_id_bdl, name")
      .eq("sport", sport)
      .in("external_id_bdl", [...allBdlIds]);

    if (playerErr) {
      log.error("Player lookup error", playerErr);
      return new Response(JSON.stringify({ error: playerErr.message }), { status: 500 });
    }

    const bdlIdToPlayerId = new Map<number, string>(
      (playerRows ?? []).map((p: any) => [Number(p.external_id_bdl), p.id]),
    );
    const playerIdToName = new Map<string, string>(
      (playerRows ?? []).map((p: any) => [p.id, p.name || "Unknown"]),
    );

    const missingBdlIds = [...allBdlIds].filter(id => !bdlIdToPlayerId.has(id));
    if (missingBdlIds.length > 0) {
      log.warn("Players not in DB", { missing_bdl_ids: missingBdlIds });
    }

    // Fetch previous snapshot for oncourt derivation AND scoring-event diffs.
    // Without a previous row, we can't tell whether a stat moved between polls,
    // so the first poll for a player today is silent on event emission.
    const { data: existingLive, error: existingLiveErr } = await supabase
      .from("live_player_stats")
      .select(
        'player_id, game_id, game_date, game_status, min, pts, reb, ast, stl, blk, tov, fgm, ftm, "3pm", fga, fta, "3pa", pf',
      )
      .in("player_id", [...bdlIdToPlayerId.values()])
      .in("game_date", datesToCheck);
    if (existingLiveErr) {
      log.error("existingLive query error", existingLiveErr);
    }

    // Track the max prior status seen for each game_id. Used below to detect
    // games that flip from <3 (scheduled/live) → 3 (final) during this poll —
    // those transitions are the only signal we have that today's `player_games`
    // rows just gained new finalized stat lines, which is when the
    // `player_season_stats` matview needs a refresh so user-facing averages
    // pick up the new game. Without this gate the matview would only refresh
    // once a day via sync-players-{sport}, leaving overnight games stale for
    // up to ~24 hours.
    const prevGameStatusByGameId = new Map<string, number>();
    for (const r of existingLive ?? []) {
      const gid = String((r as any).game_id ?? "");
      if (!gid) continue;
      const status = Number((r as any).game_status ?? 0);
      const prior = prevGameStatusByGameId.get(gid) ?? 0;
      if (status > prior) prevGameStatusByGameId.set(gid, status);
    }
    const prevSnapshotMap = new Map<string, StatSnapshot>(
      (existingLive ?? []).map((r: any) => [
        `${r.player_id}:${r.game_date}`,
        {
          pts: r.pts ?? 0,
          reb: r.reb ?? 0,
          ast: r.ast ?? 0,
          stl: r.stl ?? 0,
          blk: r.blk ?? 0,
          tov: r.tov ?? 0,
          fgm: r.fgm ?? 0,
          ftm: r.ftm ?? 0,
          fg3m: r["3pm"] ?? 0,
          fga: r.fga ?? 0,
          fta: r.fta ?? 0,
          fg3a: r["3pa"] ?? 0,
          pf: r.pf ?? 0,
        },
      ]),
    );
    // Separate map of prior minutes — used only for the on-court derivation,
    // not for scoring-event diffing. Postgres `numeric` returns as a string
    // through the JS client, so coerce explicitly.
    const prevMinMap = new Map<string, number>(
      (existingLive ?? []).map((r: any) => [
        `${r.player_id}:${r.game_date}`,
        Number(r.min ?? 0),
      ]),
    );

    const allLiveRows: any[] = [];
    const allGameRows: any[] = [];
    const allTeamUpdates: any[] = [];
    const allEventRows: any[] = [];
    // game_ids that crossed into Final during this poll. Populated when we
    // push to allGameRows; consumed after the upsert to trigger a matview
    // refresh exactly once per status-3 transition (not on every poll while
    // the game is still in the BDL response window).
    const newlyFinalGameIds = new Set<string>();

    for (const stat of activeStats) {
      const playerId = bdlIdToPlayerId.get(stat.player?.id);
      if (!playerId) continue;

      const game = gameMap.get(stat.game?.id);
      if (!game) continue;

      const gameStatus = mapGameStatus(game.status ?? "");
      const period = game.period ?? 0;
      const gameClock = toIsoDuration(game.time ?? "");
      const gameId = String(game.id);
      // Anchor game_date on ET, not UTC. BDL exposes `game.date` as a UTC
      // timestamp ("2026-05-09T05:00:00Z" for a 10pm PT tipoff), so a UTC
      // slice would file the game under the next calendar day even though
      // the slate is "last night's" ET schedule.
      const actualGameDate = bdlGameSlateDate(game.date) ?? gameDate;

      // Determine home/away from the stat's team vs game's home team
      const statTeamId = stat.team?.id;
      const isHome = statTeamId === game.home_team?.id;
      const ownTricode = stat.team?.abbreviation ?? "";
      const oppTricode = isHome ? game.visitor_team?.abbreviation ?? "" : game.home_team?.abbreviation ?? "";
      const matchup = isHome ? `vs ${oppTricode}` : `@${oppTricode}`;
      // BDL uses different score field names per sport: NBA exposes
      // `home_team_score`/`visitor_team_score`, WNBA uses `home_score`/`away_score`.
      const homeScore = game.home_score ?? game.home_team_score ?? 0;
      const awayScore = game.away_score ?? game.visitor_team_score ?? 0;

      const pts = stat.pts ?? 0;
      const reb = stat.reb ?? 0;
      const ast = stat.ast ?? 0;
      const blk = stat.blk ?? 0;
      const stl = stat.stl ?? 0;
      const tov = stat.turnover ?? 0;
      const fgm = stat.fgm ?? 0;
      const fga = stat.fga ?? 0;
      const fg3m = stat.fg3m ?? 0;
      const fg3a = stat.fg3a ?? 0;
      const ftm = stat.ftm ?? 0;
      const fta = stat.fta ?? 0;
      const pf = stat.pf ?? 0;
      const currentMin = parseMinutes(stat.min ?? "0");

      // Derive oncourt: live game AND minutes ticked up since the previous
      // poll. Falls back to `currentMin > 0` on the first poll of the game,
      // when we have no prior snapshot to diff against — best-guess until
      // the second poll lands and we can measure a real delta.
      const prevMinKey = `${playerId}:${actualGameDate}`;
      const prevMin = prevMinMap.get(prevMinKey);
      const oncourt = gameStatus === 2 && (
        prevMin === undefined ? currentMin > 0 : currentMin > prevMin
      );

      allLiveRows.push({
        player_id: playerId,
        game_id: gameId,
        game_date: actualGameDate,
        sport,
        game_status: gameStatus,
        period,
        game_clock: gameClock,
        matchup,
        home_score: homeScore,
        away_score: awayScore,
        oncourt,
        min: currentMin,
        pts, reb, ast, blk, stl, tov, fgm, fga,
        "3pm": fg3m, "3pa": fg3a, ftm, fta, pf,
        updated_at: new Date().toISOString(),
      });

      // ── Scoring-event derivation ──────────────────────────────────────
      // Only diff against a real previous snapshot — first poll has no prev,
      // so we stay silent rather than emit phantom events for stats that
      // accumulated before we started watching.
      const prev = prevSnapshotMap.get(`${playerId}:${actualGameDate}`);
      if (prev && gameStatus === 2) {
        const playerName = playerIdToName.get(playerId) ?? "Unknown";
        const eventBase = {
          player_id: playerId,
          player_name: playerName,
          game_id: gameId,
          sport,
          period,
          game_clock: gameClock,
        };
        const events = deriveEvents(prev, {
          pts, reb, ast, stl, blk, tov, fgm, ftm, fg3m,
          fga, fta, fg3a, pf,
        });
        for (const e of events) allEventRows.push({ ...eventBase, ...e });
      }

      allTeamUpdates.push({ id: playerId, pro_team: ownTricode });

      if (gameStatus === 3 && !game.postseason) {
        const { double_double, triple_double } = computeDoubles({ pts, reb, ast, stl, blk });
        allGameRows.push({
          player_id: playerId,
          game_id: gameId,
          game_date: actualGameDate,
          sport,
          matchup,
          min: currentMin,
          pts, reb, ast, blk, stl, tov, fgm, fga,
          "3pm": fg3m, "3pa": fg3a, ftm, fta, pf,
          double_double,
          triple_double,
        });
        // Detect the scheduled/live → final transition for this game. Recovery
        // calls (overrideGameIds) have no prior live snapshot, so treat them as
        // transitions too — that's the recovery path's job: backfill missed
        // refreshes. Without this, an overnight final would only land in the
        // matview at the next daily sync-players run.
        const prior = prevGameStatusByGameId.get(gameId) ?? 0;
        if (prior < 3) newlyFinalGameIds.add(gameId);
      }
    }

    let totalLiveRows = 0;
    let totalGameRows = 0;

    const upsertPromises: PromiseLike<void>[] = [];

    if (allLiveRows.length > 0) {
      upsertPromises.push(
        supabase
          .from("live_player_stats")
          .upsert(allLiveRows, { onConflict: "player_id,game_date" })
          .then(({ error }) => {
            if (error) log.error("live_player_stats batch upsert error", error);
            else totalLiveRows = allLiveRows.length;
          }),
      );
    }

    if (allGameRows.length > 0) {
      upsertPromises.push(
        supabase
          .from("player_games")
          .upsert(allGameRows, { onConflict: "player_id,game_id", ignoreDuplicates: false })
          .then(({ error }) => {
            if (error) log.error("player_games batch upsert error", error);
            else totalGameRows = allGameRows.length;
          }),
      );
    }

    // Insert scoring events. Non-blocking on failure — the live snapshot is
    // the source of truth for scoring; the event tape is a UX nice-to-have.
    if (allEventRows.length > 0) {
      upsertPromises.push(
        supabase
          .from("live_scoring_events")
          .insert(allEventRows)
          .then(({ error }) => {
            if (error) log.error("live_scoring_events insert error", error);
          }),
      );
    }

    // Mirror BDL status + score onto game_schedule so the matchup view (and
    // anything else keying off the schedule row) reflects live games. Only
    // touches `status` for live/final transitions — leaves it alone otherwise
    // so a stale recovery call can't downgrade a row back to 'scheduled'.
    upsertPromises.push(
      Promise.all(
        activeGames.map(async (game: any) => {
          const gs = mapGameStatus(game.status ?? "");
          const updates: Record<string, unknown> = {
            home_score: game.home_score ?? game.home_team_score ?? 0,
            away_score: game.away_score ?? game.visitor_team_score ?? 0,
          };
          if (gs === 3) updates.status = "final";
          else if (gs === 2) updates.status = "live";
          const { error } = await supabase
            .from("game_schedule")
            .update(updates)
            .eq("sport", sport)
            .eq("game_id", String(game.id));
          if (error) log.warn("game_schedule update error", { gameId: game.id, error: error.message });
        }),
      ).then(() => {}),
    );

    await Promise.all(upsertPromises);

    if (allTeamUpdates.length > 0) {
      const { error } = await supabase
        .from("players")
        .upsert(allTeamUpdates, { onConflict: "id" });
      if (error) {
        log.error("players pro_team update error", error);
      }
    }

    // Refresh player_season_stats matview whenever a game finalized this poll
    // and its rows were successfully written to player_games. `totalGameRows`
    // is only set inside the `.then` callback on a successful upsert, so this
    // implicitly skips the refresh if the player_games write failed (we don't
    // want a refresh to "succeed" against stale source data). The matview is
    // refreshed CONCURRENTLY (see migration 20260510210000), so readers don't
    // block during the refresh.
    let matviewRefreshed = false;
    if (newlyFinalGameIds.size > 0 && totalGameRows > 0) {
      const { error: refreshErr } = await supabase.rpc('refresh_player_season_stats');
      if (refreshErr) {
        log.error('player_season_stats matview refresh failed', refreshErr, {
          sport,
          newlyFinalGameIds: [...newlyFinalGameIds],
        });
      } else {
        matviewRefreshed = true;
        log.info('player_season_stats matview refreshed', {
          sport,
          newlyFinalGameIds: [...newlyFinalGameIds],
        });
      }
    }

    // ── Dispatch Live Activity player ticker updates (non-blocking) ──
    dispatchPlayerTickerUpdates(allLiveRows).catch((err) =>
      log.warn('Live activity ticker dispatch error (non-fatal)', { error: String(err) }),
    );

    await recordHeartbeat(supabase, `poll-live-stats:${sport}`, 'ok');
    return new Response(
      JSON.stringify({
        ok: true,
        sport,
        gameDate,
        activeGames: activeGames.length,
        matchedPlayers: bdlIdToPlayerId.size,
        liveRowsUpserted: totalLiveRows,
        gameRowsUpserted: totalGameRows,
        eventsDerived: allEventRows.length,
        newlyFinalGameIds: [...newlyFinalGameIds],
        matviewRefreshed,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    log.error("Unhandled error in poll-live-stats", err);
    const message = err instanceof Error ? err.message : String(err);
    await recordHeartbeat(supabase, `poll-live-stats:${sport}`, 'error', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
    });
  }
});