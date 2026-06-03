import {
  effectiveTimeLimit,
  roundForPick,
  type DraftClockConfig,
} from '../supabase/functions/_shared/draftClock';

describe('roundForPick', () => {
  it('maps pick numbers to 1-based rounds', () => {
    expect(roundForPick(1, 10)).toBe(1);
    expect(roundForPick(10, 10)).toBe(1);
    expect(roundForPick(11, 10)).toBe(2);
    expect(roundForPick(20, 10)).toBe(2);
    expect(roundForPick(21, 10)).toBe(3);
  });

  it('falls back to a single-pick round when picks_per_round is missing', () => {
    expect(roundForPick(5, null)).toBe(5);
    expect(roundForPick(5, 0)).toBe(5);
  });
});

describe('effectiveTimeLimit', () => {
  const base: DraftClockConfig = {
    time_limit: 60,
    picks_per_round: 10,
    accelerate_after_round: null,
    accelerated_time_limit: null,
  };

  it('returns the base limit when acceleration is disabled', () => {
    expect(effectiveTimeLimit(1, base)).toBe(60);
    expect(effectiveTimeLimit(200, base)).toBe(60);
  });

  it('returns the base limit if only one half of the setting is present', () => {
    expect(effectiveTimeLimit(200, { ...base, accelerate_after_round: 3 })).toBe(60);
    expect(effectiveTimeLimit(200, { ...base, accelerated_time_limit: 20 })).toBe(60);
  });

  it('keeps the base clock up to and including the threshold round', () => {
    const cfg: DraftClockConfig = {
      ...base,
      accelerate_after_round: 3,
      accelerated_time_limit: 20,
    };
    expect(effectiveTimeLimit(1, cfg)).toBe(60); // round 1
    expect(effectiveTimeLimit(30, cfg)).toBe(60); // round 3 (last full-speed)
  });

  it('drops to the accelerated clock strictly after the threshold round', () => {
    const cfg: DraftClockConfig = {
      ...base,
      accelerate_after_round: 3,
      accelerated_time_limit: 20,
    };
    expect(effectiveTimeLimit(31, cfg)).toBe(20); // round 4
    expect(effectiveTimeLimit(100, cfg)).toBe(20); // round 10
  });
});
