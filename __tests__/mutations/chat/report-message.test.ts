// Coverage for the moderation report flow. Verifies a member can report a
// chat message they have access to, the row lands in `message_reports`, and
// the function enforces both league-membership and message-existence gates.
//
// The report is idempotent via UNIQUE(message_id, reporter_id) — a retry
// from the same user must still succeed (the function swallows the 23505).

import { bootstrapTestLeague, BootstrapResult } from '../helpers/bootstrap';
import { adminClient, signInAsBot } from '../helpers/clients';
import { expectHttpError } from '../helpers/expect';
import { clearRateLimits } from '../helpers/lifecycle';

const TIMEOUT = 30_000;

describe('report-message', () => {
  let league: BootstrapResult;
  let bot1Team: BootstrapResult['teams'][number];
  let bot3Team: BootstrapResult['teams'][number];
  let messageId: string;

  beforeAll(async () => {
    league = await bootstrapTestLeague();
    const bots = league.teams
      .filter((t) => typeof t.botIndex === 'number')
      .sort((a, b) => (a.botIndex as number) - (b.botIndex as number));
    bot1Team = bots[0];
    bot3Team = bots[2];

    // Seed a chat message authored by bot3 for bots 1+3 to be in scope to report.
    const admin = adminClient();
    const { data: msg, error } = await admin
      .from('chat_messages')
      .insert({
        conversation_id: league.leagueChatId,
        team_id: bot3Team.id,
        content: 'reported test message',
        type: 'text',
        league_id: league.leagueId,
      })
      .select('id')
      .single();
    if (error || !msg) throw new Error(`Seed chat message failed: ${error?.message}`);
    messageId = msg.id;
  }, TIMEOUT);

  beforeEach(async () => {
    const admin = adminClient();
    // Reset reports across the message between tests so the happy-path test
    // doesn't false-positive against a stale row from a prior run.
    await admin.from('message_reports').delete().eq('message_id', messageId);
    // Clear rate limit so bursts of 4 tests don't 429.
    await clearRateLimits(bot1Team.userId, ['report-message']);
  }, TIMEOUT);

  afterAll(async () => {
    const admin = adminClient();
    await admin.from('message_reports').delete().eq('message_id', messageId);
    await admin.from('chat_messages').delete().eq('id', messageId);
  }, TIMEOUT);

  it(
    'records a report when a league member submits one',
    async () => {
      const client = await signInAsBot(1);
      const { data, error } = await client.functions.invoke('report-message', {
        body: { message_id: messageId, reason: 'spam', details: 'looks like advertising' },
      });
      expect(error).toBeNull();
      expect(data?.ok).toBe(true);

      const admin = adminClient();
      const { data: row } = await admin
        .from('message_reports')
        .select('message_id, reporter_id, reason, details')
        .eq('message_id', messageId)
        .eq('reporter_id', bot1Team.userId)
        .single();
      expect(row).toMatchObject({
        message_id: messageId,
        reporter_id: bot1Team.userId,
        reason: 'spam',
        details: 'looks like advertising',
      });
    },
    TIMEOUT,
  );

  it(
    'is idempotent — same user reporting twice does not 5xx',
    async () => {
      const client = await signInAsBot(1);
      const first = await client.functions.invoke('report-message', {
        body: { message_id: messageId, reason: 'harassment' },
      });
      expect(first.error).toBeNull();
      // Second submission hits the UNIQUE(message_id, reporter_id) constraint;
      // the function intentionally swallows 23505 and returns 200.
      const second = await client.functions.invoke('report-message', {
        body: { message_id: messageId, reason: 'harassment' },
      });
      expect(second.error).toBeNull();

      const admin = adminClient();
      const { data: rows } = await admin
        .from('message_reports')
        .select('id')
        .eq('message_id', messageId)
        .eq('reporter_id', bot1Team.userId);
      expect(rows).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    'rejects an unknown message_id with 404',
    async () => {
      const client = await signInAsBot(1);
      const result = await client.functions.invoke('report-message', {
        body: { message_id: '00000000-0000-0000-0000-000000000000', reason: 'other' },
      });
      await expectHttpError(result, { status: 404, messageMatch: /message not found/i });
    },
    TIMEOUT,
  );
});
