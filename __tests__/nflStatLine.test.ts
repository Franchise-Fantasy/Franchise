/**
 * Unit tests for the shared NFL stat-line formatter
 * (utils/scoring/nflStatLine.ts — zero-dep, used by client cells and the
 * poll-live-stats Live Activity lines).
 */
import {
  deriveNflEvents,
  NFL_EVENT_DEFS,
  NFL_GAME_COLUMNS,
  nflEventLabel,
  nflStatFields,
  nflStatLine,
} from '@/utils/scoring/nflStatLine';
import { getSportModule } from '@/utils/sports/registry';


describe('nflStatFields — position shaping', () => {
  it('passer: leads with passing, keeps INT as the third block', () => {
    const fields = nflStatFields({ pass_att: 27, pass_cmp: 18, pass_yd: 245, pass_td: 2, pass_int: 1, rush_yd: 4 });
    expect(fields).toEqual([['pass_yd', 'Y'], ['pass_td', 'TD'], ['pass_int', 'INT']]);
  });

  it('passer with a real rushing day swaps INT for rushing yards', () => {
    const fields = nflStatFields({ pass_att: 30, pass_yd: 280, pass_td: 3, pass_int: 0, rush_yd: 52 });
    expect(fields).toEqual([['pass_yd', 'Y'], ['pass_td', 'TD'], ['rush_yd', 'RuY']]);
  });

  it('receiver: REC / yards / TDs', () => {
    const fields = nflStatFields({ rec: 5, targets: 8, rec_yd: 87, rec_td: 1, rush_yd: 0 });
    expect(fields).toEqual([['rec', 'REC'], ['rec_yd', 'Y'], ['rec_td', 'TD']]);
  });

  it('rusher whose ground day beats his receiving day leads with rushing', () => {
    const fields = nflStatFields({ rush_att: 18, rush_yd: 92, rush_td: 1, rec: 2, rec_yd: 11 });
    expect(fields).toEqual([['rush_yd', 'Y'], ['rush_td', 'TD'], ['rec', 'REC']]);
  });

  it('kicker: FG made/attempted + XP', () => {
    const fields = nflStatFields({ fg_made: 2, fg_att: 3, xp_made: 2 });
    expect(fields).toEqual([['fg_made', 'FG'], ['fg_att', 'FGA'], ['xp_made', 'XP']]);
  });

  it('D/ST: sacks, takeaways, points allowed', () => {
    const fields = nflStatFields({ dst_sacks: 4, dst_int: 2, dst_fum_rec: 1, dst_pts_allowed: 13 });
    expect(fields).toEqual([['dst_sacks', 'SCK'], ['dst_int', 'INT'], ['dst_pts_allowed', 'PA']]);
  });
});

describe('nflStatLine', () => {
  it('QB line leads with the completions/attempts fraction', () => {
    expect(nflStatLine({ pass_att: 27, pass_cmp: 18, pass_yd: 245, pass_td: 2, pass_int: 1 }))
      .toBe('18/27 245Y 2TD');
  });

  it('skill line has no fraction', () => {
    expect(nflStatLine({ rec: 5, rec_yd: 87, rec_td: 1 })).toBe('5REC 87Y 1TD');
  });

  it('missing values render as 0, not NaN', () => {
    expect(nflStatLine({ rec: 3 })).toBe('3REC 0Y 0TD');
  });
});

describe('NFL_GAME_COLUMNS ↔ registry alignment', () => {
  it('covers every scored NFL stat column (except never-ingested two_pt/dst_safety)', () => {
    const scored = Object.values(getSportModule('nfl').statToGame)
      .filter((col) => col !== 'two_pt' && col !== 'dst_safety');
    for (const col of scored) {
      expect(NFL_GAME_COLUMNS).toContain(col);
    }
  });
});

// ── Live event tape ──────────────────────────────────────────────────────────

describe('deriveNflEvents', () => {
  it('emits one event per positive stat delta', () => {
    const prev = { pass_td: 1, rush_td: 0, pass_int: 1 };
    const curr = { pass_td: 3, rush_td: 1, pass_int: 1 };
    expect(deriveNflEvents(prev, curr)).toEqual([
      { kind: 'PASS_TD', value: 2 },
      { kind: 'RUSH_TD', value: 1 },
    ]);
  });

  it('ignores negative deltas — a stat revised DOWN must not "un-score" a play', () => {
    // BDL occasionally reverses a TD on review. Emitting a negative event would
    // be worse than staying silent: the tape would read "-1 RUSHING TD".
    expect(deriveNflEvents({ rush_td: 2 }, { rush_td: 1 })).toEqual([]);
  });

  it('treats a missing/null column as zero, not NaN', () => {
    expect(deriveNflEvents({}, { rec_td: 1, fum_lost: null as unknown as number })).toEqual([
      { kind: 'REC_TD', value: 1 },
    ]);
  });

  it('emits D/ST takeaways but never points-allowed (it is not a highlight)', () => {
    const events = deriveNflEvents(
      { dst_sacks: 1, dst_pts_allowed: 7 },
      { dst_sacks: 3, dst_int: 1, dst_pts_allowed: 21 },
    );
    expect(events).toEqual([
      { kind: 'DST_SACK', value: 2 },
      { kind: 'DST_INT', value: 1 },
    ]);
  });

  it('every event kind is named after a real scoring stat, so fpts = value × weight', () => {
    // The client relies on this: MatchupTicker does `value * w(kind)` with no map.
    const scored = new Set(Object.keys(getSportModule('nfl').statToGame));
    for (const def of NFL_EVENT_DEFS) {
      expect(scored.has(def.kind)).toBe(true);
    }
  });
});

describe('nflEventLabel', () => {
  it('singularizes and pluralizes', () => {
    expect(nflEventLabel('PASS_TD', 1)).toBe('PASSING TD');
    expect(nflEventLabel('PASS_TD', 2)).toBe('2 PASSING TDS');
    expect(nflEventLabel('DST_SACK', 3)).toBe('3 SACKS');
  });

  it('returns null for a basketball kind so the caller falls through', () => {
    expect(nflEventLabel('MADE_3PT', 1)).toBeNull();
  });
});
