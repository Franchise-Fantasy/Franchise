import { SupabaseClient } from '@supabase/supabase-js';

import { adminClient, signInAsBot } from '../helpers/clients';
import { BOT_EMAIL, BOT_PASSWORD } from '../helpers/config';

/**
 * Exercises the league-invitation feature:
 *   - create_league_invite      — service-role upsert (edge fn's write path)
 *   - respond_to_league_invite  — invitee declines (accept is trigger-driven)
 *   - cancel_league_invite      — commissioner cancels
 *   - teams_auto_accept_invite  — membership commit flips pending → accepted
 *   - invitations RLS           — invitee reads own, commissioner reads league's
 *   - archive_league            — cancels dangling pending invites
 *   - send-league-invite edge   — persist + notify happy path, no_account
 *
 * bot1 = commissioner, bot2 = member, bot3/bot4 = non-members used as invitees.
 * A dedicated scratch league keeps this isolated from the shared fixture.
 */

const LEAGUE_NAME = '__TEST__ Invites';
const SEASON = '2026-27';
const TIMEOUT = 45_000;

interface ScratchLeague {
  leagueId: string;
  botUserIds: string[]; // index 0 = commissioner (bot1)
  team1Id: string; // bot1
  team2Id: string; // bot2
}

async function findUserByEmail(admin: SupabaseClient, email: string): Promise<string | null> {
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
  const { data, error } = await admin.auth.admin.createUser({ email, password: BOT_PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error(`Failed to create ${email}: ${error?.message}`);
  return data.user.id;
}

async function bootstrap(): Promise<ScratchLeague> {
  const admin = adminClient();
  const botUserIds: string[] = [];
  for (let i = 1; i <= 4; i++) botUserIds.push(await ensureBot(admin, BOT_EMAIL(i)));

  const { data: existing } = await admin.from('leagues').select('id').eq('name', LEAGUE_NAME).maybeSingle();
  let leagueId: string;
  if (existing?.id) {
    leagueId = existing.id;
  } else {
    const { data: league, error } = await admin
      .from('leagues')
      .insert({
        name: LEAGUE_NAME,
        created_by: botUserIds[0],
        season: SEASON,
        teams: 6,
        current_teams: 2,
        roster_size: 20,
        waiver_type: 'standard',
        waiver_period_days: 2,
        private: true,
        playoff_teams: 4,
        playoff_weeks: 2,
        regular_season_weeks: 20,
      })
      .select('id')
      .single();
    if (error || !league) throw new Error(`Create scratch league failed: ${error?.message}`);
    leagueId = league.id;
  }

  // Two stable member teams. Recover ids even if a prior run mutated them.
  const { data: teams } = await admin.from('teams').select('id, name').eq('league_id', leagueId);
  const byName = new Map((teams ?? []).map((t) => [t.name, t.id]));
  if (!byName.has('Bot 1') || !byName.has('Bot 2')) {
    await admin.from('invitations').delete().eq('league_id', leagueId);
    await admin.from('teams').delete().eq('league_id', leagueId);
    const { data: created, error } = await admin
      .from('teams')
      .insert([
        { league_id: leagueId, user_id: botUserIds[0], name: 'Bot 1', tricode: 'B1', is_commissioner: true },
        { league_id: leagueId, user_id: botUserIds[1], name: 'Bot 2', tricode: 'B2', is_commissioner: false },
      ])
      .select('id, name');
    if (error || !created) throw new Error(`Create scratch teams failed: ${error?.message}`);
    byName.clear();
    for (const t of created) byName.set(t.name, t.id);
  }

  return { leagueId, botUserIds, team1Id: byName.get('Bot 1')!, team2Id: byName.get('Bot 2')! };
}

async function resetState(s: ScratchLeague): Promise<void> {
  const admin = adminClient();
  // Invitations first — resetting team ownership would otherwise trip the
  // auto-accept trigger on any lingering pending rows.
  await admin.from('invitations').delete().eq('league_id', s.leagueId);
  // Drop any teams created by trigger/join tests (keep the two fixtures).
  await admin
    .from('teams')
    .delete()
    .eq('league_id', s.leagueId)
    .not('id', 'in', `(${s.team1Id},${s.team2Id})`);
  await admin.from('teams').update({ user_id: s.botUserIds[0], is_commissioner: true }).eq('id', s.team1Id);
  await admin.from('teams').update({ user_id: s.botUserIds[1], is_commissioner: false }).eq('id', s.team2Id);
  await admin
    .from('leagues')
    .update({ created_by: s.botUserIds[0], commissioner: s.botUserIds[0], archived_at: null, archived_by: null, current_teams: 2 })
    .eq('id', s.leagueId);
}

async function seedInvite(s: ScratchLeague, invitedUserId: string, email: string, teamId: string | null = null): Promise<string> {
  const admin = adminClient();
  const { data, error } = await admin.rpc('create_league_invite', {
    p_league_id: s.leagueId,
    p_invited_user_id: invitedUserId,
    p_invited_email: email,
    p_invited_by: s.botUserIds[0],
    p_team_id: teamId,
  });
  if (error) throw new Error(`seedInvite failed: ${error.message}`);
  return data as unknown as string;
}

describe('league invitations', () => {
  let s: ScratchLeague;

  beforeAll(async () => {
    s = await bootstrap();
  }, TIMEOUT);

  beforeEach(async () => {
    await resetState(s);
  }, TIMEOUT);

  describe('create_league_invite (service-role)', () => {
    it('creates a pending invite and upserts a resend in place (no duplicate)', async () => {
      const admin = adminClient();
      const id1 = await seedInvite(s, s.botUserIds[2], BOT_EMAIL(3));
      const id2 = await seedInvite(s, s.botUserIds[2], BOT_EMAIL(3)); // resend
      expect(id2).toBe(id1); // same row, ON CONFLICT DO UPDATE

      const { data, count } = await admin
        .from('invitations')
        .select('status', { count: 'exact' })
        .eq('league_id', s.leagueId)
        .eq('invited_user_id', s.botUserIds[2]);
      expect(count).toBe(1);
      expect(data?.[0]?.status).toBe('pending');
    }, TIMEOUT);
  });

  describe('invitations RLS', () => {
    it('invitee reads own invite; an unrelated user cannot; commissioner sees the league set', async () => {
      await seedInvite(s, s.botUserIds[2], BOT_EMAIL(3));

      const bot3 = await signInAsBot(3);
      const { data: mine } = await bot3.from('invitations').select('id').eq('league_id', s.leagueId);
      expect(mine?.length).toBe(1);

      const bot4 = await signInAsBot(4);
      const { data: theirs } = await bot4.from('invitations').select('id').eq('league_id', s.leagueId);
      expect(theirs?.length ?? 0).toBe(0);

      const bot1 = await signInAsBot(1);
      const { data: commish } = await bot1.from('invitations').select('id').eq('league_id', s.leagueId);
      expect(commish?.length).toBe(1);
    }, TIMEOUT);
  });

  describe('respond_to_league_invite (decline)', () => {
    it('lets the invitee decline their own pending invite', async () => {
      const admin = adminClient();
      const inviteId = await seedInvite(s, s.botUserIds[2], BOT_EMAIL(3));

      const bot3 = await signInAsBot(3);
      const { data, error } = await bot3.rpc('respond_to_league_invite', { p_invite_id: inviteId, p_action: 'decline' });
      expect(error).toBeNull();
      expect(data).toMatchObject({ ok: true });

      const { data: row } = await admin.from('invitations').select('status').eq('id', inviteId).single();
      expect(row?.status).toBe('declined');
    }, TIMEOUT);

    it('does not let a different user decline the invite', async () => {
      const admin = adminClient();
      const inviteId = await seedInvite(s, s.botUserIds[2], BOT_EMAIL(3));

      const bot4 = await signInAsBot(4);
      const { data } = await bot4.rpc('respond_to_league_invite', { p_invite_id: inviteId, p_action: 'decline' });
      expect(data).toMatchObject({ error: 'not_found_or_not_pending' });

      const { data: row } = await admin.from('invitations').select('status').eq('id', inviteId).single();
      expect(row?.status).toBe('pending'); // untouched
    }, TIMEOUT);

    it('rejects an unsupported action', async () => {
      const inviteId = await seedInvite(s, s.botUserIds[2], BOT_EMAIL(3));
      const bot3 = await signInAsBot(3);
      const { error } = await bot3.rpc('respond_to_league_invite', { p_invite_id: inviteId, p_action: 'accept' });
      expect(error).not.toBeNull();
    }, TIMEOUT);
  });

  describe('cancel_league_invite', () => {
    it('lets the commissioner cancel a pending invite', async () => {
      const admin = adminClient();
      const inviteId = await seedInvite(s, s.botUserIds[2], BOT_EMAIL(3));

      const bot1 = await signInAsBot(1);
      const { data, error } = await bot1.rpc('cancel_league_invite', { p_invite_id: inviteId });
      expect(error).toBeNull();
      expect(data).toMatchObject({ ok: true });

      const { data: row } = await admin.from('invitations').select('status').eq('id', inviteId).single();
      expect(row?.status).toBe('cancelled');
    }, TIMEOUT);

    it('rejects a non-commissioner caller', async () => {
      const admin = adminClient();
      const inviteId = await seedInvite(s, s.botUserIds[2], BOT_EMAIL(3));

      const bot2 = await signInAsBot(2);
      const { error } = await bot2.rpc('cancel_league_invite', { p_invite_id: inviteId });
      expect(error).not.toBeNull();

      const { data: row } = await admin.from('invitations').select('status').eq('id', inviteId).single();
      expect(row?.status).toBe('pending'); // untouched
    }, TIMEOUT);
  });

  describe('teams_auto_accept_invite trigger', () => {
    it('flips a pending invite to accepted when the invitee gets a team', async () => {
      const admin = adminClient();
      const inviteId = await seedInvite(s, s.botUserIds[2], BOT_EMAIL(3));

      // Simulate the membership commit (claim/join both end in a teams.user_id write).
      const { error } = await admin
        .from('teams')
        .insert({ league_id: s.leagueId, user_id: s.botUserIds[2], name: 'Bot 3', tricode: 'B3', is_commissioner: false });
      expect(error).toBeNull();

      const { data: row } = await admin.from('invitations').select('status, responded_at').eq('id', inviteId).single();
      expect(row?.status).toBe('accepted');
      expect(row?.responded_at).not.toBeNull();
    }, TIMEOUT);

    it('does NOT flip an invite when a team is vacated (user_id -> NULL)', async () => {
      const admin = adminClient();
      const inviteId = await seedInvite(s, s.botUserIds[1], BOT_EMAIL(2)); // bot2 already a member
      // Vacate bot2's team — must not touch the invite.
      await admin.from('teams').update({ user_id: null }).eq('id', s.team2Id);
      const { data: row } = await admin.from('invitations').select('status').eq('id', inviteId).single();
      expect(row?.status).toBe('pending');
    }, TIMEOUT);
  });

  describe('archive_league cancels dangling invites', () => {
    it('cancels pending invites when the league is archived', async () => {
      const admin = adminClient();
      const inviteId = await seedInvite(s, s.botUserIds[2], BOT_EMAIL(3));

      const bot1 = await signInAsBot(1);
      const { error } = await bot1.rpc('archive_league', { p_league_id: s.leagueId });
      expect(error).toBeNull();

      const { data: row } = await admin.from('invitations').select('status').eq('id', inviteId).single();
      expect(row?.status).toBe('cancelled');
    }, TIMEOUT);
  });

  describe('send-league-invite edge function', () => {
    it('persists a pending invite and reports notified for an account-holder', async () => {
      const admin = adminClient();
      const bot1 = await signInAsBot(1);
      const { data, error } = await bot1.functions.invoke('send-league-invite', {
        body: { league_id: s.leagueId, email: BOT_EMAIL(3) },
      });
      expect(error).toBeNull();
      expect((data as { status?: string })?.status).toBe('notified');

      const { count } = await admin
        .from('invitations')
        .select('id', { count: 'exact', head: true })
        .eq('league_id', s.leagueId)
        .eq('invited_user_id', s.botUserIds[2])
        .eq('status', 'pending');
      expect(count).toBe(1);
    }, TIMEOUT);

    it('returns no_account and creates no row for an unknown email', async () => {
      const admin = adminClient();
      const bot1 = await signInAsBot(1);
      const { data, error } = await bot1.functions.invoke('send-league-invite', {
        body: { league_id: s.leagueId, email: 'definitely-not-a-user-9f83@example.com' },
      });
      expect(error).toBeNull();
      expect((data as { status?: string })?.status).toBe('no_account');

      const { count } = await admin
        .from('invitations')
        .select('id', { count: 'exact', head: true })
        .eq('league_id', s.leagueId);
      expect(count).toBe(0);
    }, TIMEOUT);
  });
});
