# Football Integration Scoping & Revised Timelines

> Last updated: March 2026
> Status: Decision needed by May 2026
> Assumption: Basketball platform mostly stable by early May

---

## Table of Contents

1. [Why Football](#why-football)
2. [Codebase Audit: What's Reusable vs What's New](#codebase-audit)
3. [Football-Specific Requirements](#football-specific-requirements)
4. [Work Breakdown & Effort Estimates](#work-breakdown)
5. [Timeline A: Basketball Only](#timeline-a-basketball-only)
6. [Timeline B: Basketball + Football](#timeline-b-basketball--football)
7. [Key Decision Factors](#key-decision-factors)

---

## Why Football

Fantasy football is ~10x the market size of fantasy basketball. Adding it would:
- Massively expand the addressable user base
- Create year-round engagement (NBA Oct-Apr, NFL Sep-Jan, overlap in Oct-Jan)
- Make the Pro/Premium subscription more valuable (one subscription covers both sports)
- Position Franchise as a multi-sport platform competing with Sleeper, not just a basketball niche app

The risk: it's a significant scope increase that could delay the basketball launch if not managed carefully.

---

## Codebase Audit

### Already Sport-Agnostic (No Changes Needed)

These systems work for any sport today:

| System | Key Files | Notes |
|---|---|---|
| **Draft logic** | `lib/draft.ts` | Pick generation, slot assignment, snake/linear — all generic |
| **Slot resolution** | `utils/resolveSlot.ts` | Handles lineup entries, DROPPED, acquired-at — no position references |
| **Trade engine** | `supabase/functions/execute-trade/` | Asset-based trades — players, picks, swaps. Sport-agnostic. |
| **Scoring calculation** | `utils/fantasyPoints.ts` (core math) | `stat * weight` multiplication is generic. The stat *names* are hardcoded, but the formula works for any sport. |
| **League scoring settings** | `league_scoring_settings` table | `stat_name` is just a string + `point_value` float. Can store any sport's stats. |
| **Chat & social** | `components/chat/*`, `hooks/chat/*` | DMs, polls, surveys, reactions — completely sport-agnostic |
| **Trading UI** | `components/trade/*` | Trade proposals, fairness bar, trade block, counter-offers — all generic |
| **Standings & matchups** | `supabase/functions/update-standings/` | Queries matchup results — doesn't care about sport |
| **Schedule generation** | Schedule generation logic | Generic week/matchup pairing |
| **Category scoreboard** | `components/matchup/CategoryScoreboard.tsx` | Renders any stat names — fully generic |
| **Notifications** | `lib/notifications.ts`, all push logic | Category-based preferences, sport-agnostic |
| **Import (Sleeper)** | `app/import-league.tsx` | Sleeper API supports NFL — endpoint swap is trivial |
| **Commissioner tools** | `components/commissioner/*` | Force add/drop, reverse trades, announcements — all generic |
| **League history** | `components/league-history/*` | Records, H2H matrix, trophy case — all generic |
| **Payment ledger** | `components/commissioner/PaymentLedgerModal.tsx` | Generic |
| **Premium gating** | `components/PremiumGate.tsx`, `useSubscription` | Generic |

### Needs Sport-Aware Parameterization (Moderate Changes)

These systems work but reference basketball-specific constants that need to become sport-driven:

| System | Key Files | What Changes | Effort |
|---|---|---|---|
| **Position definitions** | `constants/LeagueDefaults.ts` | `NBA_POSITIONS` is hardcoded. Need `NFL_POSITIONS` and sport-aware lookup. | 1-2 days |
| **Default roster slots** | `constants/LeagueDefaults.ts` | Basketball defaults (PG/SG/SF/PF/C/G/F/UTIL/BE/IR). Need NFL defaults (QB/RB/WR/TE/FLEX/K/DEF/BE/IR). | 1 day |
| **Default scoring** | `constants/LeagueDefaults.ts` | `DEFAULT_SCORING` and `DEFAULT_CATEGORIES` are basketball stats. Need NFL equivalents. | 1 day |
| **Stat-to-column mappings** | `utils/fantasyPoints.ts` | `STAT_TO_TOTAL` and `STAT_TO_GAME` map basketball stat names to DB columns. Need NFL mappings. | 1-2 days |
| **Position limits** | `utils/positionLimits.ts` | Hardcoded `['PG','SG','SF','PF','C']`. Needs to read from sport config. | 1 day |
| **Roster slot UI** | `components/create-league/StepRoster.tsx` | Reads from `NBA_POSITIONS`. Needs sport-aware position list. | 1 day |
| **Scoring UI** | `components/create-league/StepScoring.tsx` | "Reset to Standard 9-Cat" text and category list are basketball-specific. | 1 day |
| **Player insights** | `components/player/PlayerInsights.tsx` | Consistency, splits, B2B — concepts apply to football but stat references are basketball. Double-double/triple-double is basketball-only. | 2-3 days |
| **FPTS breakdown** | `components/player/FptsBreakdownModal.tsx` | Stat order and display names are basketball. | 1 day |
| **Game start logic** | `utils/gameStarted.ts` | Queries `nba_schedule`. Need to query by sport or rename table. | 1 day |
| **Finalize week** | `supabase/functions/finalize-week/` | `STAT_TO_GAME` mapping is basketball. Needs sport-aware mapping. | 1-2 days |
| **Get week scores** | `supabase/functions/get-week-scores/` | Same as finalize-week — basketball stat mapping. | 1-2 days |
| **Weekly summary modal** | `components/matchup/WeeklySummaryModal.tsx` | Stat column order is hardcoded basketball. | 1 day |

### Needs New Implementation (Significant Work)

These are new systems or major rewrites needed for football:

| System | What's Needed | Effort |
|---|---|---|
| **NFL player sync** | New edge function hitting Sleeper NFL endpoint (`/v1/players/nfl`). Different positions (QB/RB/WR/TE/K/DEF), different team codes (32 NFL teams). DEF is a "team" not a player — special handling needed. | 3-5 days |
| **NFL live stats polling** | New edge function for NFL game data. Different stat schema (pass_yds, rush_yds, rec_yds, pass_td, rush_td, etc). Different game cadence (weekly, not daily). Different API source. | 5-7 days |
| **NFL injury polling** | Different data source than NBA injury PDF. Sleeper API has injury data, or ESPN API. Different status labels (IR, PUP, Questionable, Doubtful, Out). Practice report integration (Wed/Thu/Fri designations). | 3-5 days |
| **Database schema changes** | Add `sport` column to `leagues` table. Handle NFL stats in `player_games` and `live_player_stats` (either add columns or create separate tables). Rename/extend `nba_schedule` → support NFL games. | 3-5 days |
| **NFL-specific scoring formats** | Standard, PPR, Half-PPR presets. IDP scoring option. Kicker scoring. D/ST (team defense) scoring with points-against tiers. | 2-3 days |
| **Bye week system** | NFL teams have 1 bye week per season. Need to surface this in roster management ("Player X is on bye this week"), free agent filters, and lineup warnings. | 2-3 days |
| **Weekly lineup locks** | Basketball uses per-game locks. Football needs weekly lock (all players lock at first game kickoff, typically Thursday 8:20 PM ET). Some leagues allow individual game locks. Configurable. | 2-3 days |
| **D/ST as a position** | Defense/Special Teams scores as a team unit, not an individual player. Needs special player card, different stat display, points-against tier scoring. | 2-3 days |
| **Kicker support** | Separate position with unique scoring (FG distance tiers, XP). Small player pool (~32 kickers). | 1-2 days |
| **Auction draft** | Football leagues commonly use auction drafts (real-time bidding, salary cap). Basketball rarely does. This is a significant feature if targeting football competitively. | 5-7 days (can defer) |
| **NFL schedule ingestion** | Fetch and store NFL weekly schedule. Map to fantasy weeks. Handle Thursday/Sunday/Monday game timing. | 2-3 days |
| **Backend data pipelines** | `backend/main.py` and `backend/sync_injuries.py` use `nba_api` Python library. Need equivalent NFL pipelines or replace with Sleeper API for both. | 3-5 days |
| **Testing across both sports** | End-to-end testing: create NFL league, draft, set lineups, score week, process waivers, run playoffs. | 5-7 days |

---

## Football-Specific Requirements

### Scoring Formats

| Format | Description | Popularity |
|---|---|---|
| **Standard** | No points for receptions. Basic yards + TDs. | Common for casual |
| **Half-PPR** | +0.5 per reception | Most popular overall |
| **Full PPR** | +1.0 per reception | Very popular in competitive |
| **IDP** | Individual defensive players instead of team D/ST | Niche but growing |

Default NFL scoring (Half-PPR):
- Passing: 0.04/yd, 4/TD, -2/INT
- Rushing: 0.1/yd, 6/TD
- Receiving: 0.1/yd, 6/TD, 0.5/reception
- Kicking: 3/FG, 1/XP (with distance bonuses)
- D/ST: Tiered by points allowed + sacks, INTs, fumble recoveries, TDs
- Turnovers: -2/fumble lost

### Roster Structure (Standard)

| Slot | Count | Notes |
|---|---|---|
| QB | 1 | (2 in Superflex/2QB leagues) |
| RB | 2 | |
| WR | 2 | (sometimes 3) |
| TE | 1 | |
| FLEX | 1 | RB/WR/TE eligible |
| K | 1 | |
| D/ST | 1 | Team defense, not individual |
| BE | 6-7 | |
| IR | 1-2 | |

### Key Differences from Basketball

| Aspect | Basketball | Football |
|---|---|---|
| Games per week | 2-4 per team | 1 per team |
| Lineup frequency | Daily | Weekly |
| Lock timing | Per-game start | First game of week or per-game |
| Bye weeks | No | Yes (1 per team per season) |
| Defense | Not applicable | Team D/ST or IDP |
| Kicker | Not applicable | Dedicated position |
| Scoring formats | Points or 9-Cat | Standard / Half-PPR / PPR / IDP |
| Draft types | Snake (mostly) | Snake + Auction (both common) |
| Season length | ~24 fantasy weeks | ~17 fantasy weeks |
| Playoff timing | Mar-Apr | Dec-Jan |

---

## Work Breakdown & Effort Estimates

### Phase 1: Multi-Sport Foundation (2-3 weeks)

Make the app sport-aware without building any football-specific features yet.

| Task | Effort | Details |
|---|---|---|
| Add `sport` column to `leagues` table + migration | 1 day | Enum: 'nba' \| 'nfl'. Default 'nba' for existing leagues. |
| Create sport config system | 2-3 days | `constants/SportConfig.ts` — positions, default scoring, default roster, stat mappings per sport. All existing hardcoded basketball constants become the NBA config. |
| Refactor position references | 2-3 days | Replace all `NBA_POSITIONS` imports with sport-aware lookups. Update StepRoster, positionLimits, etc. |
| Refactor stat mappings | 2-3 days | Make `STAT_TO_GAME`, `STAT_TO_TOTAL`, `DEFAULT_SCORING` sport-driven. |
| Refactor league creation wizard | 2-3 days | Add sport selector on Step 0. Load defaults from sport config. |
| Update player_games schema | 2-3 days | Either: add NFL stat columns + sport discriminator, or create `nfl_player_games` table. |
| Rename `nba_schedule` → `game_schedule` | 1 day | Add sport column, update all references. |

**Total: ~2-3 weeks**

### Phase 2: NFL Data Pipeline (1.5-2 weeks)

Using BallDontLie for NFL (same provider as NBA) significantly reduces this phase — same SDK, same auth, same patterns. NFL edge functions largely mirror the NBA ones with different endpoints and stat mappings.

| Task | Effort | Details |
|---|---|---|
| NFL player sync (BDL) | 2-3 days | Mirror `sync-players` but hit BDL NFL endpoints. Handle D/ST as team "players". Map positions. |
| NFL schedule + bye weeks | 1-2 days | Fetch NFL games from BDL, store in `game_schedule`, derive bye weeks per team. |
| NFL live stats polling | 2-3 days | Mirror `poll-live-stats` for BDL NFL game stats. Different stat schema. Weekly cadence (Thu/Sun/Mon only). |
| NFL injury sync | 1-2 days | Mirror existing injury sync but hit BDL NFL injuries endpoint. Map NFL designations (Q/D/O/IR/PUP). |
| Backend pipeline updates | 1-2 days | Add NFL equivalents to `main.py` / `sync_injuries.py` using BDL. |

**Total: ~1.5-2 weeks**

### Phase 3: Football-Specific Features (2-3 weeks)

| Task | Effort | Details |
|---|---|---|
| NFL scoring presets | 2 days | Standard, Half-PPR, PPR defaults. D/ST tier scoring. Kicker scoring. |
| D/ST position support | 2-3 days | Team defense as a "player". Special card UI. Points-against tier logic. |
| Kicker support | 1-2 days | Position + scoring for FG/XP with distance bonuses. |
| Bye week system | 2-3 days | Surface bye week warnings in roster, free agents, lineup setting. |
| Weekly lineup lock | 2-3 days | Replace per-game lock with weekly lock option. Configurable lock timing. |
| NFL-aware Player Insights | 2-3 days | Adapt consistency/trend/splits for football stats. Remove double-double. Add football-relevant insights (red zone targets, snap count trends). |
| NFL player card / detail | 2 days | Headshots, team logos, football-specific stat display. |

**Total: ~2-3 weeks**

### Phase 4: Testing & Polish (1-2 weeks)

| Task | Effort | Details |
|---|---|---|
| End-to-end NFL league flow | 3-4 days | Create league → draft → set lineup → score week → waivers → playoffs |
| Cross-sport regression testing | 2-3 days | Verify basketball still works perfectly after all changes |
| UI polish & edge cases | 2-3 days | Bye week edge cases, D/ST display, Thursday lock timing |

**Total: ~1-2 weeks**

### Deferred (Post-Launch)

| Feature | Notes |
|---|---|
| Auction drafts | Common in football but can launch without. Add in Season 2. |
| IDP support | Niche. Can add later as a differentiator. |
| Superflex / 2QB | Variant of roster config. Can add post-launch. |
| NFL Sleeper import | Import existing Sleeper NFL leagues. Sleeper API supports it. |

### Total Football Effort Estimate

| Phase | Duration | Parallelizable? |
|---|---|---|
| Multi-sport foundation | 1.5-2 weeks | Somewhat (schema + config can parallel) |
| NFL data pipeline (BDL) | 1.5-2 weeks | Yes (independent edge functions, same API patterns as NBA) |
| Football-specific features | 1.5-2 weeks | Somewhat |
| Testing & polish | 1-2 weeks | No (sequential) |
| **Total** | **5.5-8 weeks** | |

**With Claude Code velocity** (based on 4-5 weeks to build basketball from the ground up): realistically **4-6 weeks** of focused work. Using BallDontLie for both sports shaves time off the data pipeline since the patterns are identical to the existing NBA integration. The wildcard is debugging cross-sport regressions (changing shared code to be sport-aware while keeping basketball stable). This assumes basketball bugs are mostly resolved and you're not constantly context-switching.

---

## Pre-Season is the Real Deadline

Users need to import leagues, create new ones, and draft BEFORE the season starts. This is when platform-switching happens — not after week 1.

| Sport | Season Starts | Pre-Season Flow Locked By | Drafts Happen |
|---|---|---|---|
| **NFL** | Early Sep 2026 | **August 1** | All of August |
| **NBA** | Late Oct 2026 | **September 1** | All of September + early October |

This means:
- **Football code-complete = end of July**, not September
- **Basketball pre-season locked = September 1**, not late September
- Import flow, league creation, draft room, and roster setup must all work perfectly a **full month** before each season starts

---

## Timeline A: Basketball Only

> No football. Focus entirely on making the basketball platform exceptional and launching with monetization.

```
April 2026
|  Week 1-2: Finish current NBA season, bug fixes
|  Week 3-4: Bug fixes, UX polish, performance optimization
|
May 2026
|  Week 1-2: Continue polish, offseason flow testing
|  Week 3-4: Build Pro tier analytics (luck index, SoS, contender score, roster efficiency)
|
June 2026
|  Week 1-2: Build Pro tier analytics (punt analyzer, schedule grid, team needs)
|  Week 3-4: Build Pro tier analytics (enhanced trade analysis, playoff probability)
|
July 2026
|  Week 1-2: Build Premium tier features (AI trade advisor, draft value tracker)
|  Week 3-4: Build Premium tier features (dynasty trade values, AI weekly digest)
|
August 2026
|  Week 1-2: In-app purchase integration (App Store / Play Store)
|  Week 3-4: Premium gating UX, conversion triggers, pre-season flow polish
|
September 1 — NBA PRE-SEASON READY
|  Import, league creation, draft room — all bulletproof
|  Pro + Premium tiers + IAP all working
|  Users can create/import leagues and start drafting
|
September 2026
|  Week 1-4: Users drafting, monitor + hotfix
|            Marketing prep, app store optimization, beta feedback
|
October 2026 — NBA Season Launch
|  Full launch with Free + Pro + Premium tiers
|  League-wide plans available
```

### Pros
- **Maximum polish** — basketball experience is as good as it can possibly be
- **Full Pro/Premium tier** built and tested before launch
- **Less risk** — no football complexity to derail the timeline
- **Breathing room** — buffer for unexpected issues

### Cons
- **Smaller market** — basketball-only limits addressable audience
- **No NFL season revenue** — miss the September NFL wave entirely
- **Sleeper competes on both** — users who want one app for both sports will stay on Sleeper

---

## Timeline B: Basketball + Football

> Add football support. Football pre-season flow ready by August 1. NBA pre-season ready by late September.

```
April 2026
|  Week 1-2: Finish current NBA season, bug fixes
|  Week 3-4: Bug fixes, UX polish — get basketball stable
|
May 2026 — FOOTBALL GO (decide by May 1)
|  Week 1-2: Multi-sport foundation (sport column, sport config system)
|  Week 3-4: Refactor positions, stat mappings, league creation for sport-awareness
|
June 2026
|  Week 1-2: NFL data pipeline via BDL (player sync, schedule + bye weeks)
|  Week 3-4: NFL data pipeline (live stats, injury sync) + NFL scoring presets
|
July 2026
|  Week 1-2: Football-specific features (D/ST, kicker, bye weeks, weekly lock)
|  Week 3-4: Cross-sport testing, pre-season flow polish (import, create, draft)
|
August 1 — FOOTBALL PRE-SEASON READY
|  Import flow, league creation, draft room all working for NFL
|  Users can create/import NFL leagues and draft all August
|
August 2026
|  Week 1-2: Monitor NFL pre-season usage, hotfixes, iterate
|  Week 3-4: In-app purchases, premium gating (both sports), conversion triggers
|
September 2026 — NFL Season Starts
|  Week 1: NFL regular season begins — live scoring, waivers, matchups go live
|  Week 2-4: Monitor, hotfix, build remaining Pro analytics features
|
September 1 — NBA PRE-SEASON READY
|  Basketball pre-season flow locked: import, create, draft
|  Pro tier features ready (at least 4-6 core analytics)
|  Users can create/import NBA leagues and draft all September
|
October 2026 — NBA Season Launch
|  NBA season begins, full launch for both sports
|  Pro/Premium tiers live
```

### What Gets Cut or Deferred

To fit football in, some features get pushed. The pre-season flow (import, create league, draft) is the hard requirement — analytics are a fast-follow.

| Ready for August 1 (NFL pre-season) | Ready for NFL Week 1 (September) | Deferred to Oct-Nov |
|---|---|---|
| League creation (NFL) | Live scoring + matchups | AI Trade Advisor |
| Import from Sleeper (NFL) | Waiver processing | AI Weekly Digest |
| Snake draft (NFL) | Standings + playoffs | Dynasty Trade Value Chart |
| Roster management + bye weeks | Luck Index | Collusion Detection |
| D/ST + Kicker support | Strength of Schedule | Category Punt Analyzer |
| Weekly lineup locks | Contender Score | Enhanced Trade Analysis |
| Basic scoring (Standard/PPR/Half-PPR) | Roster Efficiency | Playoff Probability |
| Trade + chat (already sport-agnostic) | In-app purchases + gating | Auction drafts |

You'd launch NFL pre-season with a **solid base platform** (import, draft, roster, trade, chat), add live scoring features by week 1, and layer in Pro/Premium analytics through September-October. Premium tier is a November fast-follow.

### Pros
- **10x market** — fantasy football is massive
- **Year-round engagement** — NFL Sep-Jan, NBA Oct-Apr
- **Multi-sport subscription value** — one sub covers both
- **Competitive positioning** — "Sleeper alternative" rather than "basketball-only niche app"
- **Revenue earlier** — NFL season starts a month before NBA

### Cons
- **Pro/Premium tiers launch thin** — fewer analytics features at launch
- **Higher risk** — two sports to debug simultaneously
- **Less basketball polish** — some basketball refinement gets pushed
- **Context switching** — building football while fixing basketball bugs is hard
- **Football is an offseason build** — can't test against real NFL games until September

---

## Key Decision Factors

### Go Football If:

- You believe multi-sport is essential for competing with Sleeper long-term
- You're comfortable launching Pro tier with 4 features instead of 10+
- You can dedicate May-August primarily to football without basketball fires pulling you back
- You're okay with Premium tier launching in Oct/Nov instead of September

### Skip Football If:

- You want the basketball experience to be absolutely flawless at launch
- You'd rather launch with a full Pro + Premium tier and maximize conversion from day one
- You believe the basketball niche (dynasty/keeper depth) is differentiated enough to grow on its own
- You want buffer time for unexpected issues

### The Middle Path

There's also a hybrid option: **build the multi-sport foundation (Phase 1) in May regardless**, even if you don't build the full NFL pipeline yet. This means:

- Sport config system, sport column, refactored positions/stats — all done
- Basketball launches in October on the new sport-aware architecture
- Football can be added in a faster 4-6 week sprint later (Jan-Feb 2027 for the next NFL season)
- You don't box yourself into a basketball-only architecture

This costs ~2-3 weeks but future-proofs the codebase. Worth considering even if football is a "not now."

---

## Effort Summary

| Path | Total New Work | Launch With | Risk Level |
|---|---|---|---|
| **Basketball only** | ~0 weeks new (all analytics) | Full Pro + Premium + polish | Low |
| **Basketball + Foundation only** | ~2-3 weeks | Sport-aware architecture, lighter Pro | Low-Medium |
| **Basketball + Football** | ~4-6 weeks | Both sports, lighter Pro, no Premium yet | Medium |

---

## Appendix: Architecture Changes Detail

### Database Changes Needed

```
-- Add sport to leagues
ALTER TABLE leagues ADD COLUMN sport text NOT NULL DEFAULT 'nba' CHECK (sport IN ('nba', 'nfl'));

-- Rename nba_schedule → game_schedule (or add sport column)
ALTER TABLE nba_schedule RENAME TO game_schedule;
ALTER TABLE game_schedule ADD COLUMN sport text NOT NULL DEFAULT 'nba';

-- NFL stats in player_games (option A: add columns)
ALTER TABLE player_games ADD COLUMN pass_yds int DEFAULT 0;
ALTER TABLE player_games ADD COLUMN pass_td int DEFAULT 0;
ALTER TABLE player_games ADD COLUMN rush_yds int DEFAULT 0;
ALTER TABLE player_games ADD COLUMN rush_td int DEFAULT 0;
ALTER TABLE player_games ADD COLUMN rec int DEFAULT 0;
ALTER TABLE player_games ADD COLUMN rec_yds int DEFAULT 0;
ALTER TABLE player_games ADD COLUMN rec_td int DEFAULT 0;
ALTER TABLE player_games ADD COLUMN interceptions int DEFAULT 0;
ALTER TABLE player_games ADD COLUMN fumbles_lost int DEFAULT 0;
ALTER TABLE player_games ADD COLUMN fg_made int DEFAULT 0;
ALTER TABLE player_games ADD COLUMN fg_missed int DEFAULT 0;
ALTER TABLE player_games ADD COLUMN xp_made int DEFAULT 0;
-- ... additional NFL stat columns

-- NFL players (option: sport column on players)
ALTER TABLE players ADD COLUMN sport text NOT NULL DEFAULT 'nba';
ALTER TABLE players RENAME COLUMN nba_team TO team;
ALTER TABLE players RENAME COLUMN external_id_nba TO external_id;
```

### Sport Config Structure

```typescript
// constants/SportConfig.ts
export const SPORT_CONFIG = {
  nba: {
    positions: ['PG', 'SG', 'SF', 'PF', 'C'],
    flexSlots: ['G', 'F', 'UTIL'],
    defaultRoster: { PG: 1, SG: 1, SF: 1, PF: 1, C: 1, G: 1, F: 1, UTIL: 3, BE: 3, IR: 0 },
    defaultScoring: [ /* existing basketball scoring */ ],
    statMapping: { PTS: 'pts', REB: 'reb', AST: 'ast', /* ... */ },
    scoringTypes: ['points', 'h2h_categories'],
  },
  nfl: {
    positions: ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'],
    flexSlots: ['FLEX', 'SUPERFLEX'],
    defaultRoster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BE: 7, IR: 1 },
    defaultScoring: [ /* PPR scoring defaults */ ],
    statMapping: { PASS_YDS: 'pass_yds', RUSH_YDS: 'rush_yds', /* ... */ },
    scoringTypes: ['points'], // no H2H categories for football (typically)
  },
} as const;
```

### API Strategy: BallDontLie for Both Sports

Basketball is being migrated from NBA.com CDN + Sleeper to **BallDontLie** (SLA, cleaner injury data, paid API). BDL IDs are already being seeded via `backend/seed_bdl_ids.py`.

**BDL now supports NFL** with the same endpoint patterns as NBA. This means one API provider for both sports — same auth, same SDK, same code patterns. No need to scrape ESPN or rely on Sleeper (a direct competitor) for data.

**BDL NFL Coverage (ALL-STAR tier):**
- Players, active players, team rosters (2025+ season)
- Game stats (per-player: passing, rushing, receiving, defensive)
- Season stats (aggregated)
- Team stats
- Injuries with status and comments
- Games with real-time updates during play (filter by date, season, team, week, postseason)
- Historical data back to 2002

**Cost:**
| Tier | Price (per sport) | Rate Limit | Key Features |
|---|---|---|---|
| Free | $0/mo | 5 req/min | Teams, players, games only |
| ALL-STAR | $9.99/mo | 60 req/min | + Injuries, stats, active players |
| GOAT | $39.99/mo | 600 req/min | + Advanced stats, play-by-play, betting odds |

**Recommended: 2x ALL-STAR ($19.98/mo total)** — NBA + NFL, covers all data needs. Same API patterns for both sports means NFL edge functions can largely mirror NBA ones with different endpoints and stat mappings.

This simplifies the football build significantly — the NFL data pipeline phase shrinks because you're not integrating a new API provider, just new endpoints on the same one.

### New Edge Functions Needed

| Function | Purpose | API Source | Cron? |
|---|---|---|---|
| `sync-nfl-players` | Fetch NFL players | BDL NFL `/players` | Daily during season |
| `poll-nfl-stats` | Fetch live NFL game stats | BDL NFL `/stats` + `/games` | Every 1-2 min during games (Sun/Mon/Thu) |
| `poll-nfl-injuries` | Fetch NFL injury reports | BDL NFL `/players/injuries` | Daily during season |
| `sync-nfl-schedule` | Fetch NFL weekly schedule + bye weeks | BDL NFL `/games` | Weekly or once pre-season |

### BDL NFL Endpoints (Same Auth as NBA)

```
GET https://api.balldontlie.io/nfl/v1/players       -- All NFL players (search, filter by team)
GET https://api.balldontlie.io/nfl/v1/players/active -- Active roster players
GET https://api.balldontlie.io/nfl/v1/games          -- Games (filter by date, week, season, team)
GET https://api.balldontlie.io/nfl/v1/stats          -- Per-player game stats
GET https://api.balldontlie.io/nfl/v1/season_stats   -- Aggregated season stats
GET https://api.balldontlie.io/nfl/v1/injuries       -- Player injuries with status
GET https://api.balldontlie.io/nfl/v1/teams          -- All NFL teams
GET https://api.balldontlie.io/nfl/v1/teams/{id}/roster -- Team roster + depth chart (2025+)
```
