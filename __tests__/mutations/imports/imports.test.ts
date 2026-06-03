import { bootstrapTestLeague } from '../helpers/bootstrap';
import { adminClient, signInAsBot } from '../helpers/clients';

const TIMEOUT = 30_000;

// Sleeper + screenshot imports depend on external services (Sleeper API, Claude
// Vision) and user-provided data. Full happy-path testing here isn't practical,
// so these are smoke tests that confirm the functions are deployed, reject
// invalid input cleanly, and require auth.

describe('import-sleeper-league', () => {
  beforeAll(async () => {
    await bootstrapTestLeague();
  }, TIMEOUT);

  it(
    'rejects an invalid Sleeper league id on preview',
    async () => {
      const client = await signInAsBot(3);
      const { data, error } = await client.functions.invoke('import-sleeper-league', {
        body: { action: 'preview', sleeper_league_id: '000000000000000000' },
      });
      // Function responds with a 4xx/5xx + error body. Either way, no import
      // should have happened. Treat "either error set OR data.error set" as
      // the pass condition.
      const hasErrorSignal =
        error !== null || (data && typeof data === 'object' && 'error' in (data as any));
      expect(hasErrorSignal).toBe(true);
    },
    TIMEOUT,
  );
});

describe('import-screenshot-league', () => {
  it(
    'rejects a screenshot extraction without images',
    async () => {
      const client = await signInAsBot(3);
      const { data, error } = await client.functions.invoke('import-screenshot-league', {
        body: { action: 'extract_roster', images: [] },
      });
      const hasErrorSignal =
        error !== null || (data && typeof data === 'object' && 'error' in (data as any));
      expect(hasErrorSignal).toBe(true);
    },
    TIMEOUT,
  );
});

// The screenshot `execute` action is self-contained (no Claude Vision / Sleeper
// API), so it's the one import path we can exercise end-to-end. These assert the
// draft-phase seeding contract: which season's rookie picks get created, the
// offseason_step / lottery_status flip, and traded-future-pick ownership.
describe('import-screenshot-league execute — draft phases', () => {
  const admin = adminClient();
  const createdLeagueIds: string[] = [];
  let playerIds: string[] = [];

  beforeAll(async () => {
    const { data: players } = await admin.from('players').select('id').limit(3);
    playerIds = (players ?? []).map((p) => p.id);
    if (playerIds.length < 3) throw new Error('Need ≥3 players in the dev DB for the import phase tests');
  }, TIMEOUT);

  afterAll(async () => {
    // Imports create fresh leagues — tear down everything they wrote, leaf → root.
    for (const id of createdLeagueIds) {
      await admin.from('draft_picks').delete().eq('league_id', id);
      await admin.from('drafts').delete().eq('league_id', id);
      await admin.from('league_players').delete().eq('league_id', id);
      await admin.from('waiver_priority').delete().eq('league_id', id);
      await admin.from('team_seasons').delete().eq('league_id', id);
      await admin.from('league_roster_config').delete().eq('league_id', id);
      await admin.from('league_scoring_settings').delete().eq('league_id', id);
      await admin.from('teams').delete().eq('league_id', id);
      await admin.from('leagues').delete().eq('id', id);
    }
  }, TIMEOUT);

  const TEAM_NAMES = ['Alpha Imports', 'Bravo Imports', 'Charlie Imports'];

  function buildPayload(overrides: Record<string, unknown>) {
    return {
      action: 'execute',
      league_name: `__TEST__ Import ${overrides.draft_phase}-${Date.now()}`,
      league_type: 'dynasty',
      keeper_count: null,
      teams: TEAM_NAMES.map((team_name, i) => ({
        team_name,
        players: [{ player_id: playerIds[i], position: 'PG', roster_slot: 'BE' }],
      })),
      roster_slots: [{ position: 'PG', count: 1 }, { position: 'BE', count: 4 }],
      scoring_type: 'points',
      scoring: [{ stat_name: 'PTS', point_value: 1 }],
      traded_future_picks: [
        { season: '2027-28', round: 1, original_team_name: 'Alpha Imports', new_owner_team_name: 'Bravo Imports' },
      ],
      settings: {
        season: '2026-27',
        sport: 'nba',
        regular_season_weeks: 18,
        playoff_weeks: 3,
        playoff_teams: 2,
        max_future_seasons: 2,
        rookie_draft_rounds: 2,
        rookie_draft_order: 'lottery',
        lottery_draws: 1,
        lottery_odds: null,
        trade_veto_type: 'commissioner',
        trade_review_period_hours: 24,
        trade_votes_to_veto: 4,
        draft_pick_trading_enabled: true,
        pick_conditions_enabled: false,
        waiver_type: 'standard',
        waiver_period_days: 2,
        faab_budget: 100,
        playoff_seeding_format: 'standard',
        reseed_each_round: false,
        buy_in_amount: null,
        trade_deadline: null,
      },
      ...overrides,
    };
  }

  async function runExecute(botN: number, overrides: Record<string, unknown>) {
    const client = await signInAsBot(botN);
    const { data, error } = await client.functions.invoke('import-screenshot-league', {
      body: buildPayload(overrides),
    });
    if (error) throw new Error(`execute failed: ${error.message}`);
    const leagueId = (data as { league_id: string }).league_id;
    createdLeagueIds.push(leagueId);
    return leagueId;
  }

  it(
    'pre_lottery: seeds S0 + future picks, flips to lottery_pending, applies traded pick',
    async () => {
      const leagueId = await runExecute(1, { draft_phase: 'pre_lottery' });

      const { data: league } = await admin
        .from('leagues')
        .select('offseason_step, lottery_status, league_type')
        .eq('id', leagueId)
        .single();
      expect(league?.offseason_step).toBe('lottery_pending');
      expect(league?.lottery_status).toBe('pending');
      expect(league?.league_type).toBe('dynasty');

      const { data: picks } = await admin
        .from('draft_picks')
        .select('season, round, current_team_id, original_team_id, draft_id')
        .eq('league_id', leagueId);
      const seasons = new Set((picks ?? []).map((p) => p.season));
      expect(seasons.has('2026-27')).toBe(true); // S0 seeded for the in-app draft
      expect(seasons.has('2027-28')).toBe(true); // future tradable picks
      expect(seasons.has('2028-29')).toBe(true);
      expect((picks ?? []).every((p) => p.draft_id === null)).toBe(true);

      // Traded pick: 2027-28 R1 originally Alpha's, now owned by Bravo.
      const { data: teams } = await admin.from('teams').select('id, name').eq('league_id', leagueId);
      const idByName = new Map((teams ?? []).map((t) => [t.name, t.id]));
      const moved = (picks ?? []).find((p) => p.season === '2027-28' && p.round === 1 && p.original_team_id === idByName.get('Alpha Imports'));
      expect(moved?.current_team_id).toBe(idByName.get('Bravo Imports'));
    },
    TIMEOUT,
  );

  it(
    'in_season: no S0 picks, leaves offseason_step null, still seeds future picks',
    async () => {
      const leagueId = await runExecute(2, { draft_phase: 'in_season' });

      const { data: league } = await admin
        .from('leagues')
        .select('offseason_step')
        .eq('id', leagueId)
        .single();
      expect(league?.offseason_step).toBeNull();

      const { data: picks } = await admin.from('draft_picks').select('season').eq('league_id', leagueId);
      const seasons = new Set((picks ?? []).map((p) => p.season));
      expect(seasons.has('2026-27')).toBe(false); // upcoming draft already done — no S0
      expect(seasons.has('2027-28')).toBe(true);
    },
    TIMEOUT,
  );
});
