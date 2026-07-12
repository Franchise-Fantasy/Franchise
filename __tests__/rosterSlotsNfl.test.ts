/**
 * NFL position-model tests + basketball byte-identity guarantee.
 *
 * The NFL set-membership layer (DISJOINT_POSITION_TOKENS) was added ON TOP of
 * the basketball spectrum in rosterSlotsShared.ts. The identity suite here
 * proves basketball behavior is unchanged: the pre-NFL algorithms are inlined
 * verbatim as oracles and compared against the live implementations across an
 * exhaustive basketball token universe (order included — byte identity, not
 * just set equality).
 */
import { getDefaultRosterSlots, getLimitablePositions, NBA_POSITIONS, NFL_POSITIONS, WNBA_POSITIONS } from '@/constants/LeagueDefaults';
import { checkPositionLimits } from '@/utils/roster/positionLimits';
import { sortSlotsBySport } from '@/utils/roster/rosterConfigOrder';
import {
  getEligiblePositions,
  getLimitMatchKeys,
  isEligibleForSlot,
  POSITION_SPECTRUM,
  POSITION_TOKEN_RANGES,
} from '@/utils/roster/rosterSlotsShared';
import { getSportModule } from '@/utils/sports/registry';

// ── Pre-NFL oracles (verbatim copies of the old implementations) ─────────────

function oldGetEligiblePositions(playerPosition: string): string[] {
  const ranges = playerPosition
    .split('-')
    .map((p) => POSITION_TOKEN_RANGES[p])
    .filter((r): r is [number, number] => r !== undefined);
  if (ranges.length === 0) return [];

  const min = Math.min(...ranges.map(([s]) => s));
  const max = Math.max(...ranges.map(([, e]) => e));
  return POSITION_SPECTRUM.slice(min, max + 1);
}

function oldGetLimitMatchKeys(playerPosition: string): string[] {
  const [primaryToken] = playerPosition.split('-');
  const range = POSITION_TOKEN_RANGES[primaryToken];
  if (!range) return [];

  const eligible = POSITION_SPECTRUM.slice(range[0], range[1] + 1);
  const keys = new Set<string>(eligible);
  if (eligible.includes('PG') || eligible.includes('SG')) keys.add('G');
  if (eligible.includes('SF') || eligible.includes('PF')) keys.add('F');
  return Array.from(keys);
}

// ── Basketball byte-identity ─────────────────────────────────────────────────

describe('basketball behavior is byte-identical after the NFL layer', () => {
  const singles = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F'];
  const junk = ['', 'X', 'N/A', 'G-X', 'X-C', 'UNKNOWN'];
  const pairs = singles.flatMap((a) => singles.map((b) => `${a}-${b}`));
  const triples = ['PG-SG-SF', 'G-F-C', 'C-F-G', 'SF-PG-C'];
  const universe = [...singles, ...pairs, ...triples, ...junk];

  it('getEligiblePositions matches the pre-NFL algorithm for every basketball token (order included)', () => {
    for (const token of universe) {
      expect(getEligiblePositions(token)).toEqual(oldGetEligiblePositions(token));
    }
  });

  it('getLimitMatchKeys matches the pre-NFL algorithm for every basketball token (order included)', () => {
    for (const token of universe) {
      expect(getLimitMatchKeys(token)).toEqual(oldGetLimitMatchKeys(token));
    }
  });

  it('isEligibleForSlot is unchanged for every basketball token × slot', () => {
    const slots = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL', 'UTIL2', 'BE', 'IR', 'TAXI', 'DROPPED'];
    for (const token of universe) {
      const oldEligible = oldGetEligiblePositions(token);
      for (const slot of slots) {
        const oldResult = ['UTIL', 'UTIL2', 'BE', 'IR'].includes(slot)
          ? true
          : { PG: ['PG'], SG: ['SG'], SF: ['SF'], PF: ['PF'], C: ['C'], G: ['PG', 'SG'], F: ['SF', 'PF'] }[
              slot as 'PG'
            ]?.some((pos) => oldEligible.includes(pos)) ?? false;
        expect(isEligibleForSlot(token, slot)).toBe(oldResult);
      }
    }
  });
});

// ── NFL eligibility ──────────────────────────────────────────────────────────

describe('NFL position eligibility (disjoint set membership)', () => {
  it.each(['QB', 'RB', 'WR', 'TE', 'K', 'DST'])('%s is eligible only for itself among position tokens', (token) => {
    expect(getEligiblePositions(token)).toEqual([token]);
  });

  it('FLEX accepts RB/WR/TE and rejects QB/K/DST', () => {
    for (const pos of ['RB', 'WR', 'TE']) expect(isEligibleForSlot(pos, 'FLEX')).toBe(true);
    for (const pos of ['QB', 'K', 'DST']) expect(isEligibleForSlot(pos, 'FLEX')).toBe(false);
  });

  it('SFLX (superflex) accepts QB/RB/WR/TE and rejects K/DST', () => {
    for (const pos of ['QB', 'RB', 'WR', 'TE']) expect(isEligibleForSlot(pos, 'SFLX')).toBe(true);
    for (const pos of ['K', 'DST']) expect(isEligibleForSlot(pos, 'SFLX')).toBe(false);
  });

  it('dedicated slots accept only their own position', () => {
    expect(isEligibleForSlot('QB', 'QB')).toBe(true);
    expect(isEligibleForSlot('RB', 'QB')).toBe(false);
    expect(isEligibleForSlot('DST', 'DST')).toBe(true);
    expect(isEligibleForSlot('K', 'DST')).toBe(false);
    expect(isEligibleForSlot('WR', 'RB')).toBe(false);
  });

  it('structural slots (BE/IR/UTIL) accept any NFL position', () => {
    for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DST']) {
      expect(isEligibleForSlot(pos, 'BE')).toBe(true);
      expect(isEligibleForSlot(pos, 'IR')).toBe(true);
      expect(isEligibleForSlot(pos, 'UTIL')).toBe(true);
    }
  });

  it('NFL tokens never leak basketball eligibility and vice versa', () => {
    expect(isEligibleForSlot('QB', 'G')).toBe(false);
    expect(isEligibleForSlot('PG', 'FLEX')).toBe(false);
    expect(isEligibleForSlot('C', 'SFLX')).toBe(false);
  });

  it.each(['QB', 'RB', 'WR', 'TE', 'K', 'DST'])('getLimitMatchKeys("%s") counts only toward itself', (token) => {
    expect(getLimitMatchKeys(token)).toEqual([token]);
  });

  it('checkPositionLimits enforces NFL caps independently per position', () => {
    const roster = [
      { position: 'QB', roster_slot: 'QB' },
      { position: 'QB', roster_slot: 'BE' },
      { position: 'RB', roster_slot: 'RB' },
    ];
    // QB cap reached — adding a third QB is blocked.
    expect(checkPositionLimits({ QB: 2 }, roster, 'QB')).toEqual({ position: 'QB', current: 2, max: 2 });
    // RB add is unaffected by the QB cap.
    expect(checkPositionLimits({ QB: 2 }, roster, 'RB')).toBeNull();
  });
});

// ── Registry coherence ───────────────────────────────────────────────────────

describe('sports registry', () => {
  it('registry position lists match the LeagueDefaults type-carrying tuples', () => {
    expect(getSportModule('nba').positions).toEqual([...NBA_POSITIONS]);
    expect(getSportModule('wnba').positions).toEqual([...WNBA_POSITIONS]);
    expect(getSportModule('nfl').positions).toEqual([...NFL_POSITIONS]);
  });

  it('falls back to NBA for unknown sports (existing app convention)', () => {
    expect(getSportModule('nhl').sport).toBe('nba');
    expect(getSportModule(null).sport).toBe('nba');
    expect(getSportModule(undefined).sport).toBe('nba');
  });

  it('every NFL scoring stat maps to a player_games column', () => {
    const nfl = getSportModule('nfl');
    for (const cat of nfl.defaultScoring) {
      expect(nfl.statToGame[cat.stat_name]).toBeTruthy();
      expect(nfl.statToTotal[cat.stat_name]).toBe(`total_${nfl.statToGame[cat.stat_name]}`);
    }
  });

  it('PPR presets differ only in the REC weight (0 / 0.5 / 1)', () => {
    const nfl = getSportModule('nfl');
    const presets = nfl.scoringPresets!;
    const recOf = (name: string) => presets[name].find((c) => c.stat_name === 'REC')!.point_value;
    expect(recOf('standard')).toBe(0);
    expect(recOf('half_ppr')).toBe(0.5);
    expect(recOf('full_ppr')).toBe(1);
    for (const name of ['standard', 'full_ppr']) {
      const others = presets[name].filter((c) => c.stat_name !== 'REC');
      const half = presets.half_ppr.filter((c) => c.stat_name !== 'REC');
      expect(others).toEqual(half);
    }
    expect(nfl.defaultScoring).toEqual(presets.half_ppr);
  });

  it('NFL module invariants: Tue–Mon weeks, points-only, no projections', () => {
    const nfl = getSportModule('nfl');
    expect(nfl.weekEndDow).toBe(1);
    expect(nfl.supportsCategories).toBe(false);
    expect(nfl.statToProj).toEqual({});
    expect(nfl.seasonFormat).toBe('single-year');
  });

  it('LeagueDefaults sport-keyed getters serve NFL from the registry', () => {
    const slots = getDefaultRosterSlots('nfl');
    expect(slots.map((s) => `${s.position}:${s.count}`)).toEqual([
      // SFLX ships at 0 — the opt-in superflex seat the wizard stepper enables.
      'QB:1', 'RB:2', 'WR:2', 'TE:1', 'FLEX:1', 'SFLX:0', 'K:1', 'DST:1', 'BE:6', 'IR:1', 'TAXI:0',
    ]);
    // Fresh copies — mutating the result must not corrupt the registry.
    slots[0].count = 99;
    expect(getDefaultRosterSlots('nfl')[0].count).toBe(1);
    expect(getLimitablePositions('nfl')).toEqual(['QB', 'RB', 'WR', 'TE', 'K', 'DST']);
  });
});

// ── Roster config display order ──────────────────────────────────────────────

describe('sortSlotsBySport with NFL configs', () => {
  it('sorts NFL slots into QB→DST order', () => {
    const shuffled = ['DST', 'BE', 'WR', 'QB', 'FLEX', 'IR', 'TE', 'K', 'RB', 'SFLX'].map(
      (position) => ({ position }),
    );
    expect(sortSlotsBySport(shuffled).map((s) => s.position)).toEqual([
      'QB', 'RB', 'WR', 'TE', 'FLEX', 'SFLX', 'K', 'DST', 'BE', 'IR',
    ]);
  });

  it('does not misdetect WNBA configs as NFL', () => {
    const wnba = ['C', 'UTIL', 'G', 'BE', 'F', 'IR'].map((position) => ({ position }));
    expect(sortSlotsBySport(wnba).map((s) => s.position)).toEqual(['G', 'F', 'C', 'UTIL', 'BE', 'IR']);
  });
});
