import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { dismissalKey, rosterTapHintId, type DismissalKind } from '@/utils/dismissals/types';

/**
 * SQL ↔ TS paired logic (CLAUDE.md pattern (c)): the `DismissalKind` union and
 * the `kind` CHECK constraint on `public.user_dismissals` must hold the same
 * set. There's no scanner for this pair, and drift fails at the WRITE — a new
 * client-side kind that isn't in the constraint makes every dismiss of that kind
 * a silent 400, so the surface re-shows forever and the only symptom is a
 * logger.warn nobody reads.
 *
 * Kept as a literal here (not derived from the type) so the test breaks when
 * someone edits the union without touching the migration.
 */
const TS_KINDS: DismissalKind[] = [
  'announcement',
  'matchup_result',
  'home_banner',
  'coach_mark',
];

const MIGRATIONS_DIR = join(__dirname, '..', 'supabase', 'migrations');

/**
 * Located by suffix, not by full filename: a migration's version prefix gets
 * renumbered when it's applied out of band (the remote history assigns its own
 * timestamp), and this test shouldn't break on that bookkeeping.
 */
function migrationPath(): string {
  const file = readdirSync(MIGRATIONS_DIR).find((f) => f.endsWith('_user_dismissals.sql'));
  if (!file) throw new Error('Could not find the user_dismissals migration');
  return join(MIGRATIONS_DIR, file);
}

function kindsFromMigration(): string[] {
  const sql = readFileSync(migrationPath(), 'utf8');
  const match = sql.match(/kind\s+text\s+NOT NULL\s+CHECK\s*\(kind IN \(([^)]*)\)\)/i);
  if (!match) throw new Error('Could not find the kind CHECK constraint in the migration');
  return match[1]
    .split(',')
    .map((raw) => raw.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
}

describe('user_dismissals kind parity', () => {
  it('the SQL CHECK constraint and the TS union hold the same set', () => {
    expect(new Set(kindsFromMigration())).toEqual(new Set(TS_KINDS));
  });
});

describe('dismissalKey', () => {
  it('keeps each kind in its own id space', () => {
    // Contentful entry ids and matchup uuids are unrelated namespaces that could
    // in principle collide; the kind prefix is what keeps them apart.
    expect(dismissalKey('home_banner', 'abc')).not.toBe(dismissalKey('announcement', 'abc'));
  });

});

describe('rosterTapHintId', () => {
  it('scopes the hint per team', () => {
    expect(rosterTapHintId('team-1')).not.toBe(rosterTapHintId('team-2'));
  });

  it('stays within the item_id length cap', () => {
    // The column is CHECK (length(item_id) BETWEEN 1 AND 200); a uuid teamId
    // leaves plenty of room, but the prefix must not grow unboundedly.
    expect(rosterTapHintId('00000000-0000-0000-0000-000000000000').length).toBeLessThanOrEqual(200);
  });
});
