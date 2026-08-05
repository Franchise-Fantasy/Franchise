import * as cheerio from "cheerio";
import { fetchPage } from "../lib/http.js";
import { cleanName, slugify } from "../lib/names.js";

// ESPN SC Next high-school class rankings — the only structured coverage for
// draft years beyond the college boards. Class of N maps to the N+1 draft
// (one college season in between). Lists get shorter the further out the
// class (100 / 60 / 25), and a class that ESPN hasn't published yet simply
// returns 0 rows and gets skipped by the row-count guard.
export function espnRecruiting(classYear) {
  return {
    id: `espn-scnext-${classYear}`,
    label: `ESPN SC Next class of ${classYear}`,
    async scrape() {
      const url = `https://www.espn.com/college-sports/basketball/recruiting/playerrankings/_/class/${classYear}`;
      const html = await fetchPage(url);
      const $ = cheerio.load(html);

      const players = [];
      $("tr.oddrow, tr.evenrow").each((_, tr) => {
        const tds = $(tr).find("td");
        const rank = Number($(tds[0]).text().trim());
        const name = cleanName($(tds[1]).find(".name strong").text());
        if (!rank || !name) return;
        // td[3] is "Hometown, ST<br>High School" — both halves are useful.
        const parts = ($(tds[3]).html() || "").split(/<br\s*\/?>/i);
        const hometown = cleanName($("<div>").html(parts[0] ?? "").text()) || null;
        const school = cleanName($("<div>").html(parts[1] ?? "").text()) || null;
        const height = $(tds[4]).text().trim().replace(/(\d)'(\d+).*/, "$1-$2") || null;
        players.push({
          rank,
          name,
          slug: slugify(name),
          position: $(tds[2]).text().trim() || null,
          school,
          hometown,
          height,
          weight: $(tds[5]).text().trim() || null,
        });
      });

      return { source: `espn-scnext-${classYear}`, url, draftYear: classYear + 1, players };
    },
  };
}
