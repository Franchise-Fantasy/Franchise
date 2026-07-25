import { SOURCES, MIN_ROWS } from "./sources/index.js";
import { buildConsensus } from "./consensus.js";
import { syncSupabase } from "./sync-supabase.js";
import { syncContentful } from "./sync-contentful.js";
import { syncStats } from "./stats.js";

const dryRun = process.argv.includes("--dry-run");

const scrapes = [];
const failures = [];

for (const { scraper, options, weight, minRows } of SOURCES) {
  const floor = minRows ?? MIN_ROWS;
  try {
    console.log(`Scraping ${scraper.label}...`);
    const result = { ...(await scraper.scrape(options)), weight: weight ?? 1 };
    if (result.players.length === 0) {
      // Not-yet-published boards (future SC Next classes) aren't failures.
      console.log("  empty board — skipped");
      continue;
    }
    if (result.players.length < floor) {
      // Short boards are treated as broken so they can't wipe good data.
      failures.push(`${scraper.id}: only ${result.players.length} rows (${result.url})`);
      console.warn(`  SKIPPED — ${result.players.length} rows is below the ${floor}-row safety floor`);
      continue;
    }
    console.log(`  ${result.players.length} players, draft year ${result.draftYear}`);
    scrapes.push(result);
  } catch (err) {
    failures.push(`${scraper.id}: ${err.message}`);
    console.warn(`  FAILED — ${err.message}`);
  }
}

if (scrapes.length === 0) {
  console.error("All sources failed — leaving existing data untouched.\n" + failures.join("\n"));
  process.exit(1);
}

const boards = buildConsensus(scrapes);

for (const board of boards) {
  console.log(`\n=== ${board.draftYear} draft — top 10 of ${board.players.length} ===`);
  for (const p of board.players.slice(0, 10)) {
    const srcs = Object.entries(p.sourceRanks).map(([s, r]) => `${s}#${r}`).join(", ");
    console.log(`  ${String(p.displayRank).padStart(3)}. ${p.name} (${p.position ?? "?"}, ${p.school ?? "?"}) [${srcs}]`);
  }
}

if (dryRun) {
  console.log("\nDry run — nothing written.");
  process.exit(0);
}

console.log("\nSyncing...");
await syncSupabase(boards);
await syncContentful(boards);

try {
  await syncStats(boards);
} catch (err) {
  // Rankings are already saved at this point; a stats hiccup shouldn't hide
  // them, but it should still fail the run so GitHub emails about it.
  failures.push(`stats: ${err.message}`);
  console.warn(`  Stats step FAILED — ${err.message}`);
}

if (failures.length > 0) {
  // Partial success: data written, but flag the broken source so the
  // GitHub Action run shows as failed and sends an email.
  console.error("\nCompleted with source failures:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\nDone.");
