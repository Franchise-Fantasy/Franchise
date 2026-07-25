# Franchise Fantasy — Prospect Rankings Pipeline

Weekly job that scrapes public NBA draft big boards, blends them into a
consensus rank per draft year, stores rankings in Supabase, and auto-creates
draft (unpublished) Contentful entries for newly ranked players.

**Division of labor:** Contentful owns the editorial content (name, photo, bio,
highlight video) — Supabase owns the rank. The app joins them on `player_slug`
/ `slug` and sorts by Supabase's `display_rank`, so rankings update weekly with
no Contentful publishes and no app deploys.

## How it works

1. `src/run.js` scrapes each source in `src/sources/index.js` (~4s apart,
   honest bot user-agent): NBADraft.net and Tankathon big boards (real-NBA
   scouting view, and the only coverage for future classes) plus RotoBaller's
   dynasty rookie rankings (fantasy view — landing spot, minutes, summer
   league — for the most recently drafted class; the monthly article URL is
   auto-discovered via their site search).
2. `src/consensus.js` groups players by draft year and blends per-source ranks
   into one consensus order, weighted per source — RotoBaller carries 2x
   because fantasy value is what a dynasty app cares about post-draft. Only
   our blended rank is ever shown publicly.
3. `src/sync-supabase.js` upserts the board into `prospect_rankings` and
   snapshots it into `rank_history` (which powers the ▲/▼ movement arrows).
4. `src/sync-contentful.js` creates an unpublished draft entry for any ranked
   player Contentful doesn't know yet — editors just add bio/photo/video and
   publish. Existing entries are never touched.
5. `src/stats.js` pulls each ranked player's last 3 game lines from ESPN's
   public JSON APIs into `recent_games`: college gamelogs (November–March),
   Las Vegas Summer League box scores (July), NBA gamelogs (once the season
   starts). ESPN athlete ids are auto-resolved by name-matching school/team
   rosters and cached in `player_ids`. Players without ESPN coverage
   (international, high school) simply get no rows.

Safety rails: a source returning < 20 rows is skipped (site redesigns can't
wipe good data); if every source fails, nothing is written and the GitHub
Action fails loudly (GitHub emails you).

## One-time setup

1. **Supabase** — paste `sql/schema.sql` into the SQL editor and run it.
2. **Contentful** — make sure your prospect content type has a short-text
   `slug` field (unique). Optional but recommended: `position` (short text),
   `school` (short text), `draftYear` (integer) — the job fills any of these
   that exist. Set `CONTENTFUL_PROSPECT_TYPE` if your type ID isn't `prospect`.
3. **GitHub** — push this folder to a private repo, then add the five secrets
   from `.env.example` under Settings → Secrets and variables → Actions.
   The job runs Mondays 12:00 UTC; trigger it manually anytime from the
   Actions tab (“Run workflow”).

Local test (no credentials needed):

```bash
npm install
npm run dry-run
```

## Reading the board in the app

Query the `prospect_board` view (anon key works — read-only):

```js
const { data: board } = await supabase
  .from("prospect_board")
  .select("player_slug, draft_year, display_rank, rank_change")
  .order("display_rank");
```

Then join to your Contentful entries on `slug` and render per draft-year tab:

```js
const bySlug = new Map(board.map((r) => [r.player_slug, r]));
const ranked = contentfulProspects
  .map((p) => ({ ...p, board: bySlug.get(p.fields.slug) }))
  .filter((p) => p.board && p.board.draft_year === selectedYear)
  .sort((a, b) => a.board.display_rank - b.board.display_rank);
```

Movement arrows: `rank_change > 0` → green ▲ (e.g. “▲ 3 this week”),
`< 0` → red ▼, `0` → steady, `null` → NEW badge.

## Adding a source

Create `src/sources/<name>.js` exporting `{ id, label, scrape(options) }` that
returns `{ source, url, draftYear, players: [{ rank, name, slug, position,
school }] }` (use `slugify` from `src/lib/names.js`), and register it in
`src/sources/index.js`. Good candidates for outer draft years (2029+): ESPN
SC Next / 247Sports high-school class rankings, mapped class-of-N → draft N+1.

## Name matching

Slugs are normalized (lowercase, accents and punctuation stripped), so
“A.J. Dybantsa” and “AJ Dybantsa” both become `aj-dybantsa`. If a scraped slug
still doesn't match the Contentful entry's slug, fix it by setting the
Contentful `slug` field to the scraped value (shown in the job log / Supabase).
