/**
 * Pure row-building for sync-game-schedule, extracted so jest can
 * regression-test the finals/pending split (index.ts is not jest-importable:
 * jsr/URL imports + Deno.env at module scope). Zero-import leaf — the status
 * and slate-date mappers are injected by the caller (mapGameStatus and
 * bdlGameSlateDate; the unit test imports the real implementations from
 * utils/ and passes them in).
 *
 * Background (the bug this guards against): the old `deriveStatus` used an
 * exact `=== "Final"` match, but BDL reports WNBA finals as "post" and NFL
 * overtime finals as "Final/OT". Every weekly WNBA sync therefore rewrote the
 * whole season's finished games back to status='scheduled' with NULL scores
 * (151 games clobbered in prod), and the daily NFL sync would have done the
 * same every day mid-season — including downgrading LIVE games mid-slate,
 * since non-final rows unconditionally carried status='scheduled'.
 *
 * The fix: derive finality through mapGameStatus (tolerant, per-sport,
 * already unit-tested), and split the upsert into two homogeneous batches:
 * - finals: full row INCLUDING status + home_score/away_score
 * - pending: row WITHOUT the status/score keys — PostgREST only SETs payload
 *   keys on conflict, so existing rows keep whatever status/scores
 *   poll-live-stats wrote ('live'/'final'), and brand-new inserts take the
 *   column DEFAULT 'scheduled' with NULL scores.
 * Batches must stay homogeneous: PostgREST derives the SET list per request,
 * so mixing shapes in one upsert would null the missing keys.
 */

export interface ScheduleRowBase {
  sport: string;
  game_id: string;
  game_date: string;
  season: string;
  home_team: string;
  away_team: string;
  game_time_utc: string | null;
  week?: number | null;
}

export interface FinalScheduleRow extends ScheduleRowBase {
  status: "final";
  home_score: number | null;
  away_score: number | null;
}

export interface BuildDeps {
  /** `(status, kickoffIso) => mapGameStatus(status, sport, kickoffIso) === 3` */
  isFinal: (status: string, kickoffIso: string | null) => boolean;
  /** bdlGameSlateDate */
  slateDateOf: (input: string | null | undefined) => string | null;
}

/**
 * BDL emits a midnight-Eastern timestamp (e.g. "2026-05-03T04:00:00Z" during
 * EDT) as the TBD placeholder for playoff games whose tipoff isn't set yet.
 * Real NBA/WNBA games never tip at exactly 12:00am ET, so any datetime that
 * lands on midnight ET is a placeholder — return null so downstream lock
 * logic (utils/nba/gameStarted.ts) treats the game as untimed instead of
 * "already started at midnight."
 */
export function normalizeGameTimeUtc(datetime: string | null | undefined): string | null {
  if (!datetime) return null;
  const d = new Date(datetime);
  if (isNaN(d.getTime())) return null;
  const etParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const hour = etParts.find((p) => p.type === "hour")?.value;
  const minute = etParts.find((p) => p.type === "minute")?.value;
  // Intl returns "24" for midnight in some Node/Deno versions; treat both as midnight.
  const isMidnightEt = (hour === "00" || hour === "24") && minute === "00";
  return isMidnightEt ? null : datetime;
}

/**
 * Map raw BDL /games rows to the two upsert batches. Games missing a team
 * abbreviation or a resolvable slate date are dropped (same as before).
 */
export function buildScheduleRows(
  bdlGames: any[],
  sport: string,
  targetSeason: string,
  deps: BuildDeps,
): { finals: FinalScheduleRow[]; pending: ScheduleRowBase[] } {
  const finals: FinalScheduleRow[] = [];
  const pending: ScheduleRowBase[] = [];

  for (const g of bdlGames) {
    if (!g.home_team?.abbreviation || !g.visitor_team?.abbreviation) continue;

    // BDL's NBA endpoint returns `date: "YYYY-MM-DD"` and `datetime: <ISO>`.
    // Its WNBA endpoint returns the tipoff time directly in `date` as a
    // full ISO timestamp and omits `datetime` entirely. Prefer `datetime`
    // when present; otherwise use `date` if it carries a time component.
    const rawDateTime =
      g.datetime ??
      (typeof g.date === "string" && g.date.length > 10 ? g.date : null);
    // Anchor game_date on the ET slate so 10pm ET tipoffs (02:00 UTC next
    // day) stay attached to the night they were scheduled for. Falls back
    // to plain date for NBA's `YYYY-MM-DD` form.
    const gameDate = deps.slateDateOf(rawDateTime ?? g.date);
    if (!gameDate) continue;

    const base: ScheduleRowBase = {
      sport,
      game_id: String(g.id),
      game_date: gameDate,
      season: targetSeason,
      home_team: g.home_team.abbreviation,
      away_team: g.visitor_team.abbreviation,
      game_time_utc: normalizeGameTimeUtc(rawDateTime),
      // NFL week number (1-18) drives bye detection; basketball has none.
      ...(sport === "nfl" ? { week: g.week ?? null } : {}),
    };

    if (deps.isFinal(String(g.status ?? ""), rawDateTime)) {
      // BDL uses different score field names per sport: NBA/NFL expose
      // `home_team_score`/`visitor_team_score`, WNBA uses `home_score`/
      // `away_score` — same fallback chain as poll-live-stats' mirror.
      // (Reading only the NBA-style names here NULLed every WNBA final's
      // scores once "post" was correctly classified as final.)
      finals.push({
        ...base,
        status: "final",
        home_score: g.home_score ?? g.home_team_score ?? null,
        away_score: g.away_score ?? g.visitor_team_score ?? null,
      });
    } else {
      // No status/score keys on purpose — see module doc. A suspended or
      // postponed game that was already marked 'live' keeps that status until
      // resolved (poll-live-stats never downgrades either); accepted trade-off
      // for never being able to clobber a live/final row.
      pending.push(base);
    }
  }

  return { finals, pending };
}
