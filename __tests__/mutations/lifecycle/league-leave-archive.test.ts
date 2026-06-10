import { SupabaseClient } from '@supabase/supabase-js';

import { adminClient, cronInvoke, signInAsBot } from '../helpers/clients';
import { BOT_EMAIL, BOT_PASSWORD } from '../helpers/config';

/**
 * Exercises the membership-lifecycle RPCs added with the leave/archive feature:
 *   - leave_league          — vacate the caller's team (kept, not deleted)
 *   - reassign_commissioner — hand the gavel to another member
 *   - archive_league        — soft-delete (RLS-hidden, support-restorable)
 *
 * Uses a dedicated scratch league (`__TEST__ Leave Archive`) so the destructive
 * ops don't corrupt the shared mutation fixture. State is reset before each test.
 */

const LEAGUE_NAME = '__TEST__ Leave Archive';
const SEASON = '2026-27';
const TIMEOUT = 45_000;
const NON_MEMBER_UUID = '00000000-0000-0000-0000-000000000000';

interface ScratchLeague {
  leagueId: string;
  botUserIds: string[]; // index 0 = commissioner
  teamIds: string[]; // aligned with botUserIds
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

async function bootstrapScratchLeague(): Promise<ScratchLeague> {
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
        teams: 4,
        current_teams: 4,
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

  // Teams are keyed by stable name (Bot 1..4) so we can recover ids even if a
  // prior run left them vacated (user_id NULL). resetMembership re-owns them.
  const names = [1, 2, 3, 4].map((i) => `Bot ${i}`);
  const { data: teams } = await admin.from('teams').select('id, name').eq('league_id', leagueId);
  const byName = new Map((teams ?? []).map((t) => [t.name, t.id]));
  let teamIds: string[];
  if (names.some((n) => !byName.has(n))) {
    await admin.from('teams').delete().eq('league_id', leagueId);
    const inserts = botUserIds.map((uid, i) => ({
      league_id: leagueId,
      user_id: uid,
      name: `Bot ${i + 1}`,
      tricode: `B${i + 1}`,
      is_commissioner: i === 0,
    }));
    const { data: created, error } = await admin.from('teams').insert(inserts).select('id, name');
    if (error || !created) throw new Error(`Create scratch teams failed: ${error?.message}`);
    teamIds = names.map((n) => created.find((t) => t.name === n)!.id);
  } else {
    teamIds = names.map((n) => byName.get(n)!);
  }

  return { leagueId, botUserIds, teamIds };
}

async function resetMembership(s: ScratchLeague): Promise<void> {
  const admin = adminClient();
  const { leagueId, botUserIds, teamIds } = s;
  for (let i = 0; i < teamIds.length; i++) {
    await admin.from('teams').update({ user_id: botUserIds[i], is_commissioner: i === 0 }).eq('id', teamIds[i]);
  }
  await admin
    .from('leagues')
    .update({ created_by: botUserIds[0], commissioner: botUserIds[0], archived_at: null, archived_by: null, current_teams: 4 })
    .eq('id', leagueId);
  await admin.from('drafts').delete().eq('league_id', leagueId);
  await admin.from('pending_transactions').delete().eq('league_id', leagueId);
  await admin.from('waiver_claims').delete().eq('league_id', leagueId);
  await admin.from('waiver_priority').delete().eq('league_id', leagueId);
  const { data: props } = await admin.from('trade_proposals').select('id').eq('league_id', leagueId);
  const propIds = (props ?? []).map((p) => p.id);
  if (propIds.length) {
    await admin.from('trade_proposal_teams').delete().in('proposal_id', propIds);
    await admin.from('trade_proposals').delete().in('id', propIds);
  }
  await admin.from('profiles').update({ favorite_league_id: null }).eq('favorite_league_id', leagueId);
}

describe('league leave / reassign / archive RPCs', () => {
  let s: ScratchLeague;

  beforeAll(async () => {
    s = await bootstrapScratchLeague();
  }, TIMEOUT);

  beforeEach(async () => {
    await resetMembership(s);
  }, TIMEOUT);

  describe('leave_league', () => {
    it('vacates the caller team but keeps the row and its slot', async () => {
      const admin = adminClient();
      const bot2 = await signInAsBot(2);
      const { data, error } = await bot2.rpc('leave_league', { p_league_id: s.leagueId });
      expect(error).toBeNull();
      expect(data).toMatchObject({ ok: true });

      const { data: team } = await admin.from('teams').select('user_id, is_commissioner').eq('id', s.teamIds[1]).single();
      expect(team?.user_id).toBeNull();
      expect(team?.is_commissioner).toBe(false);

      // Row still exists and current_teams is NOT decremented (slot stays filled).
      const { count } = await admin.from('teams').select('id', { count: 'exact', head: true }).eq('id', s.teamIds[1]);
      expect(count).toBe(1);
      const { data: league } = await admin.from('leagues').select('current_teams').eq('id', s.leagueId).single();
      expect(league?.current_teams).toBe(4);
    }, TIMEOUT);

    it("cancels the leaver's open trades and clears their waiver claims", async () => {
      const admin = adminClient();
      const { data: prop } = await admin
        .from('trade_proposals')
        .insert({ league_id: s.leagueId, proposed_by_team_id: s.teamIds[1], status: 'pending' })
        .select('id')
        .single();
      await admin.from('trade_proposal_teams').insert({ proposal_id: prop!.id, team_id: s.teamIds[1], status: 'pending' });

      const { data: player } = await admin
        .from('players')
        .select('id')
        .eq('is_prospect', false)
        .not('pro_team', 'is', null)
        .limit(1)
        .single();
      await admin
        .from('waiver_claims')
        .insert({ league_id: s.leagueId, team_id: s.teamIds[1], player_id: player!.id, priority: 1, status: 'pending' });

      const bot2 = await signInAsBot(2);
      const { error } = await bot2.rpc('leave_league', { p_league_id: s.leagueId });
      expect(error).toBeNull();

      const { data: propAfter } = await admin.from('trade_proposals').select('status').eq('id', prop!.id).single();
      expect(propAfter?.status).toBe('cancelled');
      const { count } = await admin.from('waiver_claims').select('id', { count: 'exact', head: true }).eq('team_id', s.teamIds[1]);
      expect(count).toBe(0);
    }, TIMEOUT);

    it('blocks the commissioner until they reassign', async () => {
      const bot1 = await signInAsBot(1);
      const { data, error } = await bot1.rpc('leave_league', { p_league_id: s.leagueId });
      expect(error).toBeNull();
      expect(data).toMatchObject({ error: 'commissioner_must_reassign' });
      const { data: team } = await adminClient().from('teams').select('user_id').eq('id', s.teamIds[0]).single();
      expect(team?.user_id).toBe(s.botUserIds[0]); // untouched
    }, TIMEOUT);

    it('blocks leaving while a draft is in progress', async () => {
      const admin = adminClient();
      await admin.from('drafts').insert({
        league_id: s.leagueId,
        season: SEASON,
        type: 'initial',
        draft_type: 'linear',
        status: 'in_progress',
        current_pick_number: 1,
        rounds: 2,
        picks_per_round: 4,
        time_limit: 60,
      });
      const bot2 = await signInAsBot(2);
      const { data } = await bot2.rpc('leave_league', { p_league_id: s.leagueId });
      expect(data).toMatchObject({ error: 'draft_in_progress' });
      const { data: team } = await admin.from('teams').select('user_id').eq('id', s.teamIds[1]).single();
      expect(team?.user_id).toBe(s.botUserIds[1]); // not vacated
    }, TIMEOUT);

    it('rejects a caller who is not a member', async () => {
      const bot2 = await signInAsBot(2);
      await bot2.rpc('leave_league', { p_league_id: s.leagueId });
      const { data } = await bot2.rpc('leave_league', { p_league_id: s.leagueId });
      expect(data).toMatchObject({ error: 'not_a_member' });
    }, TIMEOUT);
  });

  describe('reassign_commissioner', () => {
    it('hands off authority and flips is_commissioner flags', async () => {
      const admin = adminClient();
      const bot1 = await signInAsBot(1);
      const { data, error } = await bot1.rpc('reassign_commissioner', { p_league_id: s.leagueId, p_new_user_id: s.botUserIds[1] });
      expect(error).toBeNull();
      expect(data).toMatchObject({ ok: true });

      const { data: league } = await admin.from('leagues').select('created_by, commissioner').eq('id', s.leagueId).single();
      expect(league?.created_by).toBe(s.botUserIds[1]);
      expect(league?.commissioner).toBe(s.botUserIds[1]);

      const { data: teams } = await admin.from('teams').select('id, is_commissioner').eq('league_id', s.leagueId);
      const flag = new Map((teams ?? []).map((t) => [t.id, t.is_commissioner]));
      expect(flag.get(s.teamIds[1])).toBe(true);
      expect(flag.get(s.teamIds[0])).toBe(false);
      expect(flag.get(s.teamIds[2])).toBe(false);
    }, TIMEOUT);

    it('rejects a non-commissioner caller', async () => {
      const bot3 = await signInAsBot(3);
      const { error } = await bot3.rpc('reassign_commissioner', { p_league_id: s.leagueId, p_new_user_id: s.botUserIds[2] });
      expect(error).not.toBeNull();
      const { data: league } = await adminClient().from('leagues').select('created_by').eq('id', s.leagueId).single();
      expect(league?.created_by).toBe(s.botUserIds[0]);
    }, TIMEOUT);

    it('rejects a target who is not a member', async () => {
      const bot1 = await signInAsBot(1);
      const { data } = await bot1.rpc('reassign_commissioner', { p_league_id: s.leagueId, p_new_user_id: NON_MEMBER_UUID });
      expect(data).toMatchObject({ error: 'target_not_member' });
    }, TIMEOUT);

    it('rejects reassigning to self', async () => {
      const bot1 = await signInAsBot(1);
      const { data } = await bot1.rpc('reassign_commissioner', { p_league_id: s.leagueId, p_new_user_id: s.botUserIds[0] });
      expect(data).toMatchObject({ error: 'already_commissioner' });
    }, TIMEOUT);
  });

  describe('archive_league', () => {
    it('sets archived_at/by, clears favorites, and is RLS-hidden afterward', async () => {
      const admin = adminClient();
      await admin.from('profiles').update({ favorite_league_id: s.leagueId }).eq('id', s.botUserIds[1]);

      const bot1 = await signInAsBot(1);
      const { data, error } = await bot1.rpc('archive_league', { p_league_id: s.leagueId });
      expect(error).toBeNull();
      expect(data).toMatchObject({ ok: true });

      const { data: league } = await admin.from('leagues').select('archived_at, archived_by').eq('id', s.leagueId).single();
      expect(league?.archived_at).not.toBeNull();
      expect(league?.archived_by).toBe(s.botUserIds[0]);

      const { data: prof } = await admin.from('profiles').select('favorite_league_id').eq('id', s.botUserIds[1]).single();
      expect(prof?.favorite_league_id).toBeNull();

      // The tightened leagues_select RLS hides it from a member's own client.
      const bot2 = await signInAsBot(2);
      const { data: visible } = await bot2.from('leagues').select('id').eq('id', s.leagueId).maybeSingle();
      expect(visible).toBeNull();
    }, TIMEOUT);

    it('rejects a non-commissioner', async () => {
      const bot2 = await signInAsBot(2);
      const { error } = await bot2.rpc('archive_league', { p_league_id: s.leagueId });
      expect(error).not.toBeNull();
      const { data: league } = await adminClient().from('leagues').select('archived_at').eq('id', s.leagueId).single();
      expect(league?.archived_at).toBeNull();
    }, TIMEOUT);

    it('is idempotent', async () => {
      const bot1 = await signInAsBot(1);
      const first = await bot1.rpc('archive_league', { p_league_id: s.leagueId });
      expect(first.error).toBeNull();
      const { data: l1 } = await adminClient().from('leagues').select('archived_at').eq('id', s.leagueId).single();

      const second = await bot1.rpc('archive_league', { p_league_id: s.leagueId });
      expect(second.error).toBeNull();
      expect(second.data).toMatchObject({ ok: true });
      const { data: l2 } = await adminClient().from('leagues').select('archived_at').eq('id', s.leagueId).single();
      expect(l2?.archived_at).toBe(l1?.archived_at); // unchanged on the second call
    }, TIMEOUT);
  });

  describe('remove_member', () => {
    it("commissioner vacates another member's team (kept + unclaimed)", async () => {
      const admin = adminClient();
      const bot1 = await signInAsBot(1);
      const { data, error } = await bot1.rpc('remove_member', { p_league_id: s.leagueId, p_team_id: s.teamIds[1] });
      expect(error).toBeNull();
      expect(data).toMatchObject({ ok: true });

      const { data: team } = await admin.from('teams').select('user_id, is_commissioner').eq('id', s.teamIds[1]).single();
      expect(team?.user_id).toBeNull();
      const { count } = await admin.from('teams').select('id', { count: 'exact', head: true }).eq('id', s.teamIds[1]);
      expect(count).toBe(1); // row kept, just unclaimed
    }, TIMEOUT);

    it('rejects a non-commissioner caller', async () => {
      const bot2 = await signInAsBot(2);
      const { error } = await bot2.rpc('remove_member', { p_league_id: s.leagueId, p_team_id: s.teamIds[2] });
      expect(error).not.toBeNull();
      const { data: team } = await adminClient().from('teams').select('user_id').eq('id', s.teamIds[2]).single();
      expect(team?.user_id).toBe(s.botUserIds[2]); // untouched
    }, TIMEOUT);

    it("refuses to remove the commissioner's own team", async () => {
      const bot1 = await signInAsBot(1);
      const { data } = await bot1.rpc('remove_member', { p_league_id: s.leagueId, p_team_id: s.teamIds[0] });
      expect(data).toMatchObject({ error: 'cannot_remove_self' });
    }, TIMEOUT);

    it('rejects an already-unclaimed team', async () => {
      const admin = adminClient();
      await admin.from('teams').update({ user_id: null }).eq('id', s.teamIds[1]);
      const bot1 = await signInAsBot(1);
      const { data } = await bot1.rpc('remove_member', { p_league_id: s.leagueId, p_team_id: s.teamIds[1] });
      expect(data).toMatchObject({ error: 'already_unclaimed' });
    }, TIMEOUT);

    it('is blocked during a live draft', async () => {
      const admin = adminClient();
      await admin.from('drafts').insert({
        league_id: s.leagueId, season: SEASON, type: 'initial', draft_type: 'linear',
        status: 'in_progress', current_pick_number: 1, rounds: 2, picks_per_round: 4, time_limit: 60,
      });
      const bot1 = await signInAsBot(1);
      const { data } = await bot1.rpc('remove_member', { p_league_id: s.leagueId, p_team_id: s.teamIds[1] });
      expect(data).toMatchObject({ error: 'draft_in_progress' });
    }, TIMEOUT);
  });

  describe('cron guards (archived leagues)', () => {
    // start-draft is the one cron that takes a specific id, so it can be exercised
    // safely. The global crons (finalize-week, process-waivers, …) mutate every
    // league at once, so we don't invoke them against the shared DB — we instead
    // assert the working-set queries they rely on exclude archived leagues.
    it('start-draft refuses to start a draft in an archived league', async () => {
      const admin = adminClient();
      const pastDate = new Date(Date.now() - 3_600_000).toISOString();
      const { data: draft } = await admin
        .from('drafts')
        .insert({
          league_id: s.leagueId, season: SEASON, type: 'initial', draft_type: 'linear',
          status: 'pending', draft_date: pastDate, current_pick_number: 1, rounds: 2, picks_per_round: 4, time_limit: 60,
        })
        .select('id')
        .single();

      await admin.from('leagues').update({ archived_at: new Date().toISOString() }).eq('id', s.leagueId);

      const { data, status } = await cronInvoke('start-draft', { draft_id: draft!.id });
      expect(status).toBe(200);
      expect((data as { message?: string } | null)?.message ?? '').toMatch(/archived/i);

      const { data: after } = await admin.from('drafts').select('status').eq('id', draft!.id).single();
      expect(after?.status).toBe('pending'); // never started
    }, TIMEOUT);

    it('archived leagues are excluded from the cron working-set queries', async () => {
      const admin = adminClient();
      await admin.from('leagues').update({ archived_at: new Date().toISOString() }).eq('id', s.leagueId);

      // getArchivedLeagueIds()'s query (used by finalize-week, process-waivers, …) includes it.
      const { data: archived } = await admin.from('leagues').select('id').not('archived_at', 'is', null);
      expect((archived ?? []).map((l) => l.id)).toContain(s.leagueId);

      // The direct active-league filter (update-standings / update-daily-records) excludes it.
      const { data: active } = await admin.from('leagues').select('id').is('archived_at', null);
      expect((active ?? []).map((l) => l.id)).not.toContain(s.leagueId);
    }, TIMEOUT);
  });
});
