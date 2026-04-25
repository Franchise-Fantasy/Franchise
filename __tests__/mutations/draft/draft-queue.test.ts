import { bootstrapTestLeague, BootstrapResult } from '../helpers/bootstrap';
import { adminClient, signInAsBot } from '../helpers/clients';
import { ensureActiveDraft, pickFreeAgentPlayer } from '../helpers/seed';

const TIMEOUT = 30_000;

describe('draft_queue', () => {
  let league: BootstrapResult;
  let draftId: string;
  let teamBot3: BootstrapResult['teams'][number];

  beforeAll(async () => {
    league = await bootstrapTestLeague();
    const bots = league.teams
      .filter((t) => typeof t.botIndex === 'number')
      .sort((a, b) => (a.botIndex as number) - (b.botIndex as number));
    teamBot3 = bots[2];

    const pickOrder = league.teams
      .filter((t) => typeof t.botIndex === 'number')
      .sort((a, b) => (a.botIndex as number) - (b.botIndex as number))
      .map((t) => t.id);
    const result = await ensureActiveDraft({
      leagueId: league.leagueId,
      season: '2026-27',
      teamIdsInPickOrder: pickOrder,
    });
    draftId = result.draftId;
  }, TIMEOUT);

  beforeEach(async () => {
    const admin = adminClient();
    await admin.from('draft_queue').delete().eq('team_id', teamBot3.id);
  }, TIMEOUT);

  it(
    'user can add a prospect to their own draft queue',
    async () => {
      const fa = await pickFreeAgentPlayer(league.leagueId);
      const client = await signInAsBot(3);

      const { data, error } = await client
        .from('draft_queue')
        .insert({
          draft_id: draftId,
          team_id: teamBot3.id,
          player_id: fa.id,
          priority: 1,
        })
        .select('id, priority')
        .single();

      expect(error).toBeNull();
      expect(data?.priority).toBe(1);
    },
    TIMEOUT,
  );

  it(
    'user can remove a player from their queue',
    async () => {
      const fa = await pickFreeAgentPlayer(league.leagueId);
      const client = await signInAsBot(3);
      const { data: inserted } = await client
        .from('draft_queue')
        .insert({
          draft_id: draftId,
          team_id: teamBot3.id,
          player_id: fa.id,
          priority: 1,
        })
        .select('id')
        .single();
      expect(inserted?.id).toBeTruthy();

      const { error } = await client.from('draft_queue').delete().eq('id', inserted!.id);
      expect(error).toBeNull();

      const admin = adminClient();
      const { data: check } = await admin
        .from('draft_queue')
        .select('id')
        .eq('id', inserted!.id)
        .maybeSingle();
      expect(check).toBeNull();
    },
    TIMEOUT,
  );

  it(
    'reordering updates priority',
    async () => {
      // Grab two distinct free-agent players directly.
      const admin = adminClient();
      const { data: rostered } = await admin
        .from('league_players')
        .select('player_id')
        .eq('league_id', league.leagueId);
      const excluded = new Set((rostered ?? []).map((r) => r.player_id));
      const { data: pool } = await admin
        .from('players')
        .select('id')
        .eq('is_prospect', false)
        .not('position', 'is', null)
        .not('pro_team', 'is', null)
        .limit(100);
      const pair = (pool ?? []).filter((p) => !excluded.has(p.id)).slice(0, 2);
      if (pair.length < 2) throw new Error('Need 2 distinct FAs for reorder test');

      const { data: seeded } = await admin
        .from('draft_queue')
        .insert([
          { draft_id: draftId, team_id: teamBot3.id, player_id: pair[0].id, priority: 1 },
          { draft_id: draftId, team_id: teamBot3.id, player_id: pair[1].id, priority: 2 },
        ])
        .select('id, priority')
        .order('priority');
      if (!seeded || seeded.length !== 2) throw new Error('Seed queue failed');

      const client = await signInAsBot(3);
      // Swap priorities
      const [first, second] = seeded;
      await Promise.all([
        client.from('draft_queue').update({ priority: 2 }).eq('id', first.id),
        client.from('draft_queue').update({ priority: 1 }).eq('id', second.id),
      ]);

      const { data: after } = await admin
        .from('draft_queue')
        .select('id, priority')
        .in('id', [first.id, second.id])
        .order('priority');
      expect(after?.map((r) => r.id)).toEqual([second.id, first.id]);
    },
    TIMEOUT,
  );
});
