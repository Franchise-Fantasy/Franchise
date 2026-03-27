# Franchise v2 — Gap Analysis & Monetization Strategy

> Last updated: March 2026
> Status: Research / Strategy Draft

---

## Table of Contents

1. [Competitive Advantages](#competitive-advantages)
2. [Feature Gap Analysis](#feature-gap-analysis)
3. [Monetization Strategy](#monetization-strategy)
4. [Tier Breakdown](#tier-breakdown)
5. [League-Wide Plans](#league-wide-plans)
6. [Revenue Beyond Subscriptions](#revenue-beyond-subscriptions)
7. [Conversion Funnel](#conversion-funnel)
8. [Revenue Scenarios](#revenue-scenarios)
9. [Sources](#sources)

---

## Competitive Advantages

Areas where Franchise is ahead of or on-par with the major platforms:

| Area | What We Have | Competitor Weakness |
|---|---|---|
| **Dynasty/Keeper depth** | Taxi squad, pick protections, pick swaps, draft hub by year/team, keeper declaration, rookie drafts, lottery | ESPN/Yahoo have minimal dynasty support; Sleeper is close but lacks pick protections & swaps |
| **Commissioner tools** | Force add/drop, reverse trades, manual draft order, payment ledger, announcements, division assignment, extensive settings | ESPN commissioners get almost nothing; Yahoo is limited |
| **Trading system** | Fairness bar, counter-offers, trade block with interest tracking, pick/swap trading, auto-rumors, trade notes | Most platforms lack counter-offers, trade block interest, and auto-rumors |
| **Chat & social** | DMs, polls, surveys, trade rumors auto-generated, reactions, trade summaries in chat, presence | ESPN has no real chat; Yahoo is basic; only Sleeper competes here |
| **Import/migration** | Sleeper API import + screenshot-based AI import | Unique — no competitor offers screenshot import |
| **Notification granularity** | Per-category, per-league overrides, 14+ notification types | Most platforms are all-or-nothing |
| **League history** | Trophy case, all-time records, H2H matrix, standings history, draft board | ESPN/Yahoo wipe history poorly; Sleeper is decent |

---

## Feature Gap Analysis

### Tier 1: High Impact / Frequently Requested

#### 1. Player Projections & Rest-of-Season Rankings
- **Pain point**: Players rely on external tools (FantasyPros, Hashtag Basketball, Basketball Monster) for projections. No mobile-first app does this natively.
- **Who it affects**: All player types
- **What's missing**: Weekly/ROS projections, projected stat lines, matchup-based projections
- **Status**: Deferred — waiting on data infrastructure

#### 2. Streaming / Schedule Density Tool
- **Pain point**: Competitive players need to know which NBA teams play the most games in a given fantasy week. Currently requires external sites.
- **Who it affects**: Competitive players (huge for H2H formats)
- **What's missing**: "This week Team X plays 4 games" on the free agent list, weekly game counts per NBA team
- **Opportunity**: We already have NBA schedule data. Surfacing game counts on the free agent list and player cards is a relatively small lift with outsized value.

#### 3. Lineup Optimization / Start/Sit Recommendations
- **Pain point**: 47% of fantasy platforms now offer some AI analytics. Users want "who should I start?" guidance.
- **Who it affects**: Casual players (reduces decision fatigue) and competitive players
- **Status**: Depends on projections — hold for Premium tier

#### 4. Player Comparison Tool
- **Pain point**: Users can't compare two players side-by-side within any app. Always requires external tools.
- **Who it affects**: All player types (especially during trades and waiver decisions)
- **Opportunity**: Low complexity, high perceived value. Could live in the player detail modal.

#### 5. Matchup Preview & Projected Outcomes
- **Pain point**: Users want to see "am I projected to win this week?" before games start.
- **Who it affects**: All player types
- **Status**: Depends on projections

---

### Tier 2: Medium Impact / Differentiation Opportunities

#### 6. Waiver Wire / Free Agent Recommendations
- **Pain point**: Free agent lists show raw stats but don't help users decide who to pick up.
- **Who it affects**: Casual players (primary), competitive players
- **Opportunity**: Highlight players with recent stat spikes, or recommend adds based on team weaknesses.

#### 7. Category Punting Strategy Tools (H2H Categories)
- **Pain point**: Punting categories is the dominant competitive strategy, but no platform helps users execute it.
- **Who it affects**: Competitive H2H categories players
- **Opportunity**: Analyze roster's stat profile, identify natural punts, flag misaligned players. Pro feature.

#### 8. Playoff Probability / Clinching Scenarios
- **Pain point**: No platform shows playoff probability or clinching scenarios for fantasy basketball.
- **Who it affects**: All player types mid-to-late season
- **Opportunity**: Pair with existing standings section. Even clinched/eliminated/contention badges would help.

#### 9. Weekly Recap / Automated Newsletter
- **Pain point**: Commissioners want automated league recaps. Players want a summary of what happened.
- **Who it affects**: Commissioners (engagement), casual players (catch-up)
- **Opportunity**: League-wide recap as push notification or in-app digest. Great engagement driver.

#### 10. Integrated Payment Processing
- **Pain point**: Commissioners hate collecting league dues. Our payment ledger is manual tracking only.
- **Who it affects**: Commissioners
- **Opportunity**: Deep-link to Venmo/PayPal with pre-filled amounts, or full Stripe integration.

---

### Tier 3: Nice-to-Have / Niche

| Feature | Who It Affects | Notes |
|---|---|---|
| Mock Drafts | All (pre-draft) | Complex — needs AI drafters. High engagement pre-season. |
| Player News Feed / Injury Analysis | All | CMS infrastructure exists (Contentful). Add estimated return dates + news snippets. |
| Advanced Stat Support | Competitive | Derived stats like stocks (STL+BLK), A/TO ratio, custom formulas. |
| Dynasty Trade Value Chart | Dynasty | Replace KeepTradeCut/DYNATYZE. Premium feature. |
| Collusion Detection | Commissioners | Flag suspicious trade patterns. Premium feature. |

---

### Quick Wins (Low Effort, High Value)

1. **Game count badges on free agent list** — "4G this week" next to each player
2. **Player comparison** — Side-by-side modal using existing stat data
3. **Trending free agents** — Track add/drop volume across leagues
4. **Team needs analysis** — Roster stat weaknesses highlighted on free agent page

---

### Impact/Effort Summary

| Feature | Impact | Effort | Monetizable | Player Type |
|---|---|---|---|---|
| Player projections | High | High | Yes (Pro/Premium) | All |
| Schedule/streaming tool | High | Low | Pro | Competitive |
| Lineup optimizer | High | Medium | Yes (Premium) | Casual + Competitive |
| Player comparison | High | Low | Free | All |
| Matchup projections | High | Medium | Yes (Pro) | All |
| Waiver recommendations | Medium | Medium | Yes (Pro) | Casual |
| Category punt tools | Medium | Medium | Yes (Pro) | Competitive |
| Playoff probability | Medium | Low | Pro | All |
| Weekly recap | Medium | Medium | Free/Premium (AI version) | All |
| Payment integration | Medium | High | Yes (commission) | Commissioners |
| Mock drafts | Medium | Very High | Yes (Premium) | All |
| Player news feed | Medium | Medium | Free | All |
| Dynasty trade values | Medium | High | Yes (Premium) | Dynasty |
| Collusion detection | Low | High | Yes (Premium) | Commissioners |

---

## Monetization Strategy

### Market Landscape

| Platform | Model | Price | What You Get |
|---|---|---|---|
| **Sleeper** | Free + DFS contests | $0 | No premium tier; monetizes via Sleeper Picks (DFS entry fees) |
| **ESPN / Yahoo** | Free + ads | $0 | Ad-supported; no paid analytics tier |
| **Hashtag Basketball** | Patreon | $2.50/mo | Schedule grid, waiver rankings, trade machine, matchup planner, scouting reports |
| **FantasyPros** | Tiered subscription | $4-12/mo | Draft wizard, lineup optimizer, waiver assistant, trade tools (all sports) |
| **Basketball Monster** | Subscription | ~$5/mo | Rankings, projections, schedule tools, punt analysis |

**Key insight**: The platform layer (ESPN/Yahoo/Sleeper) is free. The analytics layer (Hashtag/FantasyPros/BballMonster) costs $2-12/mo. **Nobody bundles both into one app.** That's our opening.

---

### What We Already Have (Analytics Inventory)

All currently free and ungated:

| Feature | Status | Richness |
|---|---|---|
| Player Insights (consistency, trends, floor/ceiling, splits, B2B, bounce-back) | Built | Very rich |
| Player Rankings (overall + positional) | Built | Simple badges |
| Player Historical Stats (season-by-season) | Built | Full tables |
| Player Transaction Timeline | Built | Narrative timeline |
| FPTS Breakdown per game | Built | Detailed |
| Age Profile + League Comparison (scatter plots, insights) | Built | Rich |
| Standings with Clinch/Elimination math | Built | Advanced |
| Trade Fairness Bar (FPTS delta) | Built | Basic |
| League History (records, H2H matrix, draft board, trophy case) | Built | Comprehensive |

Defined but **not yet implemented**: roster_efficiency, luck_index, strength_of_schedule, contender_score (Pro), age_curve, draft_value_tracker, ai_trade_advisor (Premium).

Gating infrastructure (PremiumGate component + useSubscription hook) is **ready**.

---

## Tier Breakdown

### Free — "The Best Free Fantasy Basketball App"

**Goal**: Win the platform war against Sleeper/ESPN/Yahoo. Drive word-of-mouth.

Everything that makes Franchise a great *platform* stays free:

- Full league management, drafting, trading, chat, waivers, roster management
- Basic standings, schedule, matchup views
- Player cards with season averages, game logs, FPTS breakdown
- Player rankings (overall + positional badges)
- Player transaction timeline
- Clinched / eliminated badges on standings
- League history (trophy case, records, H2H matrix, draft board)
- Commissioner tools (all of them — commissioners choose the platform)
- Import from Sleeper / screenshot import
- All notification features
- Trade fairness bar (basic FPTS delta)

**New free features to drive adoption:**
- Game count badges on free agent list ("4G this week")
- Player comparison tool (side-by-side stats)
- Basic weekly recap (league-wide summary after each week)

**What moves behind the Pro gate** (currently free):
- Deep Player Insights (consistency labels, floor/ceiling bars, home/away splits, B2B impact, bounce-back rate) — keep the basic trend badge free
- Age Profile scatter plot + league comparison — keep basic average roster age free

---

### Pro — "The Analyst" ($4.99/mo | $34.99/yr)

**Goal**: Convert competitive players who currently pay for Hashtag ($2.50/mo), Basketball Monster (~$5/mo), or FantasyPros ($4-9/mo).

**Positioning**: *"Everything you open a second app for — built in."*

#### Existing features to gate at Pro:

| Feature | Status | Notes |
|---|---|---|
| Deep Player Insights | Built | Gate the expanded section. Keep basic trend badge free. |
| Age Curve + League Comparison | Built | Gate scatter plot + league comparison. Basic average age stays free. |
| Roster Efficiency | Not built | Grade based on active roster production vs bench, positional balance, category coverage |
| Strength of Schedule | Not built | Remaining schedule difficulty based on opponent average scoring |
| Contender Score | Not built | Composite of record + SoS + roster efficiency + recent trend |
| Luck Index | Not built | Compare actual W-L to expected W-L based on points scored |

#### New Pro features (no projections needed):

**Category Punt Analyzer** (H2H Categories)
> Radar chart of your roster's stat profile across all 9 categories. Identifies your 2-3 weakest categories and labels them as "natural punts." Flags players who hurt your build.
>
> *Data source*: Existing player_season_stats averages x roster composition.
> *Why it converts*: #1 strategic tool for H2H cats. Basketball Monster charges ~$5/mo for this.

**Team Needs Report**
> Per-category breakdown of your team's total production vs league average. Highlights where you're bottom-3. On the free agent page, adds a "Fills Need" badge to players strong in your weak categories.
>
> *Data source*: Aggregate roster stat averages vs league-wide averages.
> *Why it converts*: Directly answers "who should I pick up?" without needing projections.

**Advanced Schedule Grid**
> For each fantasy week, shows NBA team game counts. Highlights teams with 4+ games. On the free agent list, sorts/filters by "most games this week."
>
> *Data source*: NBA schedule data we already poll.
> *Why it converts*: This is Hashtag Basketball's #1 premium feature ($2.50/mo).

**Enhanced Trade Analysis**
> Expands the trade fairness bar to: category-by-category impact (H2H cats), recent performance trend comparison, roster fit analysis ("this trade weakens your AST but strengthens your 3PM").
>
> *Data source*: Existing player stats + roster composition.
> *Why it converts*: Trade decisions are high-stakes moments with high conversion potential.

**Playoff Probability**
> Win probability for making playoffs based on current record + remaining schedule. "Magic number" to clinch.
>
> *Data source*: Current standings + remaining schedule.
> *Why it converts*: No fantasy basketball app does this.

**Pricing rationale**: $4.99/mo is above Hashtag ($2.50) but below FantasyPros MVP ($8.99). Our tools are *inside* the platform — no context switching. Annual at $34.99 (~$2.92/mo) undercuts paying for Hashtag + Basketball Monster separately.

---

### Premium — "The Edge" ($9.99/mo | $59.99/yr)

**Goal**: Monetize power users, dynasty managers, and commissioners with AI-powered tools.

**Positioning**: *"Your unfair advantage."*

**Includes everything in Pro, plus:**

| Feature | Status | Details |
|---|---|---|
| AI Trade Advisor | Not built | AI-powered trade evaluation: "This trade improves your championship odds by X%" |
| Draft Value Tracker | Not built | Track how each draft pick has performed vs. ADP/draft position expectations |
| Dynasty Trade Value Chart | New | Auto-updating player values based on age + production trend. Replaces KeepTradeCut + DYNATYZE |
| Collusion Detection | New | Flags suspicious patterns: repeated lopsided trades between same teams, dump trades near playoffs |
| AI Weekly Digest | New | Personalized post-week summary with actionable insights. Uses existing stats, no projections. |
| Roster Optimization | Future | "Set optimal lineup" button. Needs projections — hold this slot. |

**Pricing rationale**: $9.99/mo replaces FantasyPros HOF ($8.99) + KeepTradeCut + Hashtag = $15-20/mo combined. Annual at $59.99 (~$5/mo) is the best deal in the market.

---

## League-Wide Plans

**Goal**: Commissioner buys once for their entire league. Every team gets the tier. Massive conversion funnel.

| Plan | Price | Per-team (10-team) | What Everyone Gets |
|---|---|---|---|
| **League Pro** | $14.99/mo or $99.99/yr | ~$1.50/team/mo | All Pro features for every team |
| **League Premium** | $24.99/mo or $149.99/yr | ~$2.50/team/mo | All Premium features for every team |

**Why this works:**
- Commissioners are the platform decision-makers
- One purchase converts 8-14 users to the paid experience
- Those users see Premium features and may individually upgrade
- Easy pitch: "everyone chip in $1.50/mo and we all get Pro"
- Creates buy-in and lock-in at the league level

**Implementation**: Commissioner purchases on league settings page. All teams in the league get the tier. If a user is in multiple leagues, they get the highest tier across all leagues + individual subscription.

**Conversion path:**

```
Commissioner creates league (free)
         |
League plays 2-3 weeks, sees Pro-gated features
         |
Commissioner buys League Pro ($14.99/mo)
"Let's all chip in $1.50 each"
         |
Dynasty managers see Premium features
         |
Individual users upgrade to Premium ($9.99/mo)
```

---

## Revenue Beyond Subscriptions

| Stream | Description | Effort | Potential |
|---|---|---|---|
| **League entry fees** | Paid leagues with built-in escrow (like LeagueSafe). 5-10% commission. | High | High |
| **Cosmetics** | Team logo packs, custom league themes, chat sticker packs, profile badges | Low-Med | Low-Med |
| **Affiliate / Partnerships** | NBA League Pass, sports betting (where legal), merchandise | Low | Medium |
| **Sponsored content** | CMS infrastructure exists — sponsored player insights or league tips | Low | Low-Med |

---

## Conversion Funnel

### Key Conversion Triggers

Show upgrade prompts at high-emotion moments:

| Moment | Prompt |
|---|---|
| User loses a close matchup | "Pro users get Playoff Probability to track their chances" |
| User browses free agents | "Pro users see games this week and trending pickups" |
| User proposes a trade | "Premium users get AI Trade analysis" |
| Commissioner gets a trade complaint | "Premium includes Collusion Detection" |
| End of each week | "Unlock your personalized AI Weekly Digest" |
| User views a player and sees the locked insights | "Unlock consistency scores, floor/ceiling, and splits with Pro" |

### What NOT to Monetize

These stay free to preserve competitive advantage:

- **Chat, polls, surveys, trade rumors** — Social features drive daily engagement. Gating kills network effect.
- **Commissioner tools** — Commissioners choose the platform. Gate these and they'll pick Sleeper.
- **Import tools** — Friction at onboarding = death.
- **League history** — Creates lock-in. The longer history lives here, the harder it is to leave.
- **Basic player stats and game logs** — Table stakes.

---

## Revenue Scenarios

Assuming 1,000 active leagues averaging 10 teams (10,000 users):

| Scenario | Breakdown | Monthly Revenue |
|---|---|---|
| **Conservative** | 5% individual Pro, 1% individual Premium | ~$3,500/mo |
| **Moderate** | 8% Pro, 3% Premium, 5% League Pro | ~$7,200/mo |
| **Optimistic** | 10% Pro, 5% Premium, 10% League Pro, 2% League Premium | ~$12,500/mo |

League-wide plans are the real multiplier — one commissioner purchase covers 8-14 users and creates upgrade pressure for Premium.

---

## Pricing At-a-Glance

| | Free | Pro | Premium |
|---|---|---|---|
| **Monthly** | $0 | $4.99 | $9.99 |
| **Annual** | $0 | $34.99 ($2.92/mo) | $59.99 ($5.00/mo) |
| **League Monthly** | — | $14.99 | $24.99 |
| **League Annual** | — | $99.99 | $149.99 |
| **Replaces** | Sleeper | Hashtag + BballMonster | + FantasyPros + KeepTradeCut |
| **Target** | Everyone | Competitive players | Dynasty / commissioners / power users |

---

## Sources

- [ESPN Fantasy App Reviews](https://justuseapp.com/en/app/555376968/espn-fantasy-sports-more/reviews)
- [Hashtag Basketball Premium Tools](https://hashtagbasketball.com/premium/)
- [FantasyPros Premium Plans](https://www.fantasypros.com/premium/plans/fp-ft/)
- [Sleeper Fantasy App](https://sleeper.com/fantasy-basketball)
- [Fantasy Sports Market Growth (IMARC)](https://www.imarcgroup.com/fantasy-sports-market)
- [FSGA Industry Research](https://thefsga.org/new-fsga-research-highlights-industry-stability-and-next-generation-growth-in-fantasy-sports-and-sports-betting/)
- [Fantasy Sports App Monetization Strategies](https://www.nimbleappgenie.com/blogs/fantasy-sports-app-monetization-strategies/)
- [Fantasy Sports App Development Trends 2025](https://www.pixelwebsolutions.com/fantasy-sports-app-development-trends/)
- [DYNATYZE NBA Trade Calculator](https://dynatyze.com/nba-trade-calculator)
- [Fantasy Basketball Commissioner Guide](https://www.nbafantasybasketball.com/p/the-complete-nba-fantasy-basketball)
