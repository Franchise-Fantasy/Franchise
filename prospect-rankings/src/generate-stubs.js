// Build factual profile blurbs for prospects we have no verified game data on.
// These state only what we can source (ranking class, measurables, school,
// draft-eligibility timeline) and explicitly make no scouting claims — most of
// these players are high schoolers, and inventing skill assessments about
// minors is not something we publish.
import { readFileSync, writeFileSync } from "node:fs";

const data = JSON.parse(new TextDecoder().decode(readFileSync(new URL("../seed/bio-data.json", import.meta.url))));
const existing = JSON.parse(new TextDecoder().decode(readFileSync(new URL("../seed/bios.json", import.meta.url))));
const batch2 = JSON.parse(new TextDecoder().decode(readFileSync(new URL("../seed/bios-batch2.json", import.meta.url))));

const POSITION_WORDS = {
  PG: "point guard",
  SG: "shooting guard",
  SF: "small forward",
  PF: "power forward",
  C: "center",
};

function positionPhrase(pos) {
  if (!pos) return "prospect";
  if (POSITION_WORDS[pos]) return POSITION_WORDS[pos];
  const parts = pos.split("/");
  if (parts.every((p) => ["PG", "SG"].includes(p))) return "combo guard";
  if (parts.every((p) => ["SF", "PF"].includes(p))) return "forward";
  if (parts.every((p) => ["PF", "C"].includes(p))) return "big";
  if (parts.every((p) => ["SG", "SF"].includes(p))) return "wing";
  return "prospect";
}

const sizePhrase = (p) => {
  if (p.height && p.weight) return `${p.height}, ${p.weight} pounds`;
  if (p.height) return p.height;
  return null;
};

// Class of N feeds the N+1 draft.
const stubs = {};
let hs = 0;
let older = 0;

for (const p of data) {
  if (existing[p.slug] || batch2[p.slug]) continue;
  const pos = positionPhrase(p.position);
  const size = sizePhrase(p);
  const where = p.school ? ` at ${p.school}` : p.team ? ` in ${p.team}'s organization` : "";
  const isHighSchool = p.draftYear >= 2028;

  let text;
  if (isHighSchool) {
    hs++;
    const classYear = p.draftYear - 1;
    text =
      `${p.name} is a ${pos}${where}` +
      (size ? `, listed at ${size}` : "") +
      `, ranked inside ESPN's national top prospects for the high school class of ${classYear}. ` +
      `That class projects to the ${p.draftYear} NBA draft, which is ${p.draftYear - 2026} cycles away. ` +
      `Boards this far out move constantly and there is no pro-level film to evaluate yet, so treat the ranking as a placeholder rather than a projection. ` +
      `We'll build this profile out as his career develops.`;
  } else {
    older++;
    text =
      `${p.name} is a ${pos}${where}` +
      (size ? `, listed at ${size}` : "") +
      `, currently ranked in the ${p.draftYear} draft class. ` +
      `We don't have verified game data on him yet, so this profile is limited to what we can source directly. ` +
      `It will fill out with scouting and statistics once he has tracked games on the board.`;
  }
  stubs[p.slug] = text;
}

writeFileSync(new URL("../seed/bios-stubs.json", import.meta.url), JSON.stringify(stubs, null, 1));
console.log(`${Object.keys(stubs).length} stubs written (${hs} high school, ${older} older classes)`);
