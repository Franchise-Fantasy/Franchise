import {
  assignRosterSlots,
  computeRosterSize,
  mapSleeperPositions,
  mapSleeperScoring,
  matchPlayers,
  normalizePlayerName,
  type OurPlayer,
  type SleeperPlayer,
} from '@/utils/sleeperMapping';

describe('mapSleeperPositions', () => {
  it('counts each Sleeper position into our slots', () => {
    const slots = mapSleeperPositions(['PG', 'SG', 'SF', 'PF', 'C', 'BN', 'BN', 'IR']);
    const map = new Map(slots.map((s) => [s.position, s.count]));
    expect(map.get('PG')).toBe(1);
    expect(map.get('SG')).toBe(1);
    expect(map.get('SF')).toBe(1);
    expect(map.get('PF')).toBe(1);
    expect(map.get('C')).toBe(1);
    expect(map.get('BE')).toBe(2); // BN → BE
    expect(map.get('IR')).toBe(1);
  });

  it('maps FLEX → UTIL', () => {
    const slots = mapSleeperPositions(['FLEX', 'FLEX']);
    expect(slots.find((s) => s.position === 'UTIL')!.count).toBe(2);
  });

  it('IL is an alias for IR', () => {
    const slots = mapSleeperPositions(['IL', 'IL']);
    expect(slots.find((s) => s.position === 'IR')!.count).toBe(2);
  });

  it('always includes TAXI in the output (with 0 count by default)', () => {
    const slots = mapSleeperPositions(['PG']);
    const taxi = slots.find((s) => s.position === 'TAXI');
    expect(taxi).toBeTruthy();
    expect(taxi!.count).toBe(0);
  });

  it('ignores unknown Sleeper positions', () => {
    const slots = mapSleeperPositions(['XYZ', 'PG']);
    expect(slots.find((s) => s.position === 'PG')!.count).toBe(1);
  });
});

describe('mapSleeperScoring', () => {
  it('maps known scoring keys into our stat names', () => {
    const result = mapSleeperScoring({ pts: 1, reb: 1.2, ast: 1.5, to: -1, fg3m: 0.5 });
    const map = new Map(result.map((c) => [c.stat_name, c.point_value]));
    expect(map.get('PTS')).toBe(1);
    expect(map.get('REB')).toBe(1.2);
    expect(map.get('AST')).toBe(1.5);
    expect(map.get('TO')).toBe(-1);
    expect(map.get('3PM')).toBe(0.5);
  });

  it('accepts alternate keys: threes/turnovers/double_double/triple_double', () => {
    const result = mapSleeperScoring({ threes: 1.5, turnovers: -2, double_double: 3, triple_double: 5 });
    const map = new Map(result.map((c) => [c.stat_name, c.point_value]));
    expect(map.get('3PM')).toBe(1.5);
    expect(map.get('TO')).toBe(-2);
    expect(map.get('DD')).toBe(3);
    expect(map.get('TD')).toBe(5);
  });

  it('keeps the default point_value for missing categories', () => {
    const result = mapSleeperScoring({ pts: 99 });
    const pts = result.find((c) => c.stat_name === 'PTS')!;
    const reb = result.find((c) => c.stat_name === 'REB')!;
    expect(pts.point_value).toBe(99);
    expect(reb.point_value).toBeDefined(); // unchanged default
  });
});

describe('normalizePlayerName', () => {
  it('lowercases and strips accents', () => {
    expect(normalizePlayerName('Luka Dončić')).toBe('luka doncic');
  });

  it('strips Jr/Sr/II/III/IV/V suffixes', () => {
    expect(normalizePlayerName('Michael Porter Jr.')).toBe('michael porter');
    expect(normalizePlayerName('Tim Hardaway II')).toBe('tim hardaway');
    expect(normalizePlayerName('Cam Reddish Sr')).toBe('cam reddish');
  });

  it('removes periods and apostrophes/hyphens', () => {
    expect(normalizePlayerName('P.J. Tucker')).toBe('pj tucker');
    expect(normalizePlayerName("De'Aaron Fox")).toBe('deaaron fox');
    expect(normalizePlayerName('Karl-Anthony Towns')).toBe('karlanthony towns');
  });

  it('collapses whitespace', () => {
    expect(normalizePlayerName('  Steph   Curry  ')).toBe('steph curry');
  });
});

describe('matchPlayers', () => {
  const ours: OurPlayer[] = [
    { id: '1', name: 'LeBron James', pro_team: 'LAL', position: 'SF' },
    { id: '2', name: 'Stephen Curry', pro_team: 'GSW', position: 'PG' },
    { id: '3', name: 'P.J. Tucker', pro_team: 'PHI', position: 'PF' },
  ];

  it('high-confidence match when name + team match exactly', () => {
    const sleeper: SleeperPlayer[] = [
      { player_id: 's1', full_name: 'LeBron James', team: 'LAL', position: 'SF', fantasy_positions: null },
    ];
    const { matched, unmatched } = matchPlayers(sleeper, ours);
    expect(unmatched).toEqual([]);
    expect(matched).toHaveLength(1);
    expect(matched[0].confidence).toBe('high');
    expect(matched[0].matched_player_id).toBe('1');
  });

  it('medium-confidence match when only name matches', () => {
    const sleeper: SleeperPlayer[] = [
      { player_id: 's2', full_name: 'Stephen Curry', team: 'XYZ', position: 'PG', fantasy_positions: null },
    ];
    const { matched } = matchPlayers(sleeper, ours);
    expect(matched[0].confidence).toBe('medium');
    expect(matched[0].matched_player_id).toBe('2');
  });

  it('ambiguous name (multiple matches) → unmatched with confidence "low"', () => {
    const ours2: OurPlayer[] = [
      { id: '1', name: 'Brandon Williams', pro_team: 'LAL', position: 'PG' },
      { id: '2', name: 'Brandon Williams', pro_team: 'MIL', position: 'PG' },
    ];
    const sleeper: SleeperPlayer[] = [
      { player_id: 'sx', full_name: 'Brandon Williams', team: 'XYZ', position: 'PG', fantasy_positions: null },
    ];
    const { matched, unmatched } = matchPlayers(sleeper, ours2);
    expect(matched).toEqual([]);
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].confidence).toBe('low');
  });

  it('completely unknown name → "none"', () => {
    const sleeper: SleeperPlayer[] = [
      { player_id: 'sx', full_name: 'Nobody Ever', team: 'XYZ', position: 'PG', fantasy_positions: null },
    ];
    const { unmatched } = matchPlayers(sleeper, ours);
    expect(unmatched[0].confidence).toBe('none');
  });
});

describe('assignRosterSlots', () => {
  it('maps starters into their position slots', () => {
    const slots = assignRosterSlots(
      ['p1', 'p2', 'p3'],
      ['p1', 'p2', 'p3', 'p4'],
      null,
      ['PG', 'SG', 'C', 'BN'],
    );
    expect(slots.get('p1')).toBe('PG');
    expect(slots.get('p2')).toBe('SG');
    expect(slots.get('p3')).toBe('C');
    expect(slots.get('p4')).toBe('BE');
  });

  it('numbers UTIL slots (UTIL1, UTIL2, ...)', () => {
    const slots = assignRosterSlots(
      ['p1', 'p2'],
      ['p1', 'p2'],
      null,
      ['UTIL', 'UTIL'],
    );
    expect(slots.get('p1')).toBe('UTIL1');
    expect(slots.get('p2')).toBe('UTIL2');
  });

  it('places reserve players in IR', () => {
    const slots = assignRosterSlots(
      ['p1'],
      ['p1', 'p2', 'p3'],
      ['p3'],
      ['PG', 'BN', 'IR'],
    );
    expect(slots.get('p3')).toBe('IR');
    expect(slots.get('p2')).toBe('BE'); // not a starter, not reserve → bench
  });

  it('skips empty slot markers (0 or empty)', () => {
    const slots = assignRosterSlots(
      ['p1', '0', 'p3'],
      ['p1', 'p3'],
      null,
      ['PG', 'SG', 'C'],
    );
    expect(slots.has('0')).toBe(false);
    expect(slots.get('p3')).toBe('C');
  });
});

describe('computeRosterSize', () => {
  it('sums counts but excludes IR', () => {
    const slots = [
      { position: 'PG', label: '', count: 1 },
      { position: 'SG', label: '', count: 1 },
      { position: 'BE', label: '', count: 3 },
      { position: 'IR', label: '', count: 2 },
    ];
    expect(computeRosterSize(slots)).toBe(5);
  });
});
