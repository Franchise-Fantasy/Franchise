# Programmer Handoff — Prospect Rankings Pipeline

## Changes to pull (since the version currently deployed)

Pull all of these — the first one is a correctness bug that is live right now.

1. **Split-player fix (important).** Sources disagree on generational suffixes:
   NBADraft.net prints "Darius Acuff", RotoBaller prints "Darius Acuff Jr."
   Those produced different slugs, so one player became two board entries, each
   penalized for being "missing" from the other source. Acuff should be #7 in
   the 2026 class; the live board has him at #35 and #57. Seven players are
   affected. `buildConsensus` now merges on a suffix-stripped key
   (`canonicalSlug` in `src/lib/names.js`) and keeps the fuller name for
   display. Verified locally: Acuff back to #7, board 112 -> 105.
2. **Field enrichment** (`src/lib/enrich.js`, wired into `sync-contentful.js`).
   Ranking sources publish wildly different fields — RotoBaller has no
   measurables at all — so new entries were arriving without height, weight,
   school or hometown. Gaps are now backstopped from ESPN roster data at
   creation time, and heights are normalized to `6-9` style.
3. **DOB + age** (`src/lib/dob.js`). Contentful's `classYear` field is gone,
   replaced by `dob`; see the age section below.
4. **Headshots** (`src/sync-headshots.js`). Fills blank `photo` fields with
   official ESPN transparent-PNG cutouts. Vendored here as a MANUAL tool
   (`npm run headshots`) rather than wired into `run.js` as Noah shipped it —
   it re-hosts ESPN/Getty-licensed images, so we run it deliberately. See
   README.md.

After pulling, a manual "Run workflow" will correct the live rankings without
waiting for Monday.


This folder is a complete, working Node 24 project (already tested end-to-end
in dry-run mode against the live sites). Your job is the infrastructure and
the app-side read path; Noah is handling everything inside Contentful
(see CONTENTFUL-SETUP.md — you don't need to touch it).

## What this is

A weekly scraper that blends public NBA draft big boards (NBADraft.net,
Tankathon) and RotoBaller's dynasty rookie rankings into one consensus rank
per draft year, writes it to Supabase, and creates draft Contentful entries
for new players. The app then renders the prospects page by joining Contentful
(editorial: bio/photo/video) to Supabase (rank + weekly movement) on the
player slug. Architecture, design decisions, and how to add sources: README.md.

The Contentful side is already fully set up (see CONTENTFUL-SETUP.md): content
type `prospectProfile`, slug unique, space `652mhs62v69t`. For the most recent
draft class, `team` in Supabase / `currentTeam` in Contentful carries the
player's ACTUAL current NBA team from RotoBaller (post draft-night trades) —
`team` updates weekly, so prefer it over the Contentful copy for display.

Run it locally right now, no credentials needed:

```bash
npm install
npm run dry-run
```

## Your checklist

1. **Supabase** — run `sql/schema.sql` in the SQL editor (project's existing
   database is fine; it only adds `prospect_rankings`, `rank_history`, and the
   `prospect_board` view, all RLS'd to public-read/service-role-write).

2. **GitHub** — push this folder to a **private** repo. Add Actions secrets
   (Settings → Secrets and variables → Actions). Noah is sending the four
   values on **CREDENTIALS-TEMPLATE.md**, which also explains where each one
   comes from if you need to regenerate one:

   | Secret | Where it comes from |
   |---|---|
   | `SUPABASE_URL` | Supabase → Settings → API |
   | `SUPABASE_SERVICE_ROLE_KEY` | same page (service_role, **not** anon) |
   | `CONTENTFUL_SPACE_ID` | Noah will give you this |
   | `CONTENTFUL_MANAGEMENT_TOKEN` | Noah will give you this (treat like a password) |

   If Noah's content type ID isn't `prospect`, also edit
   `CONTENTFUL_PROSPECT_TYPE` in `.github/workflows/weekly-scrape.yml`.

3. **First run** — Actions tab → "Weekly prospect rankings scrape" → Run
   workflow. Verify rows landed in `prospect_rankings` and that draft entries
   appeared in Contentful. It then runs Mondays 12:00 UTC; a failed source
   fails the run so GitHub emails about breakage (a short/broken scrape is
   skipped, never written).

4. **App integration** — read the `prospect_board` view with the anon key:

   ```js
   const { data: board } = await supabase
     .from("prospect_board")
     .select("player_slug, draft_year, display_rank, rank_change, team")
     .order("display_rank");
   ```

   Join to the published Contentful prospect entries on
   `player_slug === fields.slug`, group by `draft_year` (one tab/section per
   year), sort by `display_rank`. Movement badge from `rank_change`:
   `> 0` green ▲ N, `< 0` red ▼ N, `0` steady, `null` → "NEW".

   Prospects in Contentful with no board row: either hide them or show them
   unranked at the bottom — product call. Board rows with no published
   Contentful entry mean an unpublished draft is waiting on editorial; they'll
   appear once Noah's team publishes.

   For `youTubeId` (YouTube video-id field): embed via the official player
   (`react-native-youtube-iframe` on native, `<iframe>` on web) and hide the
   section on embed error (videos get taken down; card shouldn't break).

5. **Age display (replaces "Class Year")** — the Contentful content type no
   longer has `classYear`. It now has **`dob`** (a date-only field, e.g.
   `2007-07-18`), auto-filled by the pipeline from ESPN (drafted players) and
   Wikidata (everyone else), and left blank when neither has a reliable
   birthday.

   Store the birthday, compute the age at render time — that way it stays
   correct without ever re-syncing:

   ```js
   // dob: "2007-07-18" from Contentful, or null/undefined
   export function ageFromDob(dob) {
     if (!dob) return null;
     const b = new Date(dob);                      // parsed as UTC midnight
     const now = new Date();
     let age = now.getUTCFullYear() - b.getUTCFullYear();
     const m = now.getUTCMonth() - b.getUTCMonth();
     if (m < 0 || (m === 0 && now.getUTCDate() < b.getUTCDate())) age--;
     return age;
   }
   ```

   Use `getUTC*` throughout — mixing local and UTC getters makes the age flip
   by a day around midnight in western timezones. Render `null` as no age chip
   at all rather than "0" or "—".

   If you want the decimal age dynasty readers are used to seeing (Tankathon
   shows "19.7 yrs"), it's `((Date.now() - new Date(dob)) / 31557600000).toFixed(1)`.

6. **"Recent games" card section** — the job also syncs each player's last 3
   game lines from ESPN's public APIs (college gamelogs in season, Las Vegas
   Summer League in July, NBA gamelogs once the season starts) into
   `recent_games`. Read the `player_last_games` view (anon key):

   ```js
   const { data: recent } = await supabase
     .from("player_last_games")
     .select("player_slug, competition, game_date, opponent, minutes, points, rebounds, assists, steals, blocks, fg, fg3, ft")
     .in("player_slug", slugsOnPage);
   ```

   Render rows newest-first with a competition tag ("Summer League" /
   "College" / "NBA"). Players with no rows (international prospects, incoming
   freshmen before November, high schoolers) simply have no section — hide it,
   don't show an empty state that looks broken.

## Gotchas

- `updated_at` in `prospect_rankings` marks the last time a player appeared in
  a scrape; players who fall off all boards keep their last row. Filter on it
  if stale entries ever become visible.
- Slug mismatches (scraper vs. Contentful) are the most likely support issue —
  the fix is editing the Contentful entry's slug to match the job log, not
  code changes.
- Never expose `consensus_score`/`source_ranks` or single-source ranks in the
  UI — showing only our blended `display_rank` is deliberate (legal posture;
  see README).
