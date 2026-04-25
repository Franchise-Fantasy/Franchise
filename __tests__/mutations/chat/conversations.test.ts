import { bootstrapTestLeague, BootstrapResult } from '../helpers/bootstrap';
import { adminClient, signInAsBot } from '../helpers/clients';

const TIMEOUT = 30_000;

describe('chat conversations', () => {
  let league: BootstrapResult;
  let bot3Team: BootstrapResult['teams'][number];
  let bot4Team: BootstrapResult['teams'][number];

  beforeAll(async () => {
    league = await bootstrapTestLeague();
    const bots = league.teams
      .filter((t) => typeof t.botIndex === 'number')
      .sort((a, b) => (a.botIndex as number) - (b.botIndex as number));
    bot3Team = bots[2];
    bot4Team = bots[3];
  }, TIMEOUT);

  afterAll(async () => {
    // Clean up DMs created by tests so they don't accumulate.
    const admin = adminClient();
    await admin
      .from('chat_conversations')
      .delete()
      .eq('league_id', league.leagueId)
      .eq('type', 'dm');
  }, TIMEOUT);

  it(
    'creates a DM conversation and adds both teams as members',
    async () => {
      const bot3 = await signInAsBot(3);
      const { data: conv, error: convErr } = await bot3
        .from('chat_conversations')
        .insert({ league_id: league.leagueId, type: 'dm' })
        .select('id')
        .single();
      expect(convErr).toBeNull();
      expect(conv?.id).toBeTruthy();

      const { error: membersErr } = await bot3.from('chat_members').insert([
        { conversation_id: conv!.id, team_id: bot3Team.id },
        { conversation_id: conv!.id, team_id: bot4Team.id },
      ]);
      expect(membersErr).toBeNull();

      const admin = adminClient();
      const { data: members } = await admin
        .from('chat_members')
        .select('team_id')
        .eq('conversation_id', conv!.id);
      expect(members).toHaveLength(2);
    },
    TIMEOUT,
  );

  it(
    'updating chat_members.last_read_at for own team succeeds',
    async () => {
      const admin = adminClient();
      const { data: member } = await admin
        .from('chat_members')
        .select('id')
        .eq('conversation_id', league.leagueChatId)
        .eq('team_id', bot3Team.id)
        .single();
      expect(member?.id).toBeTruthy();

      const bot3 = await signInAsBot(3);
      const now = new Date().toISOString();
      const { error } = await bot3
        .from('chat_members')
        .update({ last_read_at: now })
        .eq('id', member!.id);
      expect(error).toBeNull();

      const { data: check } = await admin
        .from('chat_members')
        .select('last_read_at')
        .eq('id', member!.id)
        .single();
      // Postgres returns `+00:00`; JS ISO uses `Z`. Compare parsed instants.
      expect(new Date(check!.last_read_at!).getTime()).toBe(new Date(now).getTime());
    },
    TIMEOUT,
  );
});
