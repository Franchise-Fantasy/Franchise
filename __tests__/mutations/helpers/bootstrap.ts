import { SupabaseClient } from '@supabase/supabase-js';
import { adminClient } from './clients';
import {
  TEST_LEAGUE_NAME,
  TEST_LEAGUE_SEASON,
  WATCHER_EMAIL,
  BOT_COUNT,
  BOT_EMAIL,
  BOT_PASSWORD,
  BOT_TEAM_NAME,
  WATCHER_TEAM_NAME,
} from './config';

export interface BootstrapResult {
  leagueId: string;
  commissionerUserId: string;
  teams: { id: string; name: string; userId: string; botIndex: number | 'watcher' }[];
  leagueChatId: string;
}

async function findUserByEmail(admin: SupabaseClient, email: string): Promise<string | null> {
  // admin.auth.admin.listUsers paginates; emails are unique so page 1 with filter is enough.
  // Supabase JS lacks a direct "get by email" so we iterate the first ~1000 users.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function ensureBotUser(admin: SupabaseClient, email: string): Promise<string> {
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

async function findExistingLeague(admin: SupabaseClient): Promise<string | null> {
  const { data, error } = await admin
    .from('leagues')
    .select('id')
    .eq('name', TEST_LEAGUE_NAME)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

async function ensureLeagueChat(
  admin: SupabaseClient,
  leagueId: string,
  teamIds: string[],
): Promise<string> {
  const { data: existing } = await admin
    .from('chat_conversations')
    .select('id')
    .eq('league_id', leagueId)
    .eq('type', 'league')
    .maybeSingle();

  let chatId = existing?.id as string | undefined;
  if (!chatId) {
    const { data: created, error } = await admin
      .from('chat_conversations')
      .insert({ league_id: leagueId, type: 'league' })
      .select('id')
      .single();
    if (error || !created) throw new Error(`Create league chat failed: ${error?.message}`);
    chatId = created.id;
  }

  // Ensure every team is a member. Idempotent via upsert + ignoreDuplicates.
  const memberRows = teamIds.map((tid) => ({ conversation_id: chatId!, team_id: tid }));
  const { error: memberErr } = await admin
    .from('chat_members')
    .upsert(memberRows, { onConflict: 'conversation_id,team_id', ignoreDuplicates: true });
  if (memberErr) throw new Error(`Ensure chat members failed: ${memberErr.message}`);

  return chatId!;
}

async function loadLeague(admin: SupabaseClient, leagueId: string): Promise<BootstrapResult> {
  const [{ data: league }, { data: teams }] = await Promise.all([
    admin.from('leagues').select('created_by').eq('id', leagueId).single(),
    admin.from('teams').select('id, name, user_id').eq('league_id', leagueId),
  ]);
  if (!league) throw new Error('Test league missing after lookup');

  const teamList = (teams ?? []).map((t) => {
    const botMatch = t.name.match(/^Test Bot (\d+)$/);
    const botIndex: number | 'watcher' = botMatch ? parseInt(botMatch[1], 10) : 'watcher';
    return { id: t.id, name: t.name, userId: t.user_id ?? '', botIndex };
  });

  const leagueChatId = await ensureLeagueChat(admin, leagueId, teamList.map((t) => t.id));

  return {
    leagueId,
    commissionerUserId: league.created_by,
    teams: teamList,
    leagueChatId,
  };
}

async function pickBenchPlayers(admin: SupabaseClient, count: number): Promise<string[]> {
  // Avoid players in live games — execute-trade delays trades with active players.
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
    .limit(count * 4);
  if (error) throw error;
  const usable = (data ?? []).filter((p) => !livePids.has(p.id));
  if (usable.length < count) throw new Error(`Not enough usable players (${usable.length}/${count})`);
  return usable.slice(0, count).map((p) => p.id);
}

async function seedLeague(admin: SupabaseClient): Promise<BootstrapResult> {
  // 1. Create bot users (idempotent)
  const botUserIds: string[] = [];
  for (let i = 1; i <= BOT_COUNT; i++) {
    botUserIds.push(await ensureBotUser(admin, BOT_EMAIL(i)));
  }

  // 2. Find watcher (jjspoels@gmail.com) — don't create; they already have an account
  const watcherUserId = await findUserByEmail(admin, WATCHER_EMAIL);

  const commissionerUserId = botUserIds[0];

  // 3. Create league (bot1 is commissioner)
  const totalTeams = BOT_COUNT + (watcherUserId ? 1 : 0);
  const { data: league, error: leagueErr } = await admin
    .from('leagues')
    .insert({
      name: TEST_LEAGUE_NAME,
      created_by: commissionerUserId,
      season: TEST_LEAGUE_SEASON,
      teams: totalTeams,
      current_teams: totalTeams,
      roster_size: 20,
      waiver_type: 'none',
      waiver_period_days: 0,
      trade_deadline: null,
      position_limits: null,
      private: true,
      playoff_teams: 4,
      playoff_weeks: 2,
      regular_season_weeks: 20,
    })
    .select('id')
    .single();
  if (leagueErr || !league) throw new Error(`Create league failed: ${leagueErr?.message}`);
  const leagueId = league.id;

  // 4. Create teams
  const teamInserts = botUserIds.map((uid, i) => ({
    league_id: leagueId,
    user_id: uid,
    name: BOT_TEAM_NAME(i + 1),
    tricode: `BT${i + 1}`,
    is_commissioner: i === 0,
  }));
  if (watcherUserId) {
    teamInserts.push({
      league_id: leagueId,
      user_id: watcherUserId,
      name: WATCHER_TEAM_NAME,
      tricode: 'JOE',
      is_commissioner: false,
    });
  }
  const { data: teams, error: teamErr } = await admin
    .from('teams')
    .insert(teamInserts)
    .select('id, name, user_id');
  if (teamErr || !teams) throw new Error(`Create teams failed: ${teamErr?.message}`);

  // 5. Seed rosters — 4 players per team
  const playersPerTeam = 4;
  const playerIds = await pickBenchPlayers(admin, teams.length * playersPerTeam);
  const { data: playerRows } = await admin
    .from('players')
    .select('id, position')
    .in('id', playerIds);
  const posMap = new Map((playerRows ?? []).map((p) => [p.id, p.position]));

  const rosterInserts: any[] = [];
  const now = new Date().toISOString();
  teams.forEach((team, ti) => {
    for (let pi = 0; pi < playersPerTeam; pi++) {
      const pid = playerIds[ti * playersPerTeam + pi];
      rosterInserts.push({
        league_id: leagueId,
        team_id: team.id,
        player_id: pid,
        position: posMap.get(pid) ?? 'UTIL',
        roster_slot: 'BE',
        acquired_at: now,
        acquired_via: 'test_seed',
      });
    }
  });
  const { error: rosterErr } = await admin.from('league_players').insert(rosterInserts);
  if (rosterErr) throw new Error(`Seed rosters failed: ${rosterErr.message}`);

  // 6. Ensure league chat + members (may have been auto-created by a trigger on league insert)
  const leagueChatId = await ensureLeagueChat(admin, leagueId, teams.map((t) => t.id));

  // 7. Snapshot canonical rosters so restoreCanonicalRosters can reset to this
  //    exact state regardless of what prior test runs did.
  const canonical: Record<string, string[]> = {};
  teams.forEach((team, ti) => {
    canonical[team.id] = [];
    for (let pi = 0; pi < playersPerTeam; pi++) {
      canonical[team.id].push(playerIds[ti * playersPerTeam + pi]);
    }
  });
  await admin
    .from('leagues')
    .update({ lottery_odds: { canonical_rosters: canonical } })
    .eq('id', leagueId);

  return {
    leagueId,
    commissionerUserId,
    leagueChatId,
    teams: teams.map((t) => {
      const botMatch = t.name.match(/^Test Bot (\d+)$/);
      const botIndex: number | 'watcher' = botMatch ? parseInt(botMatch[1], 10) : 'watcher';
      return { id: t.id, name: t.name, userId: t.user_id ?? '', botIndex };
    }),
  };
}

/**
 * Idempotent bootstrap. If the test league already exists, returns a handle to it
 * without mutating anything. Otherwise creates users + league + teams + rosters.
 */
export async function bootstrapTestLeague(): Promise<BootstrapResult> {
  const admin = adminClient();
  const existing = await findExistingLeague(admin);
  if (existing) return loadLeague(admin, existing);
  return seedLeague(admin);
}
