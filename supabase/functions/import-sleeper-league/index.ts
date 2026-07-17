import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { requireUser } from '../_shared/auth.ts';
import { HttpError, handleError, jsonResponse } from '../_shared/http.ts';
import {
  planDraftPhaseSeeding,
  type ImportSport,
  type ResolvedTradedPick,
} from '../_shared/importDraftPhase.ts';
import { normalizeName } from '../_shared/normalize.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { floorAtSeasonOpening } from '../_shared/seasonStartFloor.ts';
import { parseBody, z } from '../_shared/validate.ts';

// Body has two shapes by `action`. We validate the top-level discriminator +
// the keys checked at the handler entrypoint; the deeply nested execute
// payload (settings, historical_seasons, etc.) flows through and is consumed
// by the handler functions whose types it already matches.
const PreviewBody = z.object({
  action: z.literal('preview'),
  sleeper_league_id: z.string().min(1, 'sleeper_league_id is required'),
});
const ExecuteBody = z.object({
  action: z.literal('execute'),
  sleeper_league_id: z.string().min(1, 'sleeper_league_id is required'),
  league_name: z.string().min(1, 'league_name is required'),
  teams: z.array(z.unknown()).min(1, 'teams is required'),
}).passthrough();
const Body = z.discriminatedUnion('action', [PreviewBody, ExecuteBody]);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SLEEPER_BASE = 'https://api.sleeper.app/v1';
const MAX_HISTORY_SEASONS = 5;

// --- Sleeper API helpers ---

async function sleeperGet(path: string) {
  const res = await fetch(`${SLEEPER_BASE}${path}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Sleeper API error: ${res.status} ${path}`);
  return res.json();
}

// --- Sport detection ---
//
// Sleeper's `league.sport` is 'nba' for basketball, 'nfl' for football. We
// support both; anything else (Sleeper has no WNBA) is rejected in the preview.
// Our `sport` strings happen to match Sleeper's for the two we support.
type SupportedSport = 'nba' | 'nfl';

// --- Scoring key mapping (Sleeper stat key → our stat_name) ---

const NBA_SCORING_KEY_MAP: Record<string, string> = {
  pts: 'PTS', reb: 'REB', ast: 'AST', stl: 'STL', blk: 'BLK',
  to: 'TO', fg3m: '3PM', fg3a: '3PA', fgm: 'FGM', fga: 'FGA',
  ftm: 'FTM', fta: 'FTA', pf: 'PF', dd: 'DD', td: 'TD',
  threes: '3PM', turnovers: 'TO', double_double: 'DD', triple_double: 'TD',
};

// Conservative NFL map: the unambiguous Sleeper keys that line up with our
// points-only NFL model (utils/sports/registry.ts NFL_SCORING_PRESETS). Sleeper
// exposes many more (per-distance FG buckets, points-allowed tiers, 2pt, IDP);
// those we don't model are left at the sport-default weight, and the user tunes
// scoring in the wizard's Scoring step regardless. Keep in sync with the client
// copy in utils/sleeperMapping.ts.
const NFL_SCORING_KEY_MAP: Record<string, string> = {
  pass_yd: 'PASS_YD', pass_td: 'PASS_TD', pass_int: 'PASS_INT',
  rush_yd: 'RUSH_YD', rush_td: 'RUSH_TD',
  rec: 'REC', rec_yd: 'REC_YD', rec_td: 'REC_TD',
  fum_lost: 'FUM_LOST',
  fgm: 'FG', xpm: 'XP',
  def_td: 'DST_TD', sack: 'DST_SACK', int: 'DST_INT', fum_rec: 'DST_FUM_REC',
};

// Accepts the broader ImportSport: WNBA shares the basketball maps with NBA,
// so only NFL needs its own branch.
function scoringKeyMap(sport: ImportSport): Record<string, string> {
  return sport === 'nfl' ? NFL_SCORING_KEY_MAP : NBA_SCORING_KEY_MAP;
}

// --- Position / slot mapping (Sleeper roster-position token → our slot) ---

const NBA_POSITION_MAP: Record<string, string> = {
  PG: 'PG', SG: 'SG', SF: 'SF', PF: 'PF', C: 'C', G: 'G', F: 'F',
  UTIL: 'UTIL', FLEX: 'UTIL', BN: 'BE', IR: 'IR', IL: 'IR',
};

// NFL slots: our flex slots are FLEX (RB/WR/TE) and SFLX (QB/RB/WR/TE). Sleeper's
// narrower flexes (WRRB_FLEX = RB/WR, REC_FLEX = WR/TE) fold into our FLEX — the
// closest slot we model. IDP tokens (DL/LB/DB/IDP_FLEX) are intentionally absent;
// unmapped starter tokens land the player on the bench (see the execute loop).
const NFL_POSITION_MAP: Record<string, string> = {
  QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', K: 'K',
  DEF: 'DST', DST: 'DST',
  FLEX: 'FLEX', SUPER_FLEX: 'SFLX', WRRB_FLEX: 'FLEX', REC_FLEX: 'FLEX',
  BN: 'BE', IR: 'IR', IL: 'IR', TAXI: 'TAXI',
};

function positionMap(sport: ImportSport): Record<string, string> {
  return sport === 'nfl' ? NFL_POSITION_MAP : NBA_POSITION_MAP;
}

// Tricodes must be unique per league (the `teams_tricode_unique_per_league`
// index). Two Sleeper team names sharing their first 3 letters (e.g. "Yogis
// Balls" -> YOG and "Yogi's Revenge" -> YOG) otherwise trip an unhandled unique
// violation that 500s the whole import mid-way. Disambiguate collisions by
// keeping the first 2 letters and appending a counter (YO2, YO3, ...). Mirrors
// makeUniqueTricode in import-screenshot-league. `tricode` is unbounded `text`.
function makeUniqueTricode(name: string, used: Set<string>): string {
  const clean = name.replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'TM';
  let code = clean.slice(0, 3);
  for (let n = 2; used.has(code); n++) {
    code = clean.slice(0, 2) + n;
  }
  used.add(code);
  return code;
}


// --- Main handler ---

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    // Auth
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SB_SECRET_KEY') ?? ''
    );

    const user = await requireUser(req);

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'import-sleeper-league');
    if (rateLimited) return rateLimited;

    const body = parseBody(Body, await req.json());

    if (body.action === 'preview') {
      return await handlePreview(body, supabaseAdmin, user.id);
    }

    // An import is ~10 sequential write phases (league → roster config →
    // scoring → teams → rosters → draft → picks → waivers → history). It can't
    // be one transaction — the Sleeper mapping is hundreds of lines of TS and
    // moving it into SQL would just trade this bug for a drift bug — so instead
    // a failure part-way through is COMPENSATED: the half-built league is
    // archived, which hides it from every client read (the leagues_select RLS
    // policy is `archived_at IS NULL`). The user gets a clean error and no
    // broken league sitting in their list.
    //
    // Archive rather than DELETE: by this point the league already has teams,
    // rosters, picks and waivers hanging off it, and a hard delete trips ~8
    // ON DELETE NO ACTION FKs. Soft-delete is the project-wide policy.
    const created: { leagueId?: string } = {};
    try {
      return await handleExecute(body as any, supabaseAdmin, user.id, created);
    } catch (err) {
      if (created.leagueId) {
        const { error: archiveErr } = await supabaseAdmin.rpc('archive_league', {
          p_league_id: created.leagueId,
        });
        if (archiveErr) {
          console.error('Failed to archive the half-imported league:', archiveErr);
        }
      }
      throw err;
    }
  } catch (error) {
    return handleError(error, 'import-sleeper-league');
  }
});

// =============================================================================
// PREVIEW — Fetch Sleeper data and match players
// =============================================================================

async function handlePreview(
  body: { sleeper_league_id: string },
  supabaseAdmin: any,
  userId: string,
) {
  const { sleeper_league_id } = body;

  // Fetch all Sleeper data in parallel
  const [league, rosters, users, tradedPicks, drafts] = await Promise.all([
    sleeperGet(`/league/${sleeper_league_id}`),
    sleeperGet(`/league/${sleeper_league_id}/rosters`),
    sleeperGet(`/league/${sleeper_league_id}/users`),
    sleeperGet(`/league/${sleeper_league_id}/traded_picks`),
    sleeperGet(`/league/${sleeper_league_id}/drafts`),
  ]);

  // Detect + validate the sport. Sleeper is 'nba' or 'nfl' for the two we
  // support (it has no WNBA); our sport strings match Sleeper's for both.
  const sport: SupportedSport = (league.sport ?? 'nba');
  if (sport !== 'nba' && sport !== 'nfl') {
    throw new HttpError(`This is a ${league.sport} league. Only NBA and NFL leagues are supported.`);
  }

  // NFL is admin-gated during internal testing (mirrors the create-league
  // `leagues_nfl_admin_gate` DB trigger, which would otherwise reject the
  // execute insert with a late generic 500). Fail fast here with a clear reason.
  if (sport === 'nfl') {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('is_admin')
      .eq('id', userId)
      .single();
    if (!profile?.is_admin) {
      throw new HttpError('NFL leagues are in internal testing and not yet available.', 403);
    }
  }

  // Collect all player IDs from rosters
  const allPlayerIds = new Set<string>();
  for (const roster of rosters) {
    for (const pid of (roster.players ?? [])) allPlayerIds.add(pid);
    for (const pid of (roster.reserve ?? [])) allPlayerIds.add(pid);
  }

  // Fetch Sleeper player database (only the players we need)
  // The full /players/<sport> dictionary is ~5MB, so we fetch it once.
  const sleeperPlayers = await sleeperGet(`/players/${sport}`);

  // Build roster player info
  const rosterPlayers: Array<{
    sleeper_id: string;
    name: string;
    team: string | null;
    position: string | null;
  }> = [];

  for (const pid of allPlayerIds) {
    const sp = sleeperPlayers[pid];
    if (sp) {
      rosterPlayers.push({
        sleeper_id: pid,
        name: sp.full_name ?? `${sp.first_name ?? ''} ${sp.last_name ?? ''}`.trim(),
        team: sp.team ?? null,
        position: sp.position ?? (sp.fantasy_positions?.[0] ?? null),
      });
    }
  }

  // Fetch our players for matching, sport-scoped — without the filter a
  // same-name player in another sport could hijack a match.
  const { data: ourPlayers } = await supabaseAdmin
    .from('players')
    .select('id, name, pro_team, position')
    .eq('sport', sport);

  // Match players
  const byNameAndTeam = new Map<string, any>();
  const byNameOnly = new Map<string, any[]>();
  // NFL team defenses are synthetic "<Team> D/ST" rows keyed by pro_team; Sleeper
  // references them by bare team code (position "DEF"), so name matching can't
  // reach them — match those by team abbreviation instead.
  const byTeamDst = new Map<string, any>();
  for (const p of (ourPlayers ?? [])) {
    const norm = normalizeName(p.name);
    byNameAndTeam.set(`${norm}|${(p.pro_team ?? '').toUpperCase()}`, p);
    if (!byNameOnly.has(norm)) byNameOnly.set(norm, []);
    byNameOnly.get(norm)!.push(p);
    if (p.position === 'DST') byTeamDst.set((p.pro_team ?? '').toUpperCase(), p);
  }

  const playerMatches: any[] = [];
  const unmatchedPlayers: any[] = [];

  for (const sp of rosterPlayers) {
    const team = (sp.team ?? '').toUpperCase();

    // NFL defenses: match by team code, not name.
    if (sport === 'nfl' && sp.position === 'DEF') {
      const dst = byTeamDst.get(team);
      if (dst) {
        playerMatches.push({
          sleeper_id: sp.sleeper_id, sleeper_name: sp.name, sleeper_team: sp.team,
          matched_player_id: dst.id, matched_name: dst.name, confidence: 'high',
        });
      } else {
        unmatchedPlayers.push({
          sleeper_id: sp.sleeper_id, name: sp.name, team: sp.team,
          position: sp.position, confidence: 'none',
        });
      }
      continue;
    }

    const norm = normalizeName(sp.name);

    const exact = byNameAndTeam.get(`${norm}|${team}`);
    if (exact) {
      playerMatches.push({
        sleeper_id: sp.sleeper_id, sleeper_name: sp.name, sleeper_team: sp.team,
        matched_player_id: exact.id, matched_name: exact.name, confidence: 'high',
      });
      continue;
    }

    const nameHits = byNameOnly.get(norm);
    if (nameHits?.length === 1) {
      playerMatches.push({
        sleeper_id: sp.sleeper_id, sleeper_name: sp.name, sleeper_team: sp.team,
        matched_player_id: nameHits[0].id, matched_name: nameHits[0].name, confidence: 'medium',
      });
      continue;
    }

    unmatchedPlayers.push({
      sleeper_id: sp.sleeper_id, name: sp.name, team: sp.team,
      position: sp.position, confidence: nameHits ? 'low' : 'none',
    });
  }

  // Build user map (owner_id → display_name)
  const userMap = new Map<string, { display_name: string; team_name: string }>();
  for (const u of users) {
    userMap.set(u.user_id, {
      display_name: u.display_name ?? u.username ?? 'Unknown',
      team_name: u.metadata?.team_name ?? u.display_name ?? u.username ?? 'Team',
    });
  }

  // Build team summaries
  const teams = rosters.map((r: any) => {
    const owner = userMap.get(r.owner_id);
    return {
      roster_id: r.roster_id,
      owner_id: r.owner_id,
      display_name: owner?.display_name ?? 'Unknown',
      team_name: owner?.team_name ?? `Team ${r.roster_id}`,
      players: (r.players ?? []).length,
      starters: r.starters ?? [],
      wins: r.settings?.wins ?? 0,
      losses: r.settings?.losses ?? 0,
      fpts: (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100,
    };
  });

  // Map scoring
  const scoreMap = scoringKeyMap(sport);
  const scoring = Object.entries(league.scoring_settings ?? {}).reduce(
    (acc: Record<string, number>, [key, val]: [string, any]) => {
      const mapped = scoreMap[key.toLowerCase()];
      if (mapped) acc[mapped] = val;
      return acc;
    },
    {}
  );

  // Map roster positions
  const posMap = positionMap(sport);
  const rosterPositions = (league.roster_positions ?? []) as string[];
  const positionCounts: Record<string, number> = {};
  for (const pos of rosterPositions) {
    const mapped = posMap[pos.toUpperCase()] ?? pos;
    positionCounts[mapped] = (positionCounts[mapped] ?? 0) + 1;
  }

  // Historical seasons
  const historicalSeasons = await fetchHistoricalSeasons(
    league.previous_league_id,
    userMap
  );

  return jsonResponse({
    sport,
    league: {
      name: league.name,
      season: league.season,
      total_rosters: league.total_rosters,
      roster_positions: rosterPositions,
      scoring_settings: scoring,
      position_counts: positionCounts,
      draft_id: league.draft_id,
      previous_league_id: league.previous_league_id,
      status: league.status,
      settings: league.settings ?? {},
    },
    teams,
    traded_picks: tradedPicks ?? [],
    player_matches: playerMatches,
    unmatched_players: unmatchedPlayers,
    historical_seasons: historicalSeasons,
  });
}

// --- Fetch historical seasons by walking previous_league_id chain ---

async function fetchHistoricalSeasons(
  previousLeagueId: string | null,
  userMap: Map<string, { display_name: string; team_name: string }>
): Promise<any[]> {
  const seasons: any[] = [];
  let leagueId = previousLeagueId;

  for (let i = 0; i < MAX_HISTORY_SEASONS && leagueId; i++) {
    try {
      const [league, rosters, users] = await Promise.all([
        sleeperGet(`/league/${leagueId}`),
        sleeperGet(`/league/${leagueId}/rosters`),
        sleeperGet(`/league/${leagueId}/users`),
      ]);

      // Merge users from historical seasons into the map
      for (const u of users) {
        if (!userMap.has(u.user_id)) {
          userMap.set(u.user_id, {
            display_name: u.display_name ?? u.username ?? 'Unknown',
            team_name: u.metadata?.team_name ?? u.display_name ?? u.username ?? 'Team',
          });
        }
      }

      // Sort by fpts descending to derive standings
      const sortedRosters = [...rosters].sort((a: any, b: any) => {
        const aWins = a.settings?.wins ?? 0;
        const bWins = b.settings?.wins ?? 0;
        if (bWins !== aWins) return bWins - aWins;
        const aFpts = (a.settings?.fpts ?? 0) + (a.settings?.fpts_decimal ?? 0) / 100;
        const bFpts = (b.settings?.fpts ?? 0) + (b.settings?.fpts_decimal ?? 0) / 100;
        return bFpts - aFpts;
      });

      const teamData = sortedRosters.map((r: any, index: number) => {
        const owner = userMap.get(r.owner_id);
        return {
          roster_id: r.roster_id,
          name: owner?.team_name ?? `Team ${r.roster_id}`,
          wins: r.settings?.wins ?? 0,
          losses: r.settings?.losses ?? 0,
          ties: r.settings?.ties ?? 0,
          fpts: (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100,
          fpts_against: (r.settings?.fpts_against ?? 0) + (r.settings?.fpts_against_decimal ?? 0) / 100,
          standing: index + 1,
        };
      });

      seasons.push({
        season: league.season,
        league_id: leagueId,
        teams: teamData,
      });

      leagueId = league.previous_league_id;
    } catch (err) {
      console.warn(`Failed to fetch historical season ${leagueId}:`, err);
      break;
    }
  }

  return seasons;
}

// =============================================================================
// EXECUTE — Create the league with all imported data
// =============================================================================

async function handleExecute(
  body: {
    sleeper_league_id: string;
    league_name: string;
    sport?: ImportSport;
    is_dynasty?: boolean;
    draft_phase?: 'in_season' | 'pre_lottery' | 'lottery_done';
    lottery_order?: number[];
    lottery_order_round2?: number[];
    traded_future_picks?: Array<{ season: string; round: number; original_roster_id: number; new_owner_roster_id: number }>;
    player_mappings: Array<{ sleeper_id: string; player_id: string; position: string }>;
    roster_slots: Array<{ position: string; count: number }>;
    scoring: Array<{ stat_name: string; point_value: number }>;
    teams: Array<{ roster_id: number; team_name: string }>;
    traded_picks: Array<{ season: string; round: number; roster_id: number; owner_id: number }>;
    historical_seasons: Array<{
      season: string;
      teams: Array<{ roster_id: number; name: string; wins: number; losses: number; ties: number; fpts: number; fpts_against: number; standing: number }>;
    }>;
    settings: {
      season: string;
      regular_season_weeks: number;
      playoff_weeks: number;
      playoff_teams: number;
      combine_cup_week?: boolean;
      max_future_seasons: number;
      rookie_draft_rounds: number;
      rookie_draft_order: string;
      lottery_draws: number;
      lottery_odds: number[] | null;
      trade_veto_type: string;
      trade_review_period_hours: number;
      trade_votes_to_veto: number;
      draft_pick_trading_enabled: boolean;
      pick_conditions_enabled: boolean;
      waiver_type: string;
      waiver_period_days: number;
      faab_budget: number;
      playoff_seeding_format: string;
      reseed_each_round: boolean;
      buy_in_amount: number | null;
      trade_deadline: string | null;
    };
    roster_positions: string[];
  },
  supabaseAdmin: any,
  userId: string,
  /** Set as soon as the league row exists, so the caller can archive it if a
   *  later phase of the import fails. */
  created: { leagueId?: string }
) {
  const {
    sleeper_league_id,
    league_name,
    player_mappings,
    roster_slots,
    scoring,
    teams,
    traded_picks,
    historical_seasons,
    settings,
    roster_positions,
  } = body;

  const sport: ImportSport = body.sport ?? 'nba';
  const isDynasty = body.is_dynasty ?? false;
  const draftPhase = body.draft_phase ?? 'in_season';
  const manualTradedPicks = body.traded_future_picks ?? [];
  const lotteryOrder = body.lottery_order ?? [];
  const lotteryOrderRound2 = body.lottery_order_round2 ?? [];

  // Re-fetch live roster data from Sleeper (starters/players/reserve arrays)
  const sleeperRosters = await sleeperGet(`/league/${sleeper_league_id}/rosters`);
  const rosterDataMap = new Map<number, { starters: string[]; players: string[]; reserve: string[] }>();
  for (const r of sleeperRosters) {
    rosterDataMap.set(r.roster_id, {
      starters: r.starters ?? [],
      players: r.players ?? [],
      reserve: r.reserve ?? [],
    });
  }

  // Build player lookup: sleeper_id → player_id.
  const playerLookup = new Map<string, string>();
  for (const pm of player_mappings) {
    playerLookup.set(pm.sleeper_id, pm.player_id);
  }

  // Resolve each mapped player's REAL position from our players table rather
  // than trusting the client payload — league_players.position is read back by
  // the position-limit checks (FA-add RPC, waivers, trades), so a wrong value
  // (e.g. the Sleeper team code the client sends for auto-matched players)
  // would mis-count roster caps. Mirrors the "position from players, never the
  // client" rule in roster_add_drop / the draft-pick RPCs.
  const mappedPlayerIds = [...new Set(player_mappings.map(pm => pm.player_id))];
  const positionById = new Map<string, string>();
  if (mappedPlayerIds.length > 0) {
    // sport-scope: ids belong to exactly one sport, so this is already scoped.
    const { data: posRows, error: posErr } = await supabaseAdmin
      .from('players')
      .select('id, position')
      .in('id', mappedPlayerIds);
    if (posErr) throw posErr;
    for (const p of (posRows ?? [])) positionById.set(p.id, p.position);
  }

  // Compute roster size (exclude IR and TAXI from draft rounds)
  const rosterSize = roster_slots.reduce(
    (sum, s) => (s.position === 'IR' || s.position === 'TAXI' ? sum : sum + s.count),
    0
  );

  // Compute season start date: today / next Monday (imports of an underway
  // season align to a Monday week boundary — create-league intentionally
  // differs and starts tomorrow), floored to the pro season's opening night
  // for a pre-tipoff import (else the league would begin with months of
  // gameless weeks).
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dow = today.getDay();
  const daysSinceMon = dow === 0 ? 6 : dow - 1;
  const daysLeft = 7 - daysSinceMon;
  let seasonStart = today;
  if (daysLeft < 5) {
    seasonStart = new Date(today);
    seasonStart.setDate(today.getDate() + (7 - daysSinceMon));
  }
  const seasonStartDate = await floorAtSeasonOpening(
    supabaseAdmin,
    sport,
    settings.season,
    `${seasonStart.getFullYear()}-${String(seasonStart.getMonth() + 1).padStart(2, '0')}-${String(seasonStart.getDate()).padStart(2, '0')}`,
  );

  // 1. Create league
  const { data: leagueData, error: leagueError } = await supabaseAdmin
    .from('leagues')
    .insert({
      name: league_name,
      created_by: userId,
      // leagues.sport defaults to 'nba' at the column level — set it explicitly
      // or an NFL/WNBA import would silently become an NBA league (and the
      // sport is immutable post-insert). Admin-gated for NFL by a DB trigger.
      sport,
      teams: teams.length,
      current_teams: 0,
      roster_size: rosterSize,
      private: true,
      season: settings.season,
      season_start_date: seasonStartDate,
      regular_season_weeks: settings.regular_season_weeks,
      playoff_weeks: settings.playoff_weeks,
      // `=== true` (not `?? false`): the execute settings block rides the
      // ExecuteBody passthrough without Zod, so coerce rather than trust the
      // wire type — a non-boolean would otherwise 500 on the column insert.
      combine_cup_week: sport === 'nba' ? settings.combine_cup_week === true : false,
      schedule_generated: false,
      max_future_seasons: settings.max_future_seasons,
      trade_veto_type: settings.trade_veto_type,
      trade_review_period_hours: settings.trade_review_period_hours,
      trade_votes_to_veto: settings.trade_votes_to_veto,
      trade_deadline: settings.trade_deadline,
      draft_pick_trading_enabled: settings.draft_pick_trading_enabled,
      pick_conditions_enabled: settings.pick_conditions_enabled,
      rookie_draft_rounds: settings.rookie_draft_rounds,
      rookie_draft_order: settings.rookie_draft_order,
      lottery_draws: settings.lottery_draws,
      lottery_odds: settings.lottery_odds,
      playoff_teams: settings.playoff_teams,
      waiver_type: settings.waiver_type,
      waiver_period_days: settings.waiver_period_days,
      faab_budget: settings.faab_budget,
      playoff_seeding_format: settings.playoff_seeding_format,
      reseed_each_round: settings.reseed_each_round,
      buy_in_amount: settings.buy_in_amount,
      imported_from: 'sleeper',
      league_type: isDynasty ? 'dynasty' : 'redraft',
    })
    .select('id')
    .single();

  if (leagueError) throw leagueError;
  const leagueId = leagueData.id;
  created.leagueId = leagueId;  // from here on, a failure archives the league

  // 2. Insert roster config
  const rosterConfigRows = roster_slots
    .filter(s => s.count > 0)
    .map(s => ({
      league_id: leagueId,
      position: s.position,
      slot_count: s.count,
    }));

  if (rosterConfigRows.length > 0) {
    const { error } = await supabaseAdmin.from('league_roster_config').insert(rosterConfigRows);
    if (error) throw error;
  }

  // 3. Insert scoring settings
  const scoringRows = scoring.map(s => ({
    league_id: leagueId,
    stat_name: s.stat_name,
    point_value: s.point_value,
  }));

  if (scoringRows.length > 0) {
    const { error } = await supabaseAdmin.from('league_scoring_settings').insert(scoringRows);
    if (error) throw error;
  }

  // 4. Create placeholder teams (no user_id)
  // Map sleeper roster_id → our team_id
  const rosterIdToTeamId = new Map<number, string>();
  const usedTricodes = new Set<string>();

  for (const team of teams) {
    const { data: teamData, error: teamError } = await supabaseAdmin
      .from('teams')
      .insert({
        league_id: leagueId,
        user_id: null,
        name: team.team_name,
        tricode: makeUniqueTricode(team.team_name, usedTricodes),
        is_commissioner: false,
        sleeper_roster_id: team.roster_id,
        wins: 0,
        losses: 0,
        ties: 0,
        points_for: 0,
        points_against: 0,
      })
      .select('id')
      .single();

    if (teamError) throw teamError;
    rosterIdToTeamId.set(team.roster_id, teamData.id);
  }

  // 4b. Update current_teams to reflect imported teams
  await supabaseAdmin
    .from('leagues')
    .update({ current_teams: teams.length })
    .eq('id', leagueId);

  // 5. Insert rosters (league_players)
  const posMap = positionMap(sport);
  // Structural (non-starter) tokens don't consume a positional starter slot.
  const NON_STARTER_TOKENS = new Set(['BN', 'IR', 'IL', 'TAXI']);
  const starterPositions = roster_positions.filter(p => !NON_STARTER_TOKENS.has(p.toUpperCase()));
  const timestamp = new Date().toISOString();
  const leaguePlayerRows: any[] = [];

  for (const team of teams) {
    const teamId = rosterIdToTeamId.get(team.roster_id);
    if (!teamId) continue;

    const rosterData = rosterDataMap.get(team.roster_id);
    if (!rosterData) continue;

    // Assign slots based on starters/bench/reserve from live Sleeper data
    let utilIndex = 0;
    const assigned = new Set<string>();

    // Build a league_players row for one player, resolving player_id + real
    // position from the authoritative maps. Returns null if the player wasn't
    // mapped (skipped) — caller decides whether to mark it assigned.
    const makeRow = (sleeperId: string, roster_slot: string) => {
      const playerId = playerLookup.get(sleeperId);
      if (!playerId) return null;
      return {
        league_id: leagueId,
        team_id: teamId,
        player_id: playerId,
        position: positionById.get(playerId) ?? '',
        roster_slot,
        acquired_via: 'draft',
        acquired_at: timestamp,
        on_trade_block: false,
      };
    };

    // Starters — the starters array is index-aligned with starterPositions.
    for (let i = 0; i < rosterData.starters.length && i < starterPositions.length; i++) {
      const sleeperId = rosterData.starters[i];
      if (!sleeperId || sleeperId === '0') continue;

      // UTIL is numbered (UTIL1..N); every other slot uses its bare name (two
      // RB starters both become "RB", disambiguated by positional fill at
      // render). An unknown token (e.g. an unsupported IDP slot) benches the
      // player rather than inventing a bogus slot.
      const mappedSlot = posMap[starterPositions[i].toUpperCase()];
      let slot: string;
      if (mappedSlot === 'UTIL') {
        utilIndex++;
        slot = `UTIL${utilIndex}`;
      } else {
        slot = mappedSlot ?? 'BE';
      }

      const row = makeRow(sleeperId, slot);
      if (!row) continue;
      leaguePlayerRows.push(row);
      assigned.add(sleeperId);
    }

    // Reserve/IR
    for (const sleeperId of rosterData.reserve) {
      if (!sleeperId || sleeperId === '0' || assigned.has(sleeperId)) continue;
      const row = makeRow(sleeperId, 'IR');
      if (!row) continue;
      leaguePlayerRows.push(row);
      assigned.add(sleeperId);
    }

    // Bench (everyone in players array not already assigned)
    for (const sleeperId of rosterData.players) {
      if (assigned.has(sleeperId)) continue;
      const row = makeRow(sleeperId, 'BE');
      if (!row) continue;
      leaguePlayerRows.push(row);
    }
  }

  // A player can only be rostered on one team — league_players has
  // UNIQUE(league_id, player_id) (uq_league_player). Two Sleeper roster slots
  // mapping onto the same players.id (e.g. two sleeper_ids that preview matched
  // to one of our players) would otherwise throw a raw unique violation
  // mid-insert and 500 the whole import. Dedupe on player_id (keep the first
  // occurrence) and surface the skipped players. Mirrors import-screenshot-league.
  const seenPlayerIds = new Set<string>();
  const dedupedPlayerRows: any[] = [];
  const droppedPlayerIds: string[] = [];
  for (const row of leaguePlayerRows) {
    if (seenPlayerIds.has(row.player_id)) {
      droppedPlayerIds.push(row.player_id);
      continue;
    }
    seenPlayerIds.add(row.player_id);
    dedupedPlayerRows.push(row);
  }

  // Insert in chunks
  for (let i = 0; i < dedupedPlayerRows.length; i += 100) {
    const chunk = dedupedPlayerRows.slice(i, i + 100);
    const { error } = await supabaseAdmin.from('league_players').insert(chunk);
    if (error) throw error;
  }

  // Resolve any skipped duplicates to names for the response.
  let duplicatePlayers: { player_id: string; name: string }[] = [];
  if (droppedPlayerIds.length > 0) {
    const uniqueDropped = [...new Set(droppedPlayerIds)];
    const { data: dupRows } = await supabaseAdmin
      .from('players')
      .select('id, name')
      .in('id', uniqueDropped);
    const nameById = new Map<string, string>((dupRows ?? []).map((p: any) => [p.id, p.name]));
    duplicatePlayers = uniqueDropped.map((id) => ({ player_id: id, name: nameById.get(id) ?? 'Unknown' }));
    console.warn('Import skipped duplicate players (already rostered on another team):', duplicatePlayers);
  }

  // 6. Create draft (marked complete since import implies draft already happened)
  const { data: draftData, error: draftError } = await supabaseAdmin
    .from('drafts')
    .insert({
      league_id: leagueId,
      season: settings.season,
      type: 'initial',
      status: 'complete',
      rounds: rosterSize,
      picks_per_round: teams.length,
      time_limit: 90,
      draft_type: 'snake',
    })
    .select('id')
    .single();

  if (draftError) throw draftError;

  // 7. Seed draft picks: future tradable picks (+1..+N) plus, when the upcoming
  //    rookie draft hasn't happened yet (draft_phase), the offset-0 rookie picks
  //    that drive the in-app lottery / rookie draft. Dynasty only.
  const orderedTeamIds = teams
    .map(t => rosterIdToTeamId.get(t.roster_id))
    .filter((id): id is string => !!id);

  // Reverse-standings order from the most recent imported season — used to seed
  // a pre-draft reverse_record order. Returns undefined (→ unordered) if history
  // is missing or doesn't cover every team.
  function reverseStandingsOrderFromHistory(): string[] | undefined {
    if (!historical_seasons?.length) return undefined;
    const latest = [...historical_seasons].sort((a, b) => (a.season < b.season ? 1 : -1))[0];
    if (!latest?.teams?.length) return undefined;
    const sorted = [...latest.teams].sort((a, b) => (a.wins - b.wins) || (a.fpts - b.fpts));
    const order = sorted
      .map(t => rosterIdToTeamId.get(t.roster_id))
      .filter((id): id is string => !!id);
    return order.length === orderedTeamIds.length ? order : undefined;
  }

  // Resolve traded future picks to team UUIDs: Sleeper's auto-detected set plus
  // any manual overrides from the wizard (manual wins on the same pick).
  const tradedByKey = new Map<string, ResolvedTradedPick>();
  const addTrade = (season: string, round: number, origRosterId: number, ownerRosterId: number) => {
    const originalTeamId = rosterIdToTeamId.get(origRosterId);
    const newOwnerTeamId = rosterIdToTeamId.get(ownerRosterId);
    if (!originalTeamId || !newOwnerTeamId) return;
    tradedByKey.set(`${season}|${round}|${originalTeamId}`, { season, round, originalTeamId, newOwnerTeamId });
  };
  for (const tp of traded_picks) addTrade(tp.season, tp.round, tp.roster_id, tp.owner_id);
  for (const tp of manualTradedPicks) addTrade(tp.season, tp.round, tp.original_roster_id, tp.new_owner_roster_id);
  const resolvedTraded = Array.from(tradedByKey.values());

  // Staged until after history is inserted so start-lottery has standings to read.
  let offseasonUpdate: { offseason_step?: string; lottery_status?: string } | null = null;

  if (isDynasty) {
    const usesLottery = settings.rookie_draft_order === 'lottery';

    // Resolve the S0 draft order (identity-specific; the planner is order-agnostic).
    let order: string[] | undefined;
    // A lottery only sets round 1; rounds 2+ revert to reverse standings. Falls
    // back to the entered order when no standings history was imported.
    let laterRoundOrder: string[] | undefined;
    if (draftPhase === 'lottery_done') {
      order = lotteryOrder
        .map(rid => rosterIdToTeamId.get(rid))
        .filter((id): id is string => !!id);
      if (order.length !== orderedTeamIds.length || new Set(order).size !== orderedTeamIds.length) {
        throw new HttpError('lottery_order must list every team exactly once', 400);
      }
      // Explicit round-2 order from the client (WYSIWYG) wins; otherwise a
      // lottery's round 2 reverts to reverse standings, and a non-lottery's
      // round 2 mirrors round 1 (laterRoundOrder = undefined).
      const r2 = lotteryOrderRound2
        .map(rid => rosterIdToTeamId.get(rid))
        .filter((id): id is string => !!id);
      laterRoundOrder = r2.length === orderedTeamIds.length && new Set(r2).size === r2.length
        ? r2
        : (usesLottery ? reverseStandingsOrderFromHistory() : undefined);
    } else if (draftPhase === 'pre_lottery' && !usesLottery) {
      order = reverseStandingsOrderFromHistory();
    }

    const { pickRows, offseasonUpdate: planned } = planDraftPhaseSeeding({
      leagueId,
      teamIds: orderedTeamIds,
      rounds: settings.rookie_draft_rounds,
      currentSeason: settings.season,
      sport,
      maxFutureSeasons: settings.max_future_seasons,
      draftPhase,
      usesLottery,
      order,
      laterRoundOrder,
      resolvedTraded,
    });
    offseasonUpdate = planned;

    for (let i = 0; i < pickRows.length; i += 100) {
      const chunk = pickRows.slice(i, i + 100);
      const { error } = await supabaseAdmin.from('draft_picks').insert(chunk);
      if (error) throw error;
    }
  }

  // 8. Initialize waiver priority
  const waiverRows = orderedTeamIds.map((teamId, index) => ({
    league_id: leagueId,
    team_id: teamId,
    priority: index + 1,
    faab_remaining: settings.faab_budget,
  }));

  if (waiverRows.length > 0) {
    const { error } = await supabaseAdmin.from('waiver_priority').insert(waiverRows);
    if (error) console.warn('Failed to insert waiver priority:', error.message);
  }

  // 9. Insert historical seasons
  if (historical_seasons?.length > 0) {
    const teamSeasonRows: any[] = [];

    for (const hs of historical_seasons) {
      for (const ht of hs.teams) {
        const teamId = rosterIdToTeamId.get(ht.roster_id);
        if (!teamId) continue;

        teamSeasonRows.push({
          team_id: teamId,
          league_id: leagueId,
          season: hs.season,
          wins: ht.wins,
          losses: ht.losses,
          ties: ht.ties ?? 0,
          points_for: ht.fpts,
          points_against: ht.fpts_against ?? 0,
          final_standing: ht.standing,
          playoff_result: null,
        });
      }
    }

    for (let i = 0; i < teamSeasonRows.length; i += 100) {
      const chunk = teamSeasonRows.slice(i, i + 100);
      const { error } = await supabaseAdmin.from('team_seasons').insert(chunk);
      if (error) console.warn('Failed to insert team_seasons:', error.message);
    }
  }

  // 10. Move the league into its offseason state LAST — after picks + standings
  //     exist — so a partial failure never leaves a league claiming a pending
  //     lottery/draft with nothing to draw from.
  if (offseasonUpdate) {
    const { error } = await supabaseAdmin.from('leagues').update(offseasonUpdate).eq('id', leagueId);
    if (error) throw error;
  }

  return jsonResponse({
    league_id: leagueId,
    teams_created: teams.length,
    players_imported: dedupedPlayerRows.length,
    duplicate_players: duplicatePlayers,
    message: `Successfully imported "${league_name}" with ${teams.length} teams and ${dedupedPlayerRows.length} players.`
      + (duplicatePlayers.length
        ? ` Skipped ${duplicatePlayers.length} duplicate player${duplicatePlayers.length === 1 ? '' : 's'} already on another team: ${duplicatePlayers.map((p) => p.name).join(', ')}.`
        : ''),
  });
}
