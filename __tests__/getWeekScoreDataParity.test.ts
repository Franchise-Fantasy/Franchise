import { readFileSync } from 'fs';
import { join } from 'path';

import { NFL_GAME_COLUMNS } from '@/utils/scoring/nflStatLine';
import { getSportModule } from '@/utils/sports/registry';

/**
 * Drift gate for the SQL↔TS pair between the get_week_score_data RPC and the
 * TS NFL column registry (same class of guard as the position_limit_match_keys
 * parity test). The RPC hand-lists the NFL columns it bundles for the
 * get-week-scores edge function; if a new NFL stat column starts being scored
 * (added to NFL_STAT_TO_GAME / NFL_GAME_COLUMNS) without also being added to
 * the RPC, NFL week scores silently under-count. This test reads the migration
 * that owns the CURRENT function definition — if you replace the function in a
 * newer migration, point MIGRATION_FILE at it.
 */
const MIGRATION_FILE = join(
  __dirname,
  '../supabase/migrations/20260711000000_get_week_score_data_nfl.sql',
);

// Columns the pipeline never ingests (no BDL stat at the ALL-STAR tier) —
// scored-weight entries exist for a future upgrade but the RPC rightly
// omits them.
const NEVER_INGESTED = new Set(['two_pt', 'dst_safety']);

describe('get_week_score_data RPC ↔ TS NFL column parity', () => {
  const sql = readFileSync(MIGRATION_FILE, 'utf8');

  it('bundles a top-level sport field', () => {
    expect(sql).toContain("'sport', v_sport");
  });

  it.each(NFL_GAME_COLUMNS)("games section carries pg.%s", (col) => {
    expect(sql).toContain(`'${col}', pg.${col}`);
  });

  it.each(NFL_GAME_COLUMNS)("live section carries ls.%s", (col) => {
    expect(sql).toContain(`'${col}', ls.${col}`);
  });

  it('every scored registry column reaches the RPC (except never-ingested)', () => {
    const scored = Object.values(getSportModule('nfl').statToGame).filter(
      (col) => !NEVER_INGESTED.has(col),
    );
    for (const col of scored) {
      expect(sql).toContain(`'${col}', pg.${col}`);
      expect(sql).toContain(`'${col}', ls.${col}`);
    }
  });
});
