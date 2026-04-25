import { adminClient, signInAsBot } from '../helpers/clients';
import { bootstrapTestLeague } from '../helpers/bootstrap';

const TIMEOUT = 30_000;

describe('prospect_boards', () => {
  let bot3UserId: string;

  beforeAll(async () => {
    await bootstrapTestLeague();
    const bot3 = await signInAsBot(3);
    bot3UserId = (await bot3.auth.getUser()).data.user!.id;
  }, TIMEOUT);

  beforeEach(async () => {
    const admin = adminClient();
    await admin.from('prospect_boards').delete().eq('user_id', bot3UserId);
  }, TIMEOUT);

  async function getProspects(count: number): Promise<string[]> {
    const admin = adminClient();
    const { data } = await admin
      .from('players')
      .select('id')
      .eq('is_prospect', true)
      .limit(count);
    const ids = (data ?? []).map((r) => r.id);
    if (ids.length < count) throw new Error(`Need ${count} prospects in DB`);
    return ids;
  }

  it(
    'user can add a prospect to their board',
    async () => {
      const [pid] = await getProspects(1);
      const client = await signInAsBot(3);
      const { data, error } = await client
        .from('prospect_boards')
        .insert({ user_id: bot3UserId, player_id: pid, rank: 1 })
        .select('id, rank')
        .single();
      expect(error).toBeNull();
      expect(data?.rank).toBe(1);
    },
    TIMEOUT,
  );

  it(
    'user can remove a prospect from their board',
    async () => {
      const [pid] = await getProspects(1);
      const client = await signInAsBot(3);
      const { data: inserted } = await client
        .from('prospect_boards')
        .insert({ user_id: bot3UserId, player_id: pid, rank: 1 })
        .select('id')
        .single();

      const { error } = await client.from('prospect_boards').delete().eq('id', inserted!.id);
      expect(error).toBeNull();

      const admin = adminClient();
      const { data: check } = await admin
        .from('prospect_boards')
        .select('id')
        .eq('id', inserted!.id)
        .maybeSingle();
      expect(check).toBeNull();
    },
    TIMEOUT,
  );

  it(
    'user can update notes on a boarded prospect',
    async () => {
      const [pid] = await getProspects(1);
      const client = await signInAsBot(3);
      const { data: inserted } = await client
        .from('prospect_boards')
        .insert({ user_id: bot3UserId, player_id: pid, rank: 1 })
        .select('id')
        .single();

      const { error } = await client
        .from('prospect_boards')
        .update({ notes: 'high upside' })
        .eq('id', inserted!.id);
      expect(error).toBeNull();

      const admin = adminClient();
      const { data: check } = await admin
        .from('prospect_boards')
        .select('notes')
        .eq('id', inserted!.id)
        .single();
      expect(check?.notes).toBe('high upside');
    },
    TIMEOUT,
  );

  it(
    'reordering two prospects updates rank',
    async () => {
      const [p1, p2] = await getProspects(2);
      const admin = adminClient();
      const { data: seeded } = await admin
        .from('prospect_boards')
        .insert([
          { user_id: bot3UserId, player_id: p1, rank: 1 },
          { user_id: bot3UserId, player_id: p2, rank: 2 },
        ])
        .select('id, rank')
        .order('rank');
      if (!seeded || seeded.length !== 2) throw new Error('Seed failed');

      const client = await signInAsBot(3);
      await Promise.all([
        client.from('prospect_boards').update({ rank: 2 }).eq('id', seeded[0].id),
        client.from('prospect_boards').update({ rank: 1 }).eq('id', seeded[1].id),
      ]);

      const { data: after } = await admin
        .from('prospect_boards')
        .select('id, rank')
        .in('id', [seeded[0].id, seeded[1].id])
        .order('rank');
      expect(after?.map((r) => r.id)).toEqual([seeded[1].id, seeded[0].id]);
    },
    TIMEOUT,
  );
});
