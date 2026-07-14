#!/usr/bin/env node
// Static scan: queries against the sport-shared player-pool tables must be
// sport-scoped. NBA, WNBA, and NFL rows coexist in these tables; a pool-level
// read without `.eq('sport', ...)` silently mixes sports (wrong free agents,
// polluted rankings), and an insert without an explicit `sport` value lands as
// 'nba' via the column DEFAULT. Queries scoped to a specific player/game id
// are exempt — ids are UUIDs owned by exactly one sport, so they can't mix.
//
// To mark an intentional cross-sport query, put `// sport-scope: <reason>` on
// the line above (or on) the `.from(...)` call.
//
// Exits 1 if any violations are found so CI can gate on it.
//
// Usage: `node scripts/check-sport-scope.mjs`

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['app', 'components', 'hooks', 'utils', 'lib', 'context', 'supabase/functions'];
const FILE_EXTS = new Set(['.ts', '.tsx']);
const SKIP_DIRS = new Set(['node_modules', '__tests__', '.expo', '.next']);

// Tables carrying a `sport` discriminator that pool-level queries must scope.
const SPORT_TABLES = [
  'players',
  'player_games',
  'live_player_stats',
  'player_historical_stats',
  'player_season_stats',
  'game_schedule',
  'player_news',
];

// Chain markers that prove the query can't mix sports.
const SPORT_SCOPED = [".eq('sport'", '.eq("sport"', ".in('sport'", '.in("sport"'];
const ID_SCOPED = [
  ".eq('id'", '.eq("id"',
  ".in('id'", '.in("id"',
  ".eq('player_id'", '.eq("player_id"',
  ".in('player_id'", '.in("player_id"',
  ".eq('game_id'", '.eq("game_id"',
  ".in('game_id'", '.in("game_id"',
  ".eq('external_id_nba'", ".eq('external_id_bdl'",
];
const ALLOW_MARKER = 'sport-scope:';

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else if (FILE_EXTS.has(path.extname(entry))) {
      out.push(full);
    }
  }
  return out;
}

function findSourceFiles() {
  const all = [];
  for (const d of SCAN_DIRS) {
    const abs = path.join(ROOT, ...d.split('/'));
    try {
      all.push(...walk(abs));
    } catch {
      // dir might not exist; skip
    }
  }
  return all;
}

/** Capture the query chain: the `.from(...)` line plus following lines until a
 *  statement boundary (line ending in `;`), a blank line, or a 30-line cap. */
function captureChain(lines, start) {
  let block = lines[start];
  const end = Math.min(start + 30, lines.length);
  for (let j = start + 1; j < end; j++) {
    if (lines[start].trimEnd().endsWith(';')) break;
    block += '\n' + lines[j];
    const trimmed = lines[j].trim();
    if (trimmed === '' || trimmed.endsWith(';')) break;
  }
  return block;
}

function scanFile(filepath) {
  const src = readFileSync(filepath, 'utf8');
  const lines = src.split('\n');
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const table = SPORT_TABLES.find(
      (t) => line.includes(`.from('${t}')`) || line.includes(`.from("${t}")`),
    );
    if (!table) continue;

    // Allowlist marker on the line, or up to 3 lines above.
    const context = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
    if (context.includes(ALLOW_MARKER)) continue;

    const block = captureChain(lines, i);
    if (block.includes(ALLOW_MARKER)) continue;

    if (SPORT_SCOPED.some((m) => block.includes(m))) continue;
    if (ID_SCOPED.some((m) => block.includes(m))) continue;

    // Writes: an insert/upsert payload that mentions `sport` anywhere in the
    // chain is treated as scoped (static analysis can't inspect the payload
    // object; requiring the word is the pragmatic gate against DEFAULT-'nba'
    // rows). Updates/deletes without an id/sport filter are flagged like reads.
    if ((block.includes('.insert(') || block.includes('.upsert(')) && /\bsport\b/.test(block)) {
      continue;
    }

    violations.push({
      file: path.relative(ROOT, filepath),
      line: i + 1,
      table,
      snippet: line.trim().slice(0, 120),
    });
  }

  return violations;
}

function main() {
  const files = findSourceFiles();
  const allViolations = [];
  for (const f of files) {
    allViolations.push(...scanFile(f));
  }

  if (allViolations.length === 0) {
    console.log('✓ No sport-scope violations');
    process.exit(0);
  }

  console.error(
    `✗ Found ${allViolations.length} unscoped quer${allViolations.length === 1 ? 'y' : 'ies'} against sport-shared tables:\n`,
  );
  for (const v of allViolations) {
    console.error(`  ${v.file}:${v.line}  (${v.table})`);
    console.error(`    ${v.snippet}`);
    console.error();
  }
  console.error(
    'Queries on sport-shared tables (players, player_games, live_player_stats,\n' +
      "player_historical_stats, player_season_stats, game_schedule, player_news)\n" +
      "must be sport-filtered (`.eq('sport', ...)`) or scoped to specific ids.\n" +
      'Inserts/upserts must set `sport` explicitly (the column DEFAULT is nba).\n' +
      'For an intentional cross-sport query, add `// sport-scope: <reason>` on\n' +
      'the line above. See CLAUDE.md for context.',
  );
  process.exit(1);
}

main();
