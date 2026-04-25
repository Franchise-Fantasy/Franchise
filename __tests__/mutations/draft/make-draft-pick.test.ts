import { bootstrapTestLeague, BootstrapResult } from '../helpers/bootstrap';
import { adminClient, signInAsBot } from '../helpers/clients';
import {
  ensureActiveDraft,
  pickFreeAgentPlayer,
  getPlayerOwner,
  getDraftCurrentPick,
  resetDraftState,
  getCanonicalRosterPlayerIds,
  restoreCanonicalRosters,
} from '../helpers/seed';

const TIMEOUT = 30_000;

describe('make-draft-pick', () => {
  let league: BootstrapResult;
  let draftId: string;
  let teamBot1: BootstrapResult['teams'][number];
  let teamBot2: BootstrapResult['teams'][number];
  let teamBot3: BootstrapResult['teams'][number];
  // Player canonical to bot4 — used for the "already rostered" test.
  let bot4Player: string;

  beforeAll(async () => {
    league = await bootstrapTestLeague();
    await restoreCanonicalRosters(league.leagueId);

    const bots = league.teams
      .filter((t) => typeof t.botIndex === 'number')
      .sort((a, b) => (a.botIndex as number) - (b.botIndex as number));
    teamBot1 = bots[0];
    teamBot2 = bots[1];
    teamBot3 = bots[2];
    const teamBot4 = bots[3];

    const pickOrder = bots.map((t) => t.id); // bot1, bot2, bot3, bot4 + any watcher
    const watcher = league.teams.find((t) => t.botIndex === 'watcher');
    if (watcher) pickOrder.push(watcher.id);

    const result = await ensureActiveDraft({
      leagueId: league.leagueId,
      season: '2026-27',
      teamIdsInPickOrder: pickOrder,
    });
    draftId = result.draftId;

    const bot4Roster = await getCanonicalRosterPlayerIds(league.leagueId, teamBot4.id);
    bot4Player = bot4Roster[0];
  }, TIMEOUT);

  beforeEach(async () => {
    await resetDraftState(draftId, league.leagueId);
    await restoreCanonicalRosters(league.leagueId);
  }, TIMEOUT);

  it(
    'team on the clock makes a valid pick — player rosters, draft advances',
    async () => {
      const fa = await pickFreeAgentPlayer(league.leagueId);
      const client = await signInAsBot(1);

      const { data, error } = await client.functions.invoke('make-draft-pick', {
        body: {
          draft_id: draftId,
          player_id: fa.id,
          player_position: fa.position,
          league_id: league.leagueId,
        },
      });

      expect(error).toBeNull();
      expect(data).toBeTruthy();
      // Player is now on bot1's roster.
      expect(await getPlayerOwner(league.leagueId, fa.id)).toBe(teamBot1.id);
      // Draft advanced to pick 2.
      expect(await getDraftCurrentPick(draftId)).toBe(2);
      // The draft_pick row records the selection.
      const admin = adminClient();
      const { data: pickRow } = await admin
        .from('draft_picks')
        .select('player_id, selected_at')
        .eq('draft_id', draftId)
        .eq('pick_number', 1)
        .single();
      expect(pickRow?.player_id).toBe(fa.id);
      expect(pickRow?.selected_at).toBeTruthy();
    },
    TIMEOUT,
  );

  it(
    'rejects a pick from a team that is not on the clock',
    async () => {
      const fa = await pickFreeAgentPlayer(league.leagueId);
      // bot3 tries to pick at pick 1 (which belongs to bot1).
      const client = await signInAsBot(3);

      await client.functions.invoke('make-draft-pick', {
        body: {
          draft_id: draftId,
          player_id: fa.id,
          player_position: fa.position,
          league_id: league.leagueId,
        },
      });

      // The fact-check: player did NOT land on any roster, draft did NOT advance.
      expect(await getPlayerOwner(league.leagueId, fa.id)).toBeNull();
      expect(await getDraftCurrentPick(draftId)).toBe(1);
    },
    TIMEOUT,
  );

  it(
    'rejects a pick when the player is already on a roster',
    async () => {
      // bot1 tries to draft a player who's canonical to bot4.
      const client = await signInAsBot(1);
      const admin = adminClient();

      const { data: existingPlayer } = await admin
        .from('players')
        .select('position')
        .eq('id', bot4Player)
        .single();

      await client.functions.invoke('make-draft-pick', {
        body: {
          draft_id: draftId,
          player_id: bot4Player,
          player_position: existingPlayer?.position ?? 'UTIL',
          league_id: league.leagueId,
        },
      });

      // Player is still on bot4 (not moved) and draft didn't advance.
      expect(await getDraftCurrentPick(draftId)).toBe(1);
      const { data: pickRow } = await admin
        .from('draft_picks')
        .select('player_id')
        .eq('draft_id', draftId)
        .eq('pick_number', 1)
        .single();
      expect(pickRow?.player_id).toBeNull();
    },
    TIMEOUT,
  );
});
