// start-draft kicks off a 'pending' draft once its draft_date passes, then
// schedules a QStash autodraft job for pick #1. Calling the happy path from
// tests would publish a real QStash message that fires against the dev DB
// 60s later, racing the next test's draft reset. Instead, this file tests
// the state guards that PREVENT a draft from starting — the most regression-
// prone parts of the function and the ones least likely to leave side effects.
//
// Happy path is exercised by the production cron + draft-room flow; this file
// covers what the cron + UI rely on rejecting.

import { bootstrapTestLeague, BootstrapResult } from '../helpers/bootstrap';
import { adminClient, signInAsBot } from '../helpers/clients';
import { expectHttpError } from '../helpers/expect';
import { clearRateLimits } from '../helpers/lifecycle';

const TIMEOUT = 30_000;

describe('start-draft (state guards)', () => {
  let league: BootstrapResult;

  beforeAll(async () => {
    league = await bootstrapTestLeague();
    // This file makes multiple start-draft invokes in quick succession. The
    // per-user rate limit (configured generously in prod for the draft-room
    // "start now" button) still trips when 4 tests run within seconds. Clear
    // before each test so the guards are exercised, not the rate limiter.
    const commissionerId = league.teams.find((t) => t.botIndex === 1)!.userId;
    await clearRateLimits(commissionerId, ['start-draft']);
  }, TIMEOUT);

  beforeEach(async () => {
    const commissionerId = league.teams.find((t) => t.botIndex === 1)!.userId;
    await clearRateLimits(commissionerId, ['start-draft']);
  }, TIMEOUT);

  // Each test creates its own draft so guard rejections don't leak state.
  async function createDraft(opts: {
    status: 'pending' | 'in_progress' | 'unscheduled' | 'paused' | 'completed';
    draftDate?: Date;
  }): Promise<string> {
    const admin = adminClient();
    // uq_draft_per_league_season_type allows only one draft per
    // (league, season, type), and the bootstrap league already has an initial
    // draft (which can't simply be deleted — its picks FK to it). Upsert on that
    // key instead: what each test actually needs is a draft in a known STATE,
    // not a brand-new row.
    const { data: draft, error } = await admin
      .from('drafts')
      .upsert({
        league_id: league.leagueId,
        season: '2026-27',
        type: 'initial',
        draft_type: 'linear',
        status: opts.status,
        current_pick_number: 1,
        rounds: 2,
        picks_per_round: 5,
        time_limit: 60,
        draft_date: (opts.draftDate ?? new Date()).toISOString(),
      }, { onConflict: 'league_id,season,type' })
      .select('id')
      .single();
    if (error || !draft) throw new Error(`Create draft failed: ${error?.message}`);
    return draft.id;
  }

  async function deleteDraft(draftId: string): Promise<void> {
    const admin = adminClient();
    await admin.from('drafts').delete().eq('id', draftId);
  }

  it(
    'rejects when the draft date has not yet arrived',
    async () => {
      const future = new Date(Date.now() + 24 * 3600 * 1000);
      const draftId = await createDraft({ status: 'pending', draftDate: future });
      try {
        const client = await signInAsBot(1);
        const result = await client.functions.invoke('start-draft', {
          body: { draft_id: draftId },
        });
        await expectHttpError(result, { status: 400, messageMatch: /scheduled start time/i });

        // Defense-in-depth: draft was NOT advanced.
        const admin = adminClient();
        const { data: draft } = await admin.from('drafts').select('status').eq('id', draftId).single();
        expect(draft?.status).toBe('pending');
      } finally {
        await deleteDraft(draftId);
      }
    },
    TIMEOUT,
  );

  it(
    'rejects when the draft is not in pending status (unscheduled)',
    async () => {
      const draftId = await createDraft({ status: 'unscheduled' });
      try {
        const client = await signInAsBot(1);
        const result = await client.functions.invoke('start-draft', {
          body: { draft_id: draftId },
        });
        await expectHttpError(result, { status: 400, messageMatch: /cannot be started/i });
      } finally {
        await deleteDraft(draftId);
      }
    },
    TIMEOUT,
  );

  it(
    'short-circuits with an idempotent 200 when the draft is already in_progress',
    async () => {
      const past = new Date(Date.now() - 60 * 60 * 1000);
      const draftId = await createDraft({ status: 'in_progress', draftDate: past });
      try {
        const client = await signInAsBot(1);
        const { data, error } = await client.functions.invoke('start-draft', {
          body: { draft_id: draftId },
        });
        // The function returns 200 with "Draft already in progress" rather
        // than erroring — this is the documented idempotent fast-path so the
        // draft-room "start now" button doesn't fail if cron beat it.
        expect(error).toBeNull();
        expect(data?.message).toMatch(/already in progress/i);
      } finally {
        await deleteDraft(draftId);
      }
    },
    TIMEOUT,
  );

  it(
    'rejects a draft_id that does not exist',
    async () => {
      const client = await signInAsBot(1);
      const result = await client.functions.invoke('start-draft', {
        body: { draft_id: '00000000-0000-0000-0000-000000000000' },
      });
      await expectHttpError(result, { status: 404, messageMatch: /not found/i });
    },
    TIMEOUT,
  );
});
