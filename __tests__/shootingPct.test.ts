import {
  formatShootingPct,
  projShootingPct,
  shootingPct,
} from '@/utils/scoring/shootingPct';

describe('shootingPct', () => {
  // The bug this module exists for: player_historical_stats persists per-game
  // averages as numeric(5,1), so Al Horford's real 2024-25 line (33-for-40 from
  // the line = 82.5%) round-trips as avg_ftm 0.6 / avg_fta 0.6 and divides out
  // to a perfect 100.0%.
  const horfordAvgsOnly = {
    games_played: 60,
    avg_ftm: 0.6,
    avg_fta: 0.6,
    avg_fgm: 3.3,
    avg_fga: 7.7,
  };

  it('reports the stored rate, not the rounded averages', () => {
    expect(shootingPct({ ...horfordAvgsOnly, ft_pct: 0.825 }, 'ft')).toBeCloseTo(82.5, 5);
  });

  it('prefers season totals over the rounded averages', () => {
    expect(shootingPct({ ...horfordAvgsOnly, total_ftm: 33, total_fta: 40 }, 'ft'))
      .toBeCloseTo(82.5, 5);
  });

  it('ranks a stored rate above totals above averages', () => {
    const row = {
      ft_pct: 0.9,
      total_ftm: 33,
      total_fta: 40,
      avg_ftm: 0.6,
      avg_fta: 0.6,
    };
    expect(shootingPct(row, 'ft')).toBeCloseTo(90, 5);
    expect(shootingPct({ ...row, ft_pct: null }, 'ft')).toBeCloseTo(82.5, 5);
  });

  it('still falls back to averages for rows predating the pct backfill', () => {
    // Wrong, but it is what the data supports — better than a blank cell.
    expect(shootingPct(horfordAvgsOnly, 'ft')).toBeCloseTo(100, 5);
  });

  it('maps each stat to its own column family', () => {
    const row = {
      fg_pct: 0.426,
      fg3_pct: 0.365,
      ft_pct: 0.825,
    };
    expect(shootingPct(row, 'fg')).toBeCloseTo(42.6, 5);
    expect(shootingPct(row, 'fg3')).toBeCloseTo(36.5, 5);
    expect(shootingPct(row, 'ft')).toBeCloseTo(82.5, 5);
  });

  it('reads 3P% from the quoted totals columns', () => {
    expect(shootingPct({ total_3pm: 112, total_3pa: 307 }, 'fg3')).toBeCloseTo(36.48, 1);
  });

  it('returns null when there were no attempts', () => {
    expect(shootingPct({ total_ftm: 0, total_fta: 0, avg_ftm: 0, avg_fta: 0 }, 'ft')).toBeNull();
    expect(shootingPct({}, 'ft')).toBeNull();
    expect(shootingPct(null, 'ft')).toBeNull();
    expect(shootingPct(undefined, 'ft')).toBeNull();
  });

  it('handles numerics arriving as strings from PostgREST', () => {
    expect(shootingPct({ ft_pct: '0.825' }, 'ft')).toBeCloseTo(82.5, 5);
    expect(shootingPct({ total_ftm: '33', total_fta: '40' }, 'ft')).toBeCloseTo(82.5, 5);
  });

  it('does not treat a stored 0 as missing', () => {
    // A player who went 0-for-9 shoots 0%, which is not the same as "no data".
    expect(shootingPct({ ft_pct: 0, avg_ftm: 0.6, avg_fta: 0.6 }, 'ft')).toBe(0);
  });
});

describe('projShootingPct', () => {
  // The projections table already stored the right answer; the UI was
  // recomputing 0.5/0.6 = 83.3% instead of reading proj_ft_pct = 0.844.
  const horfordProjection = {
    proj_ftm: 0.5,
    proj_fta: 0.6,
    proj_ft_pct: 0.844,
    proj_3pm: 1.9,
    proj_3pa: 5.2,
  };

  it('uses the stored projected rate', () => {
    expect(projShootingPct(horfordProjection, 'ft')).toBeCloseTo(84.4, 5);
  });

  it('falls back to projected makes/attempts where no rate column exists', () => {
    // proj_fg3_pct does not exist on player_projections.
    expect(projShootingPct(horfordProjection, 'fg3')).toBeCloseTo(36.54, 1);
  });

  it('returns null for a missing projection', () => {
    expect(projShootingPct(null, 'ft')).toBeNull();
  });
});

describe('formatShootingPct', () => {
  it('formats to one decimal with a percent sign', () => {
    expect(formatShootingPct(82.5)).toBe('82.5%');
  });

  it('renders an em dash for no data', () => {
    expect(formatShootingPct(null)).toBe('—');
  });

  it('honours a digit override', () => {
    expect(formatShootingPct(82.53, 0)).toBe('83%');
  });
});
