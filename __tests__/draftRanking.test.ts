import {
  DRAFT_PROJECTION_GAME_THRESHOLD,
  effectiveDraftPts,
  preferProjection,
  restrictToRosterNeeds,
} from '@/utils/draft/draftRanking';
import { isEligibleForSlot } from '@/utils/roster/rosterSlotsShared';

describe('preferProjection', () => {
  it('prefers a projection until the games threshold is crossed', () => {
    expect(preferProjection(0)).toBe(true);
    expect(preferProjection(DRAFT_PROJECTION_GAME_THRESHOLD - 1)).toBe(true);
    expect(preferProjection(DRAFT_PROJECTION_GAME_THRESHOLD)).toBe(false);
    expect(preferProjection(40)).toBe(false);
  });

  it('treats null / undefined games as no sample (preseason)', () => {
    expect(preferProjection(null)).toBe(true);
    expect(preferProjection(undefined)).toBe(true);
  });
});

describe('effectiveDraftPts', () => {
  it('uses current average once the player has enough games', () => {
    expect(
      effectiveDraftPts({
        gamesPlayed: 20,
        currentAvgPts: 18.2,
        seasonProjPts: 25, // ignored — real sample wins
        lastSeasonAvgPts: 22,
      }),
    ).toBe(18.2);
  });

  it('uses the season projection for a thin-sample player', () => {
    expect(
      effectiveDraftPts({
        gamesPlayed: 2,
        currentAvgPts: 4.1, // 2-game noise, ignored
        seasonProjPts: 23.4,
        lastSeasonAvgPts: 19,
      }),
    ).toBe(23.4);
  });

  it('falls back to last-season production when no projection exists', () => {
    expect(
      effectiveDraftPts({
        gamesPlayed: 0,
        currentAvgPts: null,
        seasonProjPts: null,
        lastSeasonAvgPts: 16.5,
      }),
    ).toBe(16.5);
  });

  it('falls through when a player has enough games but no recorded average', () => {
    // Defensive: gp >= threshold but avg somehow null → use the next signal.
    expect(
      effectiveDraftPts({
        gamesPlayed: 30,
        currentAvgPts: null,
        seasonProjPts: 12,
      }),
    ).toBe(12);
  });

  it('returns 0 when nothing is known (preseason fringe player)', () => {
    expect(
      effectiveDraftPts({
        gamesPlayed: 0,
        currentAvgPts: null,
        seasonProjPts: null,
        lastSeasonAvgPts: null,
      }),
    ).toBe(0);
  });

  it('preseason star (0 games, projection present) ranks on the projection', () => {
    // The WNBA pre-tipoff case that broke autodraft: everyone has 0 games and
    // NULL current avg, so ranking must come from the projection.
    const wilson = effectiveDraftPts({ gamesPlayed: 0, currentAvgPts: null, seasonProjPts: 23.4 });
    const benchWarmer = effectiveDraftPts({ gamesPlayed: 0, currentAvgPts: null, seasonProjPts: 3.1 });
    expect(wilson).toBeGreaterThan(benchWarmer);
  });
});

describe('restrictToRosterNeeds', () => {
  // NFL default starter shape (registry defaults, SFLX at 0 like a fresh league).
  const NFL_CONFIGS = [
    { position: 'QB', slot_count: 1 },
    { position: 'RB', slot_count: 2 },
    { position: 'WR', slot_count: 2 },
    { position: 'TE', slot_count: 1 },
    { position: 'FLEX', slot_count: 1 },
    { position: 'SFLX', slot_count: 0 },
    { position: 'K', slot_count: 1 },
    { position: 'DST', slot_count: 1 },
    { position: 'BE', slot_count: 6 },
    { position: 'IR', slot_count: 1 },
  ];

  const player = (position: string, name = position) => ({ position, name });

  it('does not bind while remaining picks exceed vacant starter slots', () => {
    const ranked = [player('RB'), player('WR'), player('K'), player('DST')];
    const result = restrictToRosterNeeds({
      ranked,
      configs: NFL_CONFIGS,
      roster: [], // nothing drafted: 9 vacancies, 15 picks remaining
      remainingPicks: 15,
      isEligibleForSlot,
    });
    expect(result).toBe(ranked);
  });

  it('forces K/DST at the tail of an NFL draft', () => {
    // 7 starters filled, 6 bench filled → only K + DST vacant, 2 picks left.
    const roster = [
      { roster_slot: 'QB' }, { roster_slot: 'RB' }, { roster_slot: 'RB' },
      { roster_slot: 'WR' }, { roster_slot: 'WR' }, { roster_slot: 'TE' },
      { roster_slot: 'FLEX' },
      ...Array.from({ length: 6 }, () => ({ roster_slot: 'BE' })),
    ];
    const ranked = [player('RB', 'best-rb'), player('WR', 'best-wr'), player('K', 'best-k'), player('DST', 'best-dst')];
    const result = restrictToRosterNeeds({
      ranked, configs: NFL_CONFIGS, roster, remainingPicks: 2, isEligibleForSlot,
    });
    expect(result.map((p) => p.name)).toEqual(['best-k', 'best-dst']);
  });

  it('FLEX vacancy admits RB/WR/TE but not QB or K', () => {
    // Everything filled except FLEX, one pick left.
    const roster = [
      { roster_slot: 'QB' }, { roster_slot: 'RB' }, { roster_slot: 'RB' },
      { roster_slot: 'WR' }, { roster_slot: 'WR' }, { roster_slot: 'TE' },
      { roster_slot: 'K' }, { roster_slot: 'DST' },
      ...Array.from({ length: 6 }, () => ({ roster_slot: 'BE' })),
    ];
    const ranked = [player('QB'), player('K'), player('TE', 'flex-te'), player('RB', 'flex-rb')];
    const result = restrictToRosterNeeds({
      ranked, configs: NFL_CONFIGS, roster, remainingPicks: 1, isEligibleForSlot,
    });
    expect(result.map((p) => p.name)).toEqual(['flex-te', 'flex-rb']);
  });

  it('SFLX vacancy admits a QB', () => {
    const configs = NFL_CONFIGS.map((c) => (c.position === 'SFLX' ? { ...c, slot_count: 1 } : c));
    const roster = [
      { roster_slot: 'QB' }, { roster_slot: 'RB' }, { roster_slot: 'RB' },
      { roster_slot: 'WR' }, { roster_slot: 'WR' }, { roster_slot: 'TE' },
      { roster_slot: 'FLEX' }, { roster_slot: 'K' }, { roster_slot: 'DST' },
      ...Array.from({ length: 6 }, () => ({ roster_slot: 'BE' })),
    ];
    const ranked = [player('K', 'second-k'), player('DST', 'second-dst'), player('QB', 'sflx-qb')];
    const result = restrictToRosterNeeds({
      ranked, configs, roster, remainingPicks: 1, isEligibleForSlot,
    });
    expect(result.map((p) => p.name)).toEqual(['sflx-qb']);
  });

  it('falls back to the full pool when nobody can fill a vacancy (deadlock prevention)', () => {
    const roster = [
      { roster_slot: 'QB' }, { roster_slot: 'RB' }, { roster_slot: 'RB' },
      { roster_slot: 'WR' }, { roster_slot: 'WR' }, { roster_slot: 'TE' },
      { roster_slot: 'FLEX' }, { roster_slot: 'K' },
      ...Array.from({ length: 6 }, () => ({ roster_slot: 'BE' })),
    ];
    const ranked = [player('RB'), player('WR')]; // no DST left in the pool
    const result = restrictToRosterNeeds({
      ranked, configs: NFL_CONFIGS, roster, remainingPicks: 1, isEligibleForSlot,
    });
    expect(result).toBe(ranked);
  });

  it('counts numbered UTIL slots against a UTIL config (basketball semantics)', () => {
    const configs = [
      { position: 'C', slot_count: 1 },
      { position: 'UTIL', slot_count: 2 },
      { position: 'BE', slot_count: 1 },
    ];
    const roster = [{ roster_slot: 'UTIL1' }, { roster_slot: 'UTIL2' }, { roster_slot: 'BE' }];
    const ranked = [player('PG', 'guard'), player('C', 'center')];
    // Only C vacant, 1 pick left → centers only.
    const result = restrictToRosterNeeds({
      ranked, configs, roster, remainingPicks: 1, isEligibleForSlot,
    });
    expect(result.map((p) => p.name)).toEqual(['center']);
  });

  it('a full 15-round bot draft ends with every starter slot filled and no bench overflow', () => {
    // Simulate the autodraft loop: rank by value, apply the guard, take the
    // top candidate, assign a slot the way findBestSlot does. The pool mirrors
    // real life: skill players all outscore every K and DST.
    const pool: { position: string; value: number }[] = [
      ...Array.from({ length: 40 }, (_, i) => ({ position: 'RB', value: 200 - i })),
      ...Array.from({ length: 40 }, (_, i) => ({ position: 'WR', value: 195 - i })),
      ...Array.from({ length: 15 }, (_, i) => ({ position: 'QB', value: 190 - i })),
      ...Array.from({ length: 15 }, (_, i) => ({ position: 'TE', value: 150 - i })),
      ...Array.from({ length: 10 }, (_, i) => ({ position: 'K', value: 40 - i })),
      ...Array.from({ length: 10 }, (_, i) => ({ position: 'DST', value: 35 - i })),
    ].sort((a, b) => b.value - a.value);

    const assignSlot = (roster: { roster_slot: string }[], position: string): string => {
      for (const config of NFL_CONFIGS) {
        if (config.position === 'BE' || config.position === 'IR') continue;
        if (!isEligibleForSlot(position, config.position)) continue;
        const filled = roster.filter((p) => p.roster_slot === config.position).length;
        if (filled < config.slot_count) return config.position;
      }
      return 'BE';
    };

    const roster: { position: string; roster_slot: string }[] = [];
    const rounds = 15;
    for (let pick = 0; pick < rounds; pick++) {
      const restricted = restrictToRosterNeeds({
        ranked: pool,
        configs: NFL_CONFIGS,
        roster,
        remainingPicks: rounds - roster.length,
        isEligibleForSlot,
      });
      const chosen = restricted[0];
      pool.splice(pool.indexOf(chosen), 1);
      roster.push({ position: chosen.position, roster_slot: assignSlot(roster, chosen.position) });
    }

    const bySlot = (slot: string) => roster.filter((r) => r.roster_slot === slot).length;
    expect(bySlot('QB')).toBe(1);
    expect(bySlot('RB')).toBe(2);
    expect(bySlot('WR')).toBe(2);
    expect(bySlot('TE')).toBe(1);
    expect(bySlot('FLEX')).toBe(1);
    expect(bySlot('K')).toBe(1);
    expect(bySlot('DST')).toBe(1);
    expect(bySlot('BE')).toBe(6); // exactly bench capacity — no overflow
    expect(roster).toHaveLength(15);
  });
});
