import * as cheerio from "cheerio";
import { fetchPage } from "../lib/http.js";
import { cleanName, slugify } from "../lib/names.js";

// NBADraft.net Top 100 big board. The page has a year selector
// (?year-ranking=YYYY); with no param it serves their current board and marks
// the year as the <option selected> value. Future-year boards can exist but be
// empty, so callers should rely on the row-count guard in run.js.
export const nbadraftBigBoard = {
  id: "nbadraft",
  label: "NBADraft.net Big Board",
  async scrape({ year } = {}) {
    const url = year
      ? `https://www.nbadraft.net/ranking/bigboard/?year-ranking=${year}`
      : "https://www.nbadraft.net/ranking/bigboard/";
    const html = await fetchPage(url);
    const $ = cheerio.load(html);

    const detectedYear = Number($("select.filter-year option[selected]").attr("value")) || year || null;

    const players = [];
    $("table.big-board-table tbody tr").each((_, tr) => {
      const $tr = $(tr);
      const rank = Number($tr.find("td.rank").text().trim());
      // Name is split across spans (<span>AJ</span><span>Dybantsa</span>);
      // join with spaces so the slug matches other sources.
      const nameParts = $tr
        .find("td.name a span")
        .map((_, s) => $(s).text().trim())
        .get();
      const name = cleanName(nameParts.length ? nameParts.join(" ") : $tr.find("td.name a").text());
      if (!rank || !name) return;
      players.push({
        rank,
        name,
        slug: slugify(name),
        position: $tr.find("td.teamposition").text().trim() || null,
        school: $tr.find("td.team").text().trim() || null,
        height: $tr.find("td.height").text().trim() || null,
        weight: $tr.find("td.weight").text().trim() || null,
      });
    });

    return { source: "nbadraft", url, draftYear: year ?? detectedYear, players };
  },
};
