import type { ProjectionRow } from '@/hooks/usePlayerProjections';
import type { PlayerSeasonStats } from '@/types/player';
import {
  displayGamesPlayed,
  resolveStatBasis,
  spokenStatBasis,
} from '@/utils/scoring/statBasis';

// A pre-tipoff matview row: the matview is scoped to season_config.is_current,
// so between the rollover and opening night every player looks like this.
function emptyRow(overrides: Partial<PlayerSeasonStats> = {}): PlayerSeasonStats {
  return {
    player_id: 'p1',
    name: 'Test Player',
    position: 'PG',
    pro_team: 'BOS',
    status: 'active',
    external_id_nba: '123',
    games_played: 0,
    avg_pts: null,
    avg_reb: null,
    avg_ast: null,
    avg_stl: null,
    avg_blk: null,
    avg_tov: null,
    avg_min: null,
    total_pts: 0,
    total_reb: 0,
    total_ast: 0,
    total_fgm: 0,
    total_fga: 0,
    total_3pm: 0,
    total_3pa: 0,
    total_ftm: 0,
    total_fta: 0,
    ...overrides,
  } as unknown as PlayerSeasonStats;
}

function projection(overrides: Partial<ProjectionRow> = {}): ProjectionRow {
  return {
    player_id: 'p1',
    proj_pts: 24.4,
    proj_reb: 5.1,
    proj_ast: 6.2,
    proj_min: 34.0,
    proj_fgm: 8.5,
    proj_fga: 18.0,
    proj_ftm: 5.0,
    proj_fta: 6.0,
    projected_games: 68,
    ...overrides,
  } as unknown as ProjectionRow;
}

const LABEL = "'25-'26";

const resolve = (
  player: PlayerSeasonStats,
  proj?: ProjectionRow,
  hist?: Record<string, unknown>,
  sport = 'nba',
) => resolveStatBasis({ player, projection: proj, historical: hist, sport, prevSeasonLabel: LABEL });

describe('resolveStatBasis', () => {
  it('keeps the real line once the current-season sample is thick enough', () => {
    const player = emptyRow({ games_played: 40, avg_pts: 19.2 } as Partial<PlayerSeasonStats>);
    const out = resolve(player, projection());

    expect(out.basis).toBe('season');
    expect(out.hasStats).toBe(true);
    expect(out.label).toBeNull();
    // The projection must NOT win over a real sample.
    expect(out.row.avg_pts).toBe(19.2);
  });

  it('uses the season projection for an empty pre-tipoff row', () => {
    const out = resolve(emptyRow(), projection());

    expect(out.basis).toBe('projected');
    expect(out.hasStats).toBe(true);
    expect(out.label).toBe('PROJ');
    expect(out.row.avg_pts).toBe(24.4);
    // Totals are rebuilt so calculateAvgFantasyPoints (totals ÷ games) divides
    // back out to the projected per-game value.
    expect(out.row.total_pts).toBeCloseTo(24.4 * 68);
    expect(out.row.games_played).toBe(68);
  });

  it('falls back to last season when the engine has no projection', () => {
    const out = resolve(emptyRow(), undefined, {
      player_id: 'p1',
      games_played: 70,
      avg_pts: 17.3,
      avg_reb: 4.0,
      ft_pct: 0.845,
    });

    expect(out.basis).toBe('prev');
    expect(out.hasStats).toBe(true);
    expect(out.label).toBe(LABEL);
    expect(out.row.avg_pts).toBe(17.3);
    // The exact stored rate is carried, not re-derived from rounded averages —
    // that's what keeps a low-volume line off 100.0% FT.
    expect((out.row as unknown as Record<string, unknown>).ft_pct).toBe(0.845);
  });

  it('prefers the projection over last season when both exist', () => {
    const out = resolve(emptyRow(), projection(), {
      player_id: 'p1',
      games_played: 70,
      avg_pts: 17.3,
    });

    expect(out.basis).toBe('projected');
    expect(out.row.avg_pts).toBe(24.4);
  });

  it('reports no stats rather than substituting a zero', () => {
    const out = resolve(emptyRow());

    expect(out.basis).toBe('season');
    expect(out.hasStats).toBe(false);
    expect(out.label).toBeNull();
  });

  it('keeps a thin current sample when there is nothing to fall back to', () => {
    // A mid-season call-up: below the projection threshold, but 3 real games
    // still beat an em-dash.
    const player = emptyRow({ games_played: 3, avg_pts: 8.1 } as Partial<PlayerSeasonStats>);
    const out = resolve(player);

    expect(out.basis).toBe('season');
    expect(out.hasStats).toBe(true);
    expect(out.row.avg_pts).toBe(8.1);
  });

  it('ignores a historical row with no games played', () => {
    const out = resolve(emptyRow(), undefined, { player_id: 'p1', games_played: 0 });

    expect(out.hasStats).toBe(false);
    expect(out.basis).toBe('season');
  });

  it('merges NFL historical rows through the NFL shape', () => {
    const out = resolve(
      emptyRow(),
      undefined,
      { player_id: 'p1', games_played: 17, total_rec_yd: 1190, total_rec_td: 8 },
      'nfl',
    );

    expect(out.basis).toBe('prev');
    const row = out.row as unknown as Record<string, number>;
    expect(row.total_rec_yd).toBe(1190);
    expect(row.avg_rec_yd).toBeCloseTo(70.0);
  });
});

describe('displayGamesPlayed', () => {
  it('hides the projected games count', () => {
    // projected_games is engine-internal — projections speak per-game only, so
    // the GP cell must not surface an availability estimate.
    expect(displayGamesPlayed(resolve(emptyRow(), projection()))).toBeNull();
  });

  it('shows real games for current and previous seasons', () => {
    const current = resolve(emptyRow({ games_played: 40 } as Partial<PlayerSeasonStats>));
    expect(displayGamesPlayed(current)).toBe(40);

    const prev = resolve(emptyRow(), undefined, {
      player_id: 'p1',
      games_played: 70,
      avg_pts: 17.3,
    });
    expect(displayGamesPlayed(prev)).toBe(70);
  });

  it('is null when there is nothing to show', () => {
    expect(displayGamesPlayed(resolve(emptyRow()))).toBeNull();
  });
});

describe('spokenStatBasis', () => {
  it('qualifies a borrowed number and leaves a real one alone', () => {
    expect(spokenStatBasis('projected')).toBe('projected ');
    expect(spokenStatBasis('prev')).toBe('last season ');
    expect(spokenStatBasis('season')).toBe('');
  });
});
