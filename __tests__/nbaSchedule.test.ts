// utils/nba/nbaSchedule imports supabase. The pure helper (formatGameTime)
// doesn't use it, but ts-jest still loads the module — stub at module level.
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

import { formatGameTime } from '@/utils/nba/nbaSchedule';

describe('formatGameTime', () => {
  it('formats midday UTC into a local time string', () => {
    // Output depends on TZ — just check the shape.
    const result = formatGameTime('2026-02-15T18:30:00Z');
    expect(result).toMatch(/^\d{1,2}:\d{2}[ap]$/);
  });

  it('zero-pads minutes', () => {
    // Use a Date constructed locally so we get a deterministic 7:00 result.
    const d = new Date(2026, 1, 15, 7, 0, 0); // local 07:00
    const result = formatGameTime(d.toISOString());
    expect(result).toMatch(/^\d{1,2}:00[ap]$/);
  });

  it('uses "p" for hours >= 12', () => {
    // 13:30 local
    const d = new Date(2026, 1, 15, 13, 30, 0);
    const result = formatGameTime(d.toISOString());
    expect(result.endsWith('p')).toBe(true);
  });

  it('uses "a" for hours < 12', () => {
    // 09:15 local
    const d = new Date(2026, 1, 15, 9, 15, 0);
    const result = formatGameTime(d.toISOString());
    expect(result.endsWith('a')).toBe(true);
  });

  it('renders midnight as 12:NNa', () => {
    const d = new Date(2026, 1, 15, 0, 0, 0);
    expect(formatGameTime(d.toISOString())).toBe('12:00a');
  });

  it('renders noon as 12:NNp', () => {
    const d = new Date(2026, 1, 15, 12, 0, 0);
    expect(formatGameTime(d.toISOString())).toBe('12:00p');
  });
});
