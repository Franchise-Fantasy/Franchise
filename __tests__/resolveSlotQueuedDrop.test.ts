// Verification of PR 1 + PR 2 — queued-drop handling in resolveSlot.
// Confirms the behavior the bug fix delivers across edge + client now that
// _shared/resolveSlot.ts is byte-identical to utils/roster/resolveSlot.ts
// and get-week-scores imports the shared version.

import { resolveSlot, isActiveSlot } from '@/utils/roster/resolveSlot';

const TODAY = '2026-05-15';
const TOMORROW = '2026-05-16';
const YESTERDAY = '2026-05-14';

describe('resolveSlot — queued-drop scenarios (the PR 1/2 bug fix)', () => {
  it('TODAY counts: player still on roster with queued drop dated tomorrow', () => {
    // Drop queued during today's locked window: a DROPPED row exists at
    // tomorrow's date. Today's daily_lineups still has the active slot.
    const dailyEntries = [
      { lineup_date: TOMORROW, roster_slot: 'DROPPED' },
      { lineup_date: TODAY, roster_slot: 'PG' },
    ];
    const slot = resolveSlot({
      dailyEntries,
      day: TODAY,
      defaultSlot: 'PG',
      isOnCurrentRoster: true, // cron hasn't processed yet
      acquiredDate: YESTERDAY,
      today: TODAY,
    });
    expect(slot).toBe('PG');
    expect(isActiveSlot(slot)).toBe(true);
  });

  it('TOMORROW does NOT count: queued drop blocks future-day scoring', () => {
    const dailyEntries = [
      { lineup_date: TOMORROW, roster_slot: 'DROPPED' },
      { lineup_date: TODAY, roster_slot: 'PG' },
    ];
    const slot = resolveSlot({
      dailyEntries,
      day: TOMORROW,
      defaultSlot: 'PG',
      isOnCurrentRoster: true,
      acquiredDate: YESTERDAY,
      today: TODAY,
    });
    expect(slot).toBe('DROPPED');
    expect(isActiveSlot(slot)).toBe(false);
  });

  it('AFTER cron runs: TODAY still counts when looking back', () => {
    // Cron has run: league_players row deleted → isOnCurrentRoster false.
    // daily_lineups has DROPPED at the slate-rollover day + the historical
    // active-slot snapshot at week start.
    const dailyEntries = [
      { lineup_date: TOMORROW, roster_slot: 'DROPPED' },
      { lineup_date: TODAY, roster_slot: 'PG' },
    ];
    const slot = resolveSlot({
      dailyEntries,
      day: TODAY,
      defaultSlot: 'BE',
      isOnCurrentRoster: false,
      dropDate: TOMORROW,
      acquiredDate: YESTERDAY,
      today: TOMORROW,
    });
    expect(slot).toBe('PG');
    expect(isActiveSlot(slot)).toBe(true);
  });

  it('AFTER cron runs: TOMORROW and beyond do NOT count', () => {
    const dailyEntries = [
      { lineup_date: TOMORROW, roster_slot: 'DROPPED' },
      { lineup_date: TODAY, roster_slot: 'PG' },
    ];
    const slot = resolveSlot({
      dailyEntries,
      day: TOMORROW,
      defaultSlot: 'BE',
      isOnCurrentRoster: false,
      dropDate: TOMORROW,
      acquiredDate: YESTERDAY,
      today: TOMORROW,
    });
    expect(slot).toBe('DROPPED');
  });

  it('Re-acquisition after a past drop resolves to the active slot', () => {
    // Dropped 3 days ago, re-acquired yesterday; today the player plays.
    const dailyEntries = [
      { lineup_date: TODAY, roster_slot: 'PG' },
      { lineup_date: YESTERDAY, roster_slot: 'PG' },
      { lineup_date: '2026-05-12', roster_slot: 'DROPPED' },
    ];
    const slot = resolveSlot({
      dailyEntries,
      day: TODAY,
      defaultSlot: 'PG',
      isOnCurrentRoster: true,
      acquiredDate: YESTERDAY, // re-acquired AFTER the past drop
      today: TODAY,
    });
    expect(slot).toBe('PG');
  });

  it('No daily entries: falls back to defaultSlot when not yet locked', () => {
    const slot = resolveSlot({
      dailyEntries: [],
      day: TODAY,
      defaultSlot: 'SG',
      isOnCurrentRoster: true,
      today: TODAY,
    });
    expect(slot).toBe('SG');
  });

  it('Pre-acquisition day for a current-roster player returns BE', () => {
    const slot = resolveSlot({
      dailyEntries: [],
      day: '2026-05-10',
      defaultSlot: 'SF',
      isOnCurrentRoster: true,
      acquiredDate: TODAY,
      today: TODAY,
    });
    expect(slot).toBe('BE');
  });
});

describe('isActiveSlot', () => {
  it('starter slots are active', () => {
    expect(isActiveSlot('PG')).toBe(true);
    expect(isActiveSlot('SG')).toBe(true);
    expect(isActiveSlot('SF')).toBe(true);
    expect(isActiveSlot('PF')).toBe(true);
    expect(isActiveSlot('C')).toBe(true);
    expect(isActiveSlot('G')).toBe(true);
    expect(isActiveSlot('F')).toBe(true);
    expect(isActiveSlot('UTIL')).toBe(true);
    expect(isActiveSlot('UTIL1')).toBe(true);
  });

  it('BE / IR / TAXI / DROPPED are not active', () => {
    expect(isActiveSlot('BE')).toBe(false);
    expect(isActiveSlot('IR')).toBe(false);
    expect(isActiveSlot('TAXI')).toBe(false);
    expect(isActiveSlot('DROPPED')).toBe(false);
  });
});
