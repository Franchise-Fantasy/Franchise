import { bootstrapTestLeague, BootstrapResult } from '../helpers/bootstrap';
import { adminClient, signInAsBot } from '../helpers/clients';

const TIMEOUT = 30_000;

const SEASON = '2026-27';

describe('mark-payment', () => {
  let league: BootstrapResult;
  let bot3Team: BootstrapResult['teams'][number];

  beforeAll(async () => {
    league = await bootstrapTestLeague();
    const bots = league.teams
      .filter((t) => typeof t.botIndex === 'number')
      .sort((a, b) => (a.botIndex as number) - (b.botIndex as number));
    bot3Team = bots[2];
  }, TIMEOUT);

  beforeEach(async () => {
    // Wipe any payment row for this team so tests start clean.
    const admin = adminClient();
    await admin
      .from('league_payments')
      .delete()
      .eq('league_id', league.leagueId)
      .eq('team_id', bot3Team.id)
      .eq('season', SEASON);
  }, TIMEOUT);

  it(
    'team owner self-reports payment — league_payments row reflects it',
    async () => {
      const bot3 = await signInAsBot(3);
      const { error } = await bot3.functions.invoke('mark-payment', {
        body: {
          league_id: league.leagueId,
          team_id: bot3Team.id,
          season: SEASON,
          action: 'self_report',
        },
      });
      expect(error).toBeNull();

      const admin = adminClient();
      const { data: row } = await admin
        .from('league_payments')
        .select('status, self_reported_at')
        .eq('league_id', league.leagueId)
        .eq('team_id', bot3Team.id)
        .eq('season', SEASON)
        .single();
      expect(row).toBeTruthy();
      expect(row?.self_reported_at).toBeTruthy();
    },
    TIMEOUT,
  );

  it(
    'commissioner confirms a payment — status flips to confirmed',
    async () => {
      const bot1 = await signInAsBot(1);
      const { error } = await bot1.functions.invoke('mark-payment', {
        body: {
          league_id: league.leagueId,
          team_id: bot3Team.id,
          season: SEASON,
          action: 'confirm',
        },
      });
      expect(error).toBeNull();

      const admin = adminClient();
      const { data: row } = await admin
        .from('league_payments')
        .select('paid, paid_at, status')
        .eq('league_id', league.leagueId)
        .eq('team_id', bot3Team.id)
        .eq('season', SEASON)
        .single();
      expect(row?.paid).toBe(true);
      expect(row?.paid_at).toBeTruthy();
    },
    TIMEOUT,
  );

  it(
    'rejects confirm action from a non-commissioner',
    async () => {
      const bot3 = await signInAsBot(3);
      await bot3.functions.invoke('mark-payment', {
        body: {
          league_id: league.leagueId,
          team_id: bot3Team.id,
          season: SEASON,
          action: 'confirm',
        },
      });

      const admin = adminClient();
      const { data: row } = await admin
        .from('league_payments')
        .select('paid')
        .eq('league_id', league.leagueId)
        .eq('team_id', bot3Team.id)
        .eq('season', SEASON)
        .maybeSingle();
      // Either no row created, or row exists but paid=false.
      expect(row?.paid !== true).toBe(true);
    },
    TIMEOUT,
  );
});
