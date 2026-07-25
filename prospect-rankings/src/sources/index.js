import { nbadraftBigBoard } from "./nbadraft.js";
import { tankathonBigBoard } from "./tankathon.js";
import { rotoballerDynastyRookies } from "./rotoballer.js";
import { espnRecruiting } from "./espn-recruiting.js";

// The next draft cycle (June draft → rolls over in July).
const now = new Date();
const nextDraft = now.getUTCMonth() + 1 >= 7 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();

// Each entry: which scraper to run, options, and a consensus weight.
// A source whose board covers a draft that has already happened is still stored
// under that year, so it can never pollute a future year's board.
//
// RotoBaller carries double weight because it ranks *fantasy* value (landing
// spot, minutes, summer league) — for a dynasty app that matters more than the
// scouting boards' real-NBA view once a class has been drafted.
//
// To add a source (e.g. ESPN SC Next for outer years), export a scraper with the
// same shape from src/sources/<name>.js and list it here.
export const SOURCES = [
  { scraper: nbadraftBigBoard, options: {}, weight: 1 }, // auto-detects its year
  { scraper: tankathonBigBoard, options: {}, weight: 1 }, // year read from page title
  { scraper: rotoballerDynastyRookies, options: {}, weight: 2 }, // fantasy-first
  // Outer draft years via HS class rankings (class of N → draft N+1). Three
  // classes out; a not-yet-published class returns 0 rows and is skipped, and
  // each July the window slides forward automatically.
  { scraper: espnRecruiting(nextDraft), options: {}, weight: 1, minRows: 15 },
  { scraper: espnRecruiting(nextDraft + 1), options: {}, weight: 1, minRows: 15 },
  { scraper: espnRecruiting(nextDraft + 2), options: {}, weight: 1, minRows: 15 },
];

// A scrape returning fewer rows than this is treated as broken (site redesign,
// empty future-year board) and skipped so it can't wipe good data. Sources may
// override with a `minRows` of their own (short SC Next lists are legitimate).
export const MIN_ROWS = 20;
