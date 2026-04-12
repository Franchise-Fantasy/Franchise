import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { normalizeName } from '../_shared/normalize.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

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

// --- Scoring key mapping ---

const SCORING_KEY_MAP: Record<string, string> = {
  pts: 'PTS', reb: 'REB', ast: 'AST', stl: 'STL', blk: 'BLK',
  to: 'TO', fg3m: '3PM', fg3a: '3PA', fgm: 'FGM', fga: 'FGA',
  ftm: 'FTM', fta: 'FTA', pf: 'PF', dd: 'DD', td: 'TD',
  threes: '3PM', turnovers: 'TO', double_double: 'DD', triple_double: 'TD',
};

const DEFAULT_SCORING: Record<string, number> = {
  PTS: 1, REB: 1.2, AST: 1.5, STL: 3, BLK: 3, TO: -1,
  '3PM': 1, '3PA': 0, FGM: 2, FGA: -1, FTM: 1, FTA: -1, PF: -1, DD: 0, TD: 0,
};

// --- Position mapping ---

const POSITION_MAP: Record<string, string> = {
  PG: 'PG', SG: 'SG', SF: 'SF', PF: 'PF', C: 'C', G: 'G', F: 'F',
  UTIL: 'UTIL', FLEX: 'UTIL', BN: 'BE', IR: 'IR', IL: 'IR',
};


// --- Main handler ---

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    // Auth
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader : `Bearer ${authHeader}`;
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: token ?? '' } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'import-sleeper-league');
    if (rateLimited) return rateLimited;

    const body = await req.json();
    const { action } = body;

    if (action === 'preview') {
      return await handlePreview(body, supabaseAdmin);
    } else if (action === 'execute') {
      return await handleExecute(body, supabaseAdmin, user.id);
    } else {
      throw new Error('action must be "preview" or "execute"');
    }
  } catch (error) {
    console.error('import-sleeper-league error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
});

// =============================================================================
// PREVIEW — Fetch Sleeper data and match players
// =============================================================================

async function handlePreview(
  body: { sleeper_league_id: string },
  supabaseAdmin: any
) {
  const { sleeper_league_id } = body;
  if (!sleeper_league_id) throw new Error('sleeper_league_id is required');

  // Fetch all Sleeper data in parallel
  const [league, rosters, users, tradedPicks, drafts] = await Promise.all([
    sleeperGet(`/league/${sleeper_league_id}`),
    sleeperGet(`/league/${sleeper_league_id}/rosters`),
    sleeperGet(`/league/${sleeper_league_id}/users`),
    sleeperGet(`/league/${sleeper_league_id}/traded_picks`),
    sleeperGet(`/league/${sleeper_league_id}/drafts`),
  ]);

  // Validate this is a basketball league
  if (league.sport && league.sport !== 'nba') {
    throw new Error(`This is a ${league.sport} league. Only NBA leagues are supported.`);
  }

  // Collect all player IDs from rosters
  const allPlayerIds = new Set<string>();
  for (const roster of rosters) {
    for (const pid of (roster.players ?? [])) allPlayerIds.add(pid);
    for (const pid of (roster.reserve ?? [])) allPlayerIds.add(pid);
  }

  // Fetch Sleeper player database (only the players we need)
  // The full /players/nba is ~5MB, so we fetch it once
  const sleeperPlayers = await sleeperGet('/players/nba');

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

  // Fetch our players for matching
  const { data: ourPlayers } = await supabaseAdmin
    .from('players')
    .select('id, name, nba_team, position');

  // Match players
  const byNameAndTeam = new Map<string, any>();
  const byNameOnly = new Map<string, any[]>();
  for (const p of (ourPlayers ?? [])) {
    const norm = normalizeName(p.name);
    byNameAndTeam.set(`${norm}|${(p.nba_team ?? '').toUpperCase()}`, p);
    if (!byNameOnly.has(norm)) byNameOnly.set(norm, []);
    byNameOnly.get(norm)!.push(p);
  }

  const playerMatches: any[] = [];
  const unmatchedPlayers: any[] = [];

  for (const sp of rosterPlayers) {
    const norm = normalizeName(sp.name);
    const team = (sp.team ?? '').toUpperCase();

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
  const scoring = Object.entries(league.scoring_settings ?? {}).reduce(
    (acc: Record<string, number>, [key, val]: [string, any]) => {
      const mapped = SCORING_KEY_MAP[key.toLowerCase()];
      if (mapped) acc[mapped] = val;
      return acc;
    },
    {}
  );

  // Map roster positions
  const rosterPositions = (league.roster_positions ?? []) as string[];
  const positionCounts: Record<string, number> = {};
  for (const pos of rosterPositions) {
    const mapped = POSITION_MAP[pos.toUpperCase()] ?? pos;
    positionCounts[mapped] = (positionCounts[mapped] ?? 0) + 1;
  }

  // Historical seasons
  const historicalSeasons = await fetchHistoricalSeasons(
    league.previous_league_id,
    userMap
  );

  return jsonResponse({
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
      waiver_day_of_week: number;
      playoff_seeding_format: string;
      reseed_each_round: boolean;
      buy_in_amount: number | null;
      trade_deadline: string | null;
    };
    roster_positions: string[];
  },
  supabaseAdmin: any,
  userId: string
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

  if (!league_name || !teams?.length || !sleeper_league_id) {
    throw new Error('sleeper_league_id, league_name, and teams are required');
  }

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

  // Build player lookup: sleeper_id → { player_id, position }
  const playerLookup = new Map<string, { player_id: string; position: string }>();
  for (const pm of player_mappings) {
    playerLookup.set(pm.sleeper_id, { player_id: pm.player_id, position: pm.position });
  }

  // Compute roster size (exclude IR and TAXI from draft rounds)
  const rosterSize = roster_slots.reduce(
    (sum, s) => (s.position === 'IR' || s.position === 'TAXI' ? sum : sum + s.count),
    0
  );

  // Compute season start date (same logic as create-league)
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
  const seasonStartDate = `${seasonStart.getFullYear()}-${String(seasonStart.getMonth() + 1).padStart(2, '0')}-${String(seasonStart.getDate()).padStart(2, '0')}`;

  // 1. Create league
  const { data: leagueData, error: leagueError } = await supabaseAdmin
    .from('leagues')
    .insert({
      name: league_name,
      created_by: userId,
      teams: teams.length,
      current_teams: 0,
      roster_size: rosterSize,
      private: true,
      season: settings.season,
      season_start_date: seasonStartDate,
      regular_season_weeks: settings.regular_season_weeks,
      playoff_weeks: settings.playoff_weeks,
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
      waiver_day_of_week: settings.waiver_day_of_week,
      playoff_seeding_format: settings.playoff_seeding_format,
      reseed_each_round: settings.reseed_each_round,
      buy_in_amount: settings.buy_in_amount,
      imported_from: 'sleeper',
    })
    .select('id')
    .single();

  if (leagueError) throw new Error(`Failed to create league: ${leagueError.message}`);
  const leagueId = leagueData.id;

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
    if (error) throw new Error(`Failed to insert roster config: ${error.message}`);
  }

  // 3. Insert scoring settings
  const scoringRows = scoring.map(s => ({
    league_id: leagueId,
    stat_name: s.stat_name,
    point_value: s.point_value,
  }));

  if (scoringRows.length > 0) {
    const { error } = await supabaseAdmin.from('league_scoring_settings').insert(scoringRows);
    if (error) throw new Error(`Failed to insert scoring settings: ${error.message}`);
  }

  // 4. Create placeholder teams (no user_id)
  // Map sleeper roster_id → our team_id
  const rosterIdToTeamId = new Map<number, string>();

  for (const team of teams) {
    const { data: teamData, error: teamError } = await supabaseAdmin
      .from('teams')
      .insert({
        league_id: leagueId,
        user_id: null,
        name: team.team_name,
        tricode: team.team_name.substring(0, 3).toUpperCase(),
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

    if (teamError) throw new Error(`Failed to create team "${team.team_name}": ${teamError.message}`);
    rosterIdToTeamId.set(team.roster_id, teamData.id);
  }

  // 4b. Update current_teams to reflect imported teams
  await supabaseAdmin
    .from('leagues')
    .update({ current_teams: teams.length })
    .eq('id', leagueId);

  // 5. Insert rosters (league_players)
  const starterPositions = roster_positions.filter(
    p => p !== 'BN' && p !== 'IR' && p !== 'IL'
  );
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

    // Starters
    for (let i = 0; i < rosterData.starters.length && i < starterPositions.length; i++) {
      const sleeperId = rosterData.starters[i];
      if (!sleeperId || sleeperId === '0') continue;

      const mapped = playerLookup.get(sleeperId);
      if (!mapped) continue;

      const pos = POSITION_MAP[starterPositions[i].toUpperCase()] ?? starterPositions[i];
      let slot: string;
      if (pos === 'UTIL') {
        utilIndex++;
        slot = `UTIL${utilIndex}`;
      } else {
        slot = pos;
      }

      leaguePlayerRows.push({
        league_id: leagueId,
        team_id: teamId,
        player_id: mapped.player_id,
        position: mapped.position,
        roster_slot: slot,
        acquired_via: 'draft',
        acquired_at: timestamp,
        on_trade_block: false,
      });
      assigned.add(sleeperId);
    }

    // Reserve/IR
    for (const sleeperId of rosterData.reserve) {
      if (!sleeperId || sleeperId === '0' || assigned.has(sleeperId)) continue;
      const mapped = playerLookup.get(sleeperId);
      if (!mapped) continue;

      leaguePlayerRows.push({
        league_id: leagueId,
        team_id: teamId,
        player_id: mapped.player_id,
        position: mapped.position,
        roster_slot: 'IR',
        acquired_via: 'draft',
        acquired_at: timestamp,
        on_trade_block: false,
      });
      assigned.add(sleeperId);
    }

    // Bench (everyone in players array not already assigned)
    for (const sleeperId of rosterData.players) {
      if (assigned.has(sleeperId)) continue;
      const mapped = playerLookup.get(sleeperId);
      if (!mapped) continue;

      leaguePlayerRows.push({
        league_id: leagueId,
        team_id: teamId,
        player_id: mapped.player_id,
        position: mapped.position,
        roster_slot: 'BE',
        acquired_via: 'draft',
        acquired_at: timestamp,
        on_trade_block: false,
      });
    }
  }

  // Insert in chunks
  for (let i = 0; i < leaguePlayerRows.length; i += 100) {
    const chunk = leaguePlayerRows.slice(i, i + 100);
    const { error } = await supabaseAdmin.from('league_players').insert(chunk);
    if (error) throw new Error(`Failed to insert roster players: ${error.message}`);
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

  if (draftError) throw new Error(`Failed to create draft: ${draftError.message}`);

  // 7. Create future draft picks with correct ownership based on traded_picks
  const teamIds = Array.from(rosterIdToTeamId.entries());
  const startYear = parseInt(settings.season.split('-')[0], 10);

  for (let offset = 1; offset <= settings.max_future_seasons; offset++) {
    const futureStart = startYear + offset;
    const futureEnd = (futureStart + 1) % 100;
    const season = `${futureStart}-${String(futureEnd).padStart(2, '0')}`;

    for (let round = 1; round <= settings.rookie_draft_rounds; round++) {
      for (let slot = 0; slot < teamIds.length; slot++) {
        const [rosterId, teamId] = teamIds[slot];

        // Check if this pick was traded
        const trade = traded_picks.find(
          tp => tp.season === season && tp.round === round && tp.roster_id === rosterId
        );

        const currentOwnerId = trade
          ? (rosterIdToTeamId.get(trade.owner_id) ?? teamId)
          : teamId;

        await supabaseAdmin.from('draft_picks').insert({
          league_id: leagueId,
          season,
          round,
          slot_number: slot + 1,
          current_team_id: currentOwnerId,
          original_team_id: teamId,
        });
      }
    }
  }

  // 8. Initialize waiver priority
  const waiverRows = teamIds.map(([_, teamId], index) => ({
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

  return jsonResponse({
    league_id: leagueId,
    teams_created: teams.length,
    players_imported: leaguePlayerRows.length,
    message: `Successfully imported "${league_name}" with ${teams.length} teams and ${leaguePlayerRows.length} players.`,
  });
}
