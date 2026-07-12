import { getSportToday, nextSlateRollover } from '@/utils/leagueTime';

import { adminClient } from '../helpers/clients';

const TIMEOUT = 30_000;

// Drift gate for the SQL ↔ TS slate-date pair (migration 20260711000000).
//
// The roster RPCs (roster_add_drop, apply_roster_move, commissioner_roster_action)
// compute "what league day is it" server-side via sport_slate_date() /
// next_slate_rollover() instead of trusting a client-supplied date — the drop
// path does `DELETE FROM daily_lineups WHERE lineup_date > <today>`, so that
// argument had to stop being a parameter. That means the SQL now has to agree
// with utils/leagueTime.ts exactly, and nothing else would catch it if it
// didn't: a one-hour disagreement only misbehaves for one hour a day, and a
// DST-only disagreement only twice a year.
//
// The moments below bracket the 5am rollover on both sides of both DST
// transitions, which is where the two implementations could plausibly diverge.
describe('slate date — SQL/TS parity', () => {
  const admin = adminClient();

  const moments = [
    '2026-07-11T08:59:00Z', // 4:59am EDT — still yesterday's slate
    '2026-07-11T09:00:00Z', // 5:00am EDT — rollover moment
    '2026-07-11T03:30:00Z', // 11:30pm EDT — late tip, same slate
    '2026-07-11T16:00:00Z', // midday EDT
    '2026-01-15T09:59:00Z', // 4:59am EST
    '2026-01-15T10:00:00Z', // 5:00am EST — rollover moment (one hour later than EDT)
    '2026-01-15T23:00:00Z', // evening EST
    '2026-03-08T07:30:00Z', // spring forward — 3:30am EDT, clocks just jumped
    '2026-03-08T12:00:00Z', // after spring forward
    '2026-11-01T05:30:00Z', // fall back — 1:30am EDT, before the repeat hour
    '2026-11-01T06:30:00Z', // fall back — 1:30am EST, the repeated hour
    '2026-12-31T23:59:00Z', // year boundary
  ];

  it.each(moments)('sport_slate_date matches getSportToday at %s', async (iso) => {
    const { data, error } = await admin.rpc('sport_slate_date', { p_at: iso });
    expect(error).toBeNull();
    expect(data).toBe(getSportToday('nba', new Date(iso)));
  }, TIMEOUT);

  it.each(moments)('next_slate_rollover matches nextSlateRollover at %s', async (iso) => {
    const { data, error } = await admin.rpc('next_slate_rollover', { p_at: iso });
    expect(error).toBeNull();
    // Postgres renders timestamptz in the session TZ; compare as instants.
    expect(new Date(data as string).getTime()).toBe(
      nextSlateRollover('nba', new Date(iso)).getTime(),
    );
  }, TIMEOUT);
});
