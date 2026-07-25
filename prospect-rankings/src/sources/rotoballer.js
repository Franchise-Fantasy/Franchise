import * as cheerio from "cheerio";
import { fetchPage } from "../lib/http.js";
import { cleanName, slugify } from "../lib/names.js";

// RotoBaller dynasty rookie rankings — the fantasy-first source for the most
// recently drafted class (landing spot, summer league, dynasty value), unlike
// the scouting boards which rank real-NBA value. Their article URL changes
// monthly, so we discover the newest one via their site search first.
const SEARCH_URL =
  "https://www.rotoballer.com/?s=fantasy+basketball+dynasty+rookie+rankings";

// The class drafted in the most recent June draft.
function mostRecentDraftYear(now = new Date()) {
  return now.getUTCMonth() + 1 >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

export const rotoballerDynastyRookies = {
  id: "rotoballer",
  label: "RotoBaller Dynasty Rookie Rankings",
  async scrape() {
    const searchHtml = await fetchPage(SEARCH_URL);
    const match = searchHtml.match(
      /href="(https:\/\/www\.rotoballer\.com\/fantasy-basketball-dynasty-rookie-rankings[^"]*)"/
    );
    if (!match) throw new Error("could not discover latest rankings article via search");
    const url = match[1];

    const $ = cheerio.load(await fetchPage(url));

    // Find the rankings table: header row contains "Rank" and "Player".
    let players = [];
    $("table").each((_, table) => {
      if (players.length) return;
      const header = $(table).find("tr").first().text();
      if (!/rank/i.test(header) || !/player/i.test(header)) return;
      const rows = [];
      $(table)
        .find("tr")
        .slice(1)
        .each((_, tr) => {
          const cells = $(tr)
            .find("td")
            .map((_, td) => $(td).text().trim())
            .get();
          const rank = Number(cells[0]);
          const name = cleanName(cells[1] || "");
          if (!rank || !name) return;
          rows.push({
            rank,
            name,
            slug: slugify(name),
            position: cells[2] || null,
            team: cells[3] || null, // actual current NBA team (post draft-night trades)
          });
        });
      players = rows;
    });

    return { source: "rotoballer", url, draftYear: mostRecentDraftYear(), players };
  },
};
