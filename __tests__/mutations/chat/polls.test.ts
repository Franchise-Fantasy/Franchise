import { bootstrapTestLeague, BootstrapResult } from '../helpers/bootstrap';
import { adminClient, signInAsBot } from '../helpers/clients';

const TIMEOUT = 30_000;

describe('polls (create-poll + vote-poll)', () => {
  let league: BootstrapResult;
  let commissionerClient: Awaited<ReturnType<typeof signInAsBot>>;
  let bot3Client: Awaited<ReturnType<typeof signInAsBot>>;

  beforeAll(async () => {
    league = await bootstrapTestLeague();
    commissionerClient = await signInAsBot(1);
    bot3Client = await signInAsBot(3);
  }, TIMEOUT);

  afterAll(async () => {
    // Clean up test-created polls + related messages.
    const admin = adminClient();
    const { data: polls } = await admin
      .from('commissioner_polls')
      .select('id, message_id')
      .eq('league_id', league.leagueId);
    const pollIds = (polls ?? []).map((p) => p.id);
    const msgIds = (polls ?? []).map((p) => p.message_id).filter((x): x is string => !!x);
    if (pollIds.length > 0) {
      await admin.from('poll_votes').delete().in('poll_id', pollIds);
      await admin.from('commissioner_polls').delete().in('id', pollIds);
    }
    if (msgIds.length > 0) {
      await admin.from('chat_messages').delete().in('id', msgIds);
    }
  }, TIMEOUT);

  it(
    'commissioner creates a poll and a member votes in it',
    async () => {
      const closesAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      const { data: createData, error: createErr } = await commissionerClient.functions.invoke(
        'create-poll',
        {
          body: {
            league_id: league.leagueId,
            conversation_id: league.leagueChatId,
            question: 'Are you ready for the season?',
            options: ['Yes', 'No', 'Maybe'],
            poll_type: 'single',
            closes_at: closesAt,
            is_anonymous: false,
            show_live_results: true,
          },
        },
      );
      expect(createErr).toBeNull();
      expect(createData).toBeTruthy();
      const pollId = (createData as any)?.poll_id ?? (createData as any)?.id;
      expect(pollId).toBeTruthy();

      const { data: voteData, error: voteErr } = await bot3Client.functions.invoke('vote-poll', {
        body: { poll_id: pollId, selections: [0] },
      });
      expect(voteErr).toBeNull();
      expect(voteData).toBeTruthy();

      const admin = adminClient();
      const { data: votes } = await admin.from('poll_votes').select('id').eq('poll_id', pollId);
      expect((votes ?? []).length).toBeGreaterThanOrEqual(1);
    },
    TIMEOUT,
  );
});
