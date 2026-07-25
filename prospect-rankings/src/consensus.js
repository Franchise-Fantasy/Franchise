// Blend per-source ranks into our own consensus board, grouped by draft year.
//
// A player's consensus score is the weighted average of their ranks across the
// sources that cover their draft year (fantasy-first sources carry more weight
// — see SOURCES). Players missing from a source are charged that source's list
// length + 10, so being unranked on one board costs more than being ranked low
// — this keeps one site's omission from catapulting a player.
// The blended score is internal; the app shows display_rank (1..N per year).
export function buildConsensus(scrapes) {
  const byYear = new Map();
  for (const scrape of scrapes) {
    if (!scrape.draftYear) continue;
    if (!byYear.has(scrape.draftYear)) byYear.set(scrape.draftYear, []);
    byYear.get(scrape.draftYear).push(scrape);
  }

  const boards = [];
  for (const [draftYear, yearScrapes] of byYear) {
    const players = new Map();
    for (const scrape of yearScrapes) {
      for (const p of scrape.players) {
        if (!players.has(p.slug)) {
          players.set(p.slug, { ...p, sourceRanks: {} });
        }
        const entry = players.get(p.slug);
        entry.sourceRanks[scrape.source] = p.rank;
        // Prefer richer metadata when a source has it
        entry.position ??= p.position;
        entry.school ??= p.school;
        entry.height ??= p.height;
        entry.weight ??= p.weight;
        entry.team ??= p.team;
      }
    }

    const scored = [...players.values()].map((p) => {
      let weightedSum = 0;
      let totalWeight = 0;
      for (const s of yearScrapes) {
        const w = s.weight ?? 1;
        weightedSum += (p.sourceRanks[s.source] ?? s.players.length + 10) * w;
        totalWeight += w;
      }
      return {
        ...p,
        consensusScore: weightedSum / totalWeight,
        bestRank: Math.min(...Object.values(p.sourceRanks)),
      };
    });

    scored.sort(
      (a, b) => a.consensusScore - b.consensusScore || a.bestRank - b.bestRank
    );
    scored.forEach((p, i) => (p.displayRank = i + 1));

    boards.push({ draftYear, players: scored });
  }

  return boards.sort((a, b) => a.draftYear - b.draftYear);
}
