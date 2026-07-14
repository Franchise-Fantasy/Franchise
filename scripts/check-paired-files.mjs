#!/usr/bin/env node
// Static scan: registered "byte-identical paired files" must remain identical
// below their top-of-file doc-comment header. These are files where both a
// client runtime and an edge runtime need the exact same logic with the exact
// same call surface, and neither side can ergonomically import the other's
// flavor (see CLAUDE.md → "byte-identical paired files"). The leading
// `/** ... */` header legitimately differs per file (it names the OTHER copy),
// so it is stripped before comparison; everything after it must match exactly.
//
// This guards the "Correctness & Invariants" facet: silent drift between these
// copies becomes a correctness bug (e.g. finalize-week scoring a player the
// client showed as DROPPED).
//
// NOTE: this scanner is ONLY for pattern (a) — byte-identical pairs. The
// pattern (b) "shared core + thin wrappers" files (illegalIRShared.ts,
// rosterSlotsShared.ts, etc.) are NOT byte-identical and must NOT be added
// here — they're protected by being a single imported source of truth.
//
// To register a new pair, add a [clientPath, edgePath] entry to PAIRS below.
//
// Exits 1 if any registered pair has drifted so CI can gate on it.
//
// Usage: `node scripts/check-paired-files.mjs`

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Each entry is a pair of repo-relative paths that must stay identical below
// their doc-comment header.
const PAIRS = [
  ['utils/roster/resolveSlot.ts', 'supabase/functions/_shared/resolveSlot.ts'],
];

// Strip a single leading `/** ... */` block comment (plus any blank lines
// immediately after it) and normalize CRLF→LF so comparison is platform-stable.
function normalizeBody(src) {
  const lf = src.replace(/\r\n/g, '\n');
  const match = lf.match(/^\s*\/\*\*[\s\S]*?\*\/\n*/);
  return match ? lf.slice(match[0].length) : lf;
}

// First line index where the two bodies differ (1-based), or -1 if identical.
function firstDiffLine(a, b) {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const max = Math.max(aLines.length, bLines.length);
  for (let i = 0; i < max; i++) {
    if (aLines[i] !== bLines[i]) return i + 1;
  }
  return -1;
}

function main() {
  const drifted = [];

  for (const [clientRel, edgeRel] of PAIRS) {
    const clientAbs = path.join(ROOT, clientRel);
    const edgeAbs = path.join(ROOT, edgeRel);

    let clientBody;
    let edgeBody;
    try {
      clientBody = normalizeBody(readFileSync(clientAbs, 'utf8'));
      edgeBody = normalizeBody(readFileSync(edgeAbs, 'utf8'));
    } catch (err) {
      drifted.push({ clientRel, edgeRel, reason: `could not read pair: ${err.message}` });
      continue;
    }

    if (clientBody !== edgeBody) {
      const line = firstDiffLine(clientBody, edgeBody);
      drifted.push({
        clientRel,
        edgeRel,
        reason: `bodies diverge starting at line ${line} (counting below the doc-comment header)`,
      });
    }
  }

  if (drifted.length === 0) {
    console.log(`✓ All ${PAIRS.length} paired file(s) in sync`);
    process.exit(0);
  }

  console.error(`✗ Found ${drifted.length} drifted paired file(s):\n`);
  for (const d of drifted) {
    console.error(`  ${d.clientRel}`);
    console.error(`  ${d.edgeRel}`);
    console.error(`    ${d.reason}\n`);
  }
  console.error(
    'These files must remain byte-for-byte identical below their doc-comment\n' +
      'header. Apply the same change to both copies in the same commit. See\n' +
      'CLAUDE.md → "byte-identical paired files" for context.',
  );
  process.exit(1);
}

main();