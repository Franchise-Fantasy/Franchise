import { bootstrapTestLeague, BootstrapResult } from '../helpers/bootstrap';
import { adminClient, signInAsBot } from '../helpers/clients';

const TIMEOUT = 30_000;

describe('chat_messages / reactions / pins', () => {
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

  async function clearOurMessages() {
    // Clear messages posted by bot3/bot4 so tests don't leak into each other
    // (but leave trade chat history alone).
    const admin = adminClient();
    await admin
      .from('chat_messages')
      .delete()
      .in('team_id', [bot3Team.id, bot4Team.id])
      .eq('conversation_id', league.leagueChatId);
  }

  beforeEach(async () => {
    await clearOurMessages();
  }, TIMEOUT);

  it(
    'user sends a text message to their league chat',
    async () => {
      const client = await signInAsBot(3);
      const { data, error } = await client
        .from('chat_messages')
        .insert({
          league_id: league.leagueId,
          conversation_id: league.leagueChatId,
          team_id: bot3Team.id,
          content: 'hello from bot3',
          type: 'text',
        })
        .select('id, content')
        .single();
      expect(error).toBeNull();
      expect(data?.content).toBe('hello from bot3');
    },
    TIMEOUT,
  );

  it(
    'user can delete (unsend) their own message; another user cannot delete it',
    async () => {
      const bot3 = await signInAsBot(3);
      const { data: msg } = await bot3
        .from('chat_messages')
        .insert({
          league_id: league.leagueId,
          conversation_id: league.leagueChatId,
          team_id: bot3Team.id,
          content: 'soon to be unsent',
          type: 'text',
        })
        .select('id')
        .single();
      expect(msg?.id).toBeTruthy();

      // bot4 tries to delete — RLS blocks. supabase-js doesn't error on a
      // no-op delete, so we verify post-state.
      const bot4 = await signInAsBot(4);
      await bot4.from('chat_messages').delete().eq('id', msg!.id);
      const admin = adminClient();
      const { data: stillThere } = await admin
        .from('chat_messages')
        .select('id')
        .eq('id', msg!.id)
        .maybeSingle();
      expect(stillThere).toBeTruthy();

      // bot3 (the author) can delete.
      await bot3.from('chat_messages').delete().eq('id', msg!.id);
      const { data: gone } = await admin
        .from('chat_messages')
        .select('id')
        .eq('id', msg!.id)
        .maybeSingle();
      expect(gone).toBeNull();
    },
    TIMEOUT,
  );

  it(
    'user can add and remove a reaction on a message',
    async () => {
      const bot3 = await signInAsBot(3);
      const { data: msg } = await bot3
        .from('chat_messages')
        .insert({
          league_id: league.leagueId,
          conversation_id: league.leagueChatId,
          team_id: bot3Team.id,
          content: 'react to me',
          type: 'text',
        })
        .select('id')
        .single();

      const bot4 = await signInAsBot(4);
      const { data: reaction, error } = await bot4
        .from('chat_reactions')
        .insert({
          conversation_id: league.leagueChatId,
          message_id: msg!.id,
          team_id: bot4Team.id,
          emoji: '🔥',
        })
        .select('id')
        .single();
      expect(error).toBeNull();
      expect(reaction?.id).toBeTruthy();

      // Remove the reaction
      const { error: delErr } = await bot4
        .from('chat_reactions')
        .delete()
        .eq('id', reaction!.id);
      expect(delErr).toBeNull();

      const admin = adminClient();
      const { data: check } = await admin
        .from('chat_reactions')
        .select('id')
        .eq('id', reaction!.id)
        .maybeSingle();
      expect(check).toBeNull();
    },
    TIMEOUT,
  );

  it(
    'commissioner can pin and unpin a message; non-commissioner blocked by RLS',
    async () => {
      const bot3 = await signInAsBot(3);
      const { data: msg } = await bot3
        .from('chat_messages')
        .insert({
          league_id: league.leagueId,
          conversation_id: league.leagueChatId,
          team_id: bot3Team.id,
          content: 'pin me',
          type: 'text',
        })
        .select('id')
        .single();

      // bot3 isn't commissioner — pin should be blocked by RLS.
      const { error: bot3PinErr } = await bot3.from('chat_pins').insert({
        conversation_id: league.leagueChatId,
        message_id: msg!.id,
        pinned_by: bot3Team.id,
      });
      expect(bot3PinErr).toBeTruthy();

      // bot1 IS commissioner — pin succeeds.
      const bot1 = await signInAsBot(1);
      const bot1Team = league.teams.find((t) => t.botIndex === 1)!;
      const { data: pin, error } = await bot1
        .from('chat_pins')
        .insert({
          conversation_id: league.leagueChatId,
          message_id: msg!.id,
          pinned_by: bot1Team.id,
        })
        .select('id')
        .single();
      expect(error).toBeNull();
      expect(pin?.id).toBeTruthy();

      const { error: unpinErr } = await bot1.from('chat_pins').delete().eq('id', pin!.id);
      expect(unpinErr).toBeNull();
    },
    TIMEOUT,
  );
});
