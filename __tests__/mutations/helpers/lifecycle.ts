import { SupabaseClient } from '@supabase/supabase-js';
import { adminClient } from './clients';
import { BOT_COUNT, BOT_EMAIL, BOT_PASSWORD, BOT_TEAM_NAME } from './config';

export type LeagueType = 'dynasty' | 'keeper' | 'redraft';

const LIFECYCLE_SEASON = '2026-27';

// Four test teams, seeded so teams 1-2 make the playoffs (best records) and
// teams 3-4 miss them (worst records → Dynasty lottery pool).
export const LIFECYCLE_STANDINGS: Array<{
  botIndex: number;
  wins: number;
  losses: number;
  points_for: number;
  points_against: number;
}> = [
  { botIndex: 1, wins: 4, losses: 0, points_for: 520, points_against: 410 },
  { botIndex: 2, wins: 3, losses: 1, points_for: 490, points_against: 430 },
  { botIndex: 3, wins: 1, losses: 3, points_for: 420, points_against: 470 },
  { botIndex: 4, wins: 0, losses: 4, points_for: 400, points_against: 520 },
];

export const LIFECYCLE_LEAGUE_NAME = (type: LeagueType): string =>
  `__TEST__ Lifecycle ${type.charAt(0).toUpperCase() + type.slice(1)}`;

export interface LifecycleBootstrap {
  leagueId: string;
  commissionerUserId: string;
  type: LeagueType;
  // Teams sorted ascending by botIndex (team for bot1 first, etc.)
  teams: Array<{ id: string; name: string; userId: string; botIndex: number }>;
  // Deterministic canonical player IDs, 2 per team, in the same order as `teams`.
  canonicalPlayerIds: string[][];
}

async function findUserByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function ensureBot(admin: SupabaseClient, email: string): Promise<string> {
  const existing = await findUserByEmail(admin, email);
  if (existing) return existing;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: BOT_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`Failed to create ${email}: ${error?.message}`);
  return data.user.id;
}

/**
 * Deterministically pick `count` playable players (not prospects, not in live
 * games today). Sorted by id so the same selection repeats across test runs.
 */
async function pickLifecyclePlayers(
  admin: SupabaseClient,
  count: number,
): Promise<Array<{ id: string; position: string }>> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: live } = await admin
    .from('live_player_stats')
    .select('player_id')
    .eq('game_status', 2)
    .eq('game_date', today);
  const livePids = new Set((live ?? []).map((r) => r.player_id));

  const { data, error } = await admin
    .from('players')
    .select('id, position')
    .eq('is_prospect', false)
    .not('position', 'is', null)
    .not('pro_team', 'is', null)
    .order('id')
    .limit(count * 3);
  if (error) throw error;
  const usable = (data ?? []).filter((p) => !livePids.has(p.id) && p.position);
  if (usable.length < count) {
    throw new Error(`Not enough usable lifecycle players (${usable.length}/${count})`);
  }
  return usable.slice(0, count).map((p) => ({ id: p.id, position: p.position! }));
}

async function findExistingLifecycleLeague(
  admin: SupabaseClient,
  type: LeagueType,
): Promise<string | null> {
  const { data } = await admin
    .from('leagues')
    .select('id')
    .eq('name', LIFECYCLE_LEAGUE_NAME(type))
    .maybeSingle();
  return data?.id ?? null;
}

async function createLifecycleLeague(
  admin: SupabaseClient,
  type: LeagueType,
): Promise<LifecycleBootstrap> {
  // 1. Bots
  const botUserIds: string[] = [];
  for (let i = 1; i <= BOT_COUNT; i++) {
    botUserIds.push(await ensureBot(admin, BOT_EMAIL(i)));
  }
  const commissionerUserId = botUserIds[0];

  // 2. League
  const insertPayload: Record<string, any> = {
    name: LIFECYCLE_LEAGUE_NAME(type),
    created_by: commissionerUserId,
    season: LIFECYCLE_SEASON,
    teams: 4,
    current_teams: 4,
    roster_size: 20,
    waiver_type: 'none',
    waiver_period_days: 0,
    trade_deadline: null,
    position_limits: null,
    private: true,
    playoff_teams: 2,
    playoff_weeks: 1,
    regular_season_weeks: 4,
    league_type: type,
    rookie_draft_order: type === 'dynasty' ? 'lottery' : 'reverse_record',
    rookie_draft_rounds: 2,
    lottery_draws: 4,
    schedule_generated: true,
    offseason_step: null,
  };
  if (type === 'keeper') insertPayload.keeper_count = 2;
  const { data: league, error: leagueErr } = await admin
    .from('leagues')
    .insert(insertPayload)
    .select('id')
    .single();
  if (leagueErr || !league) throw new Error(`Create lifecycle league failed: ${leagueErr?.message}`);
  const leagueId = league.id;

  // 3. Teams (bot1 commissioner)
  const teamInserts = botUserIds.map((uid, i) => ({
    league_id: leagueId,
    user_id: uid,
    name: BOT_TEAM_NAME(i + 1),
    tricode: `LC${i + 1}`,
    is_commissioner: i === 0,
  }));
  const { data: teams, error: teamErr } = await admin
    .from('teams')
    .insert(teamInserts)
    .select('id, name, user_id');
  if (teamErr || !teams) throw new Error(`Create lifecycle teams failed: ${teamErr?.message}`);

  const orderedTeams = teams
    .map((t) => {
      const botMatch = t.name.match(/^Test Bot (\d+)$/);
      const botIndex = botMatch ? parseInt(botMatch[1], 10) : 0;
      return { id: t.id, name: t.name, userId: t.user_id ?? '', botIndex };
    })
    .sort((a, b) => a.botIndex - b.botIndex);

  // 4. Canonical roster — 2 players per team
  const playersPerTeam = 2;
  const picked = await pickLifecyclePlayers(admin, orderedTeams.length * playersPerTeam);
  const canonicalPlayerIds: string[][] = [];
  for (let i = 0; i < orderedTeams.length; i++) {
    canonicalPlayerIds.push(
      picked.slice(i * playersPerTeam, (i + 1) * playersPerTeam).map((p) => p.id),
    );
  }

  return {
    leagueId,
    commissionerUserId,
    type,
    teams: orderedTeams,
    canonicalPlayerIds,
  };
}

async function loadLifecycleLeague(
  admin: SupabaseClient,
  leagueId: string,
  type: LeagueType,
): Promise<LifecycleBootstrap> {
  const [{ data: leagueRow }, { data: teams }] = await Promise.all([
    admin.from('leagues').select('created_by').eq('id', leagueId).single(),
    admin.from('teams').select('id, name, user_id').eq('league_id', leagueId),
  ]);
  if (!leagueRow) throw new Error('Lifecycle league missing after lookup');

  const orderedTeams = (teams ?? [])
    .map((t) => {
      const botMatch = t.name.match(/^Test Bot (\d+)$/);
      const botIndex = botMatch ? parseInt(botMatch[1], 10) : 0;
      return { id: t.id, name: t.name, userId: t.user_id ?? '', botIndex };
    })
    .sort((a, b) => a.botIndex - b.botIndex);

  // Re-derive canonical player IDs deterministically — same source order as first creation.
  const playersPerTeam = 2;
  const picked = await pickLifecyclePlayers(admin, orderedTeams.length * playersPerTeam);
  const canonicalPlayerIds: string[][] = [];
  for (let i = 0; i < orderedTeams.length; i++) {
    canonicalPlayerIds.push(
      picked.slice(i * playersPerTeam, (i + 1) * playersPerTeam).map((p) => p.id),
    );
  }

  return {
    leagueId,
    commissionerUserId: leagueRow.created_by,
    type,
    teams: orderedTeams,
    canonicalPlayerIds,
  };
}

/**
 * Idempotent bootstrap for a lifecycle test league of the given type. Creates
 * the league + 4 bot teams + canonical roster mapping if missing; otherwise
 * reuses. The league starts in regular-season state (offseason_step=null) and
 * callers should use resetToSeasonComplete() before each test.
 */
export async function bootstrapLifecycleLeague(
  type: LeagueType,
): Promise<LifecycleBootstrap> {
  const admin = adminClient();
  const existing = await findExistingLifecycleLeague(admin, type);
  if (existing) return loadLifecycleLeague(admin, existing, type);
  return createLifecycleLeague(admin, type);
}

/**
 * Rewinds a lifecycle league to the exact state advance-season expects:
 *  - offseason_step = null
 *  - season = LIFECYCLE_SEASON
 *  - teams[*] wins/losses/PF/PA set per LIFECYCLE_STANDINGS
 *  - rosters restored to canonical (every player on canonical team, slot=BE)
 *  - a completed playoff bracket with team1 champion + team2 runner-up
 *  - no team_seasons, no lottery_results, no rookie drafts, no draft_picks,
 *    no keeper_declarations for this season
 *
 * Safe to call in beforeEach; rolls forward as needed regardless of prior state.
 */
export async function resetToSeasonComplete(
  bootstrap: LifecycleBootstrap,
): Promise<void> {
  const admin = adminClient();
  const { leagueId, teams, canonicalPlayerIds, type } = bootstrap;

  // 1. Clear advance-season artifacts
  await admin.from('team_seasons').delete().eq('league_id', leagueId);
  await admin.from('lottery_results').delete().eq('league_id', leagueId);
  await admin.from('keeper_declarations').delete().eq('league_id', leagueId);
  await admin.from('draft_picks').delete().eq('league_id', leagueId);
  await admin.from('drafts').delete().eq('league_id', leagueId);

  // 2. Reset team stats per LIFECYCLE_STANDINGS
  for (const row of LIFECYCLE_STANDINGS) {
    const team = teams.find((t) => t.botIndex === row.botIndex);
    if (!team) continue;
    await admin
      .from('teams')
      .update({
        wins: row.wins,
        losses: row.losses,
        ties: 0,
        points_for: row.points_for,
        points_against: row.points_against,
        streak: '',
      })
      .eq('id', team.id);
  }

  // 3. Restore rosters. Nuke then re-insert fresh from canonical.
  await admin.from('league_players').delete().eq('league_id', leagueId);

  const flatIds = canonicalPlayerIds.flat();
  const { data: playerRows } = await admin
    .from('players')
    .select('id, position')
    .in('id', flatIds);
  const posMap = new Map((playerRows ?? []).map((p) => [p.id, p.position ?? 'UTIL']));

  const now = new Date().toISOString();
  const rosterRows: any[] = [];
  teams.forEach((team, ti) => {
    for (const pid of canonicalPlayerIds[ti]) {
      rosterRows.push({
        league_id: leagueId,
        team_id: team.id,
        player_id: pid,
        position: posMap.get(pid) ?? 'UTIL',
        roster_slot: 'BE',
        acquired_via: 'test_lifecycle',
        acquired_at: now,
      });
    }
  });
  if (rosterRows.length > 0) {
    const { error } = await admin.from('league_players').insert(rosterRows);
    if (error) throw new Error(`Lifecycle roster restore failed: ${error.message}`);
  }

  // 4. Reset league row: season back to LIFECYCLE_SEASON, schedule flag, offseason cleared
  await admin
    .from('leagues')
    .update({
      season: LIFECYCLE_SEASON,
      offseason_step: null,
      schedule_generated: true,
      champion_team_id: null,
      lottery_status: null,
      lottery_date: null,
      league_type: type,
      rookie_draft_order: type === 'dynasty' ? 'lottery' : 'reverse_record',
    })
    .eq('id', leagueId);

  // Ensure a league chat exists — advance-season tries to post an announcement.
  // The edge function guards missing chat, but seeding keeps the path realistic.
  const { data: existingChat } = await admin
    .from('chat_conversations')
    .select('id')
    .eq('league_id', leagueId)
    .eq('type', 'league')
    .maybeSingle();
  if (!existingChat) {
    await admin
      .from('chat_conversations')
      .insert({ league_id: leagueId, type: 'league' });
  }

  // 5. Re-seed playoff bracket: 2-team bracket = single round-1 championship,
  //    team1 vs team2, team1 winner. Teams 3/4 are excluded → lottery pool.
  await admin.from('playoff_bracket').delete().eq('league_id', leagueId);
  const teamByBot = new Map(teams.map((t) => [t.botIndex, t]));
  const champ = teamByBot.get(1)!;
  const runnerUp = teamByBot.get(2)!;
  await admin.from('playoff_bracket').insert({
    league_id: leagueId,
    season: LIFECYCLE_SEASON,
    round: 1,
    bracket_position: 1,
    team_a_id: champ.id,
    team_a_seed: 1,
    team_b_id: runnerUp.id,
    team_b_seed: 2,
    winner_id: champ.id,
    is_bye: false,
    is_third_place: false,
  });

  // 6. Dynasty leagues need `draft_picks` rows for the upcoming season to exist
  //    BEFORE start-lottery runs (lottery updates slot_number/pick_number on
  //    existing rows; it doesn't create them). In production these rows are
  //    created at league creation or after the prior rookie draft. Seed them
  //    here so the test mirrors that state. 4 teams × 2 rounds = 8 rows,
  //    draft_id=null, each pick owned by its originating team.
  if (type === 'dynasty') {
    const nextSeason = '2027-28';
    const rows: any[] = [];
    for (let round = 1; round <= 2; round++) {
      teams.forEach((team, slotIdx) => {
        rows.push({
          league_id: leagueId,
          season: nextSeason,
          round,
          original_team_id: team.id,
          current_team_id: team.id,
          slot_number: slotIdx + 1,
          pick_number: (round - 1) * teams.length + (slotIdx + 1),
        });
      });
    }
    await admin.from('draft_picks').insert(rows);
  }
}

/**
 * Wipe rate_limits rows for a user + specific edge function names. Tests fire
 * commissioner-only functions much faster than the 3-per-5-minutes cap allows,
 * so we reset the bucket before each test.
 */
export async function clearRateLimits(
  userId: string,
  functionNames: string[],
): Promise<void> {
  const admin = adminClient();
  await admin
    .from('rate_limits')
    .delete()
    .eq('user_id', userId)
    .in('function_name', functionNames);
}

/**
 * Hard-delete a lifecycle league + its children. Used by _nuke tooling.
 */
export async function nukeLifecycleLeague(type: LeagueType): Promise<void> {
  const admin = adminClient();
  const { data: league } = await admin
    .from('leagues')
    .select('id')
    .eq('name', LIFECYCLE_LEAGUE_NAME(type))
    .maybeSingle();
  if (!league) return;
  const leagueId = league.id;

  const { data: teams } = await admin.from('teams').select('id').eq('league_id', leagueId);
  const teamIds = (teams ?? []).map((t) => t.id);

  const { data: drafts } = await admin
    .from('drafts')
    .select('id')
    .eq('league_id', leagueId);
  const draftIds = (drafts ?? []).map((d) => d.id);

  if (draftIds.length > 0) {
    await admin.from('draft_team_status').delete().in('draft_id', draftIds);
    await admin.from('draft_queue').delete().in('draft_id', draftIds);
  }
  await admin.from('draft_picks').delete().eq('league_id', leagueId);
  await admin.from('drafts').delete().eq('league_id', leagueId);
  await admin.from('playoff_bracket').delete().eq('league_id', leagueId);
  await admin.from('team_seasons').delete().eq('league_id', leagueId);
  await admin.from('lottery_results').delete().eq('league_id', leagueId);
  await admin.from('keeper_declarations').delete().eq('league_id', leagueId);
  await admin.from('league_players').delete().eq('league_id', leagueId);
  await admin.from('league_transactions').delete().eq('league_id', leagueId);

  const { data: conversations } = await admin
    .from('chat_conversations')
    .select('id')
    .eq('league_id', leagueId);
  const convIds = (conversations ?? []).map((c) => c.id);
  if (convIds.length > 0) {
    await admin.from('chat_messages').delete().in('conversation_id', convIds);
    await admin.from('chat_members').delete().in('conversation_id', convIds);
  }
  await admin.from('chat_conversations').delete().eq('league_id', leagueId);

  if (teamIds.length > 0) {
    await admin.from('teams').delete().in('id', teamIds);
  }
  await admin.from('leagues').delete().eq('id', leagueId);
}
