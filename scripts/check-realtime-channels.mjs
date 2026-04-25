#!/usr/bin/env node
// Static scan: every `.channel(...)` used with `postgres_changes` must include
// a `-${Date.now()}` suffix. Deterministic names collide when React reconnects
// passive effects (tab switch, auth transition, concurrent re-render); Supabase
// throws during the overlap and Hermes crashes natively. Presence and broadcast
// channels are exempt — they need shared names.
//
// Exits 1 if any violations are found so CI can gate on it.
//
// Usage: `node scripts/check-realtime-channels.mjs`

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['app', 'hooks', 'components', 'context'];
const FILE_EXTS = new Set(['.ts', '.tsx']);
const SKIP_DIRS = new Set(['node_modules', '__tests__', '.expo', '.next']);

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
    const abs = path.join(ROOT, d);
    try {
      all.push(...walk(abs));
    } catch {
      // dir might not exist; skip
    }
  }
  return all;
}

/**
 * Scan a file for `.channel(` calls. For each, capture the surrounding block
 * (up to the next blank line or `.subscribe()`) and check:
 *   - If the block contains `.on('postgres_changes'` → this is a postgres-changes channel
 *   - If so, the channel name argument must contain `Date.now()` OR be passed a
 *     template literal with `${Date.now()}`
 */
function scanFile(filepath) {
  const src = readFileSync(filepath, 'utf8');
  const lines = src.split('\n');
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('.channel(')) continue;

    // Look forward up to 40 lines (or until `.subscribe()`) to find listener type.
    let block = line;
    const end = Math.min(i + 40, lines.length);
    for (let j = i + 1; j < end; j++) {
      block += '\n' + lines[j];
      if (lines[j].includes('.subscribe(')) break;
    }

    if (!block.includes("'postgres_changes'") && !block.includes('"postgres_changes"')) {
      continue; // presence / broadcast / server-broadcast — exempt
    }

    // This line defines a postgres_changes channel. Its name argument must
    // include a uniqueness source. We check the `.channel(...)` invocation
    // itself — captured by grabbing the line plus subsequent lines until the
    // matching close paren, at single-line depth.
    const invocation = line.slice(line.indexOf('.channel('));
    const hasUnique =
      invocation.includes('Date.now()') ||
      invocation.includes('crypto.randomUUID') ||
      invocation.includes('performance.now()');
    if (hasUnique) continue;

    violations.push({
      file: path.relative(ROOT, filepath),
      line: i + 1,
      snippet: line.trim(),
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
    console.log('✓ No realtime channel violations');
    process.exit(0);
  }

  console.error(
    `✗ Found ${allViolations.length} postgres_changes channel(s) without a -${"$"}{Date.now()} suffix:\n`,
  );
  for (const v of allViolations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.snippet}`);
    console.error();
  }
  console.error(
    'Every postgres_changes channel created in a useEffect must include a unique\n' +
      'suffix (e.g. -${Date.now()}). Deterministic names cause Supabase to throw\n' +
      'during remount overlap and Hermes crashes natively. See CLAUDE.md for context.',
  );
  process.exit(1);
}

main();
