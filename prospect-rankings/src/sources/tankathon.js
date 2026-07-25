import * as cheerio from "cheerio";
import { fetchPage } from "../lib/http.js";
import { cleanName, slugify } from "../lib/names.js";

// Tankathon big board (https://www.tankathon.com/big-board). The page covers
// whichever draft cycle they're currently tracking; the draft year comes from
// the page <title> ("2027 NBA Draft Big Board"), falling back to the config year.
export const tankathonBigBoard = {
  id: "tankathon",
  label: "Tankathon Big Board",
  async scrape({ year } = {}) {
    const url = "https://www.tankathon.com/big-board";
    const html = await fetchPage(url);
    const $ = cheerio.load(html);

    const titleYear = Number(($("title").text().match(/(20\d{2})/) || [])[1]) || null;

    const players = [];
    $("#big-board .mock-row").each((_, row) => {
      const $row = $(row);
      const rank = Number($row.find(".mock-row-pick-number").text().trim());
      const name = cleanName($row.find(".mock-row-name").text());
      if (!rank || !name) return;
      const [position, school] = $row
        .find(".mock-row-school-position")
        .text()
        .split("|")
        .map((s) => s.trim());
      const [height, weight] = $row
        .find(".section.height-weight div")
        .map((_, d) => $(d).text().trim())
        .get();
      players.push({
        rank,
        name,
        slug: slugify(name),
        position: $row.attr("data-pos") || position || null,
        school: school || null,
        height: height || null,
        weight: (weight || "").replace(/\s*lbs?\s*$/i, "") || null,
      });
    });

    return { source: "tankathon", url, draftYear: titleYear ?? year ?? null, players };
  },
};
