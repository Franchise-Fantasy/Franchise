# App Store Submission Packet — Franchise

Prepared 2026-07-30 for v1.2.1. Everything below is copy-paste ready for App Store
Connect. Sections marked **⚠ BLOCKER** must be resolved before you hit Submit.

**App record facts (verified in repo):**

| Field | Value | Source |
|---|---|---|
| App name | Franchise | `app.json` |
| Bundle ID | `com.chewers.franchisev2` | `app.json` |
| ASC App ID | `6760477085` | `eas.json` |
| Apple Team ID | `9G67H3M2C7` | `eas.json` |
| Marketing version | 1.2.1 | `app.json` |
| Build number | auto-incremented by EAS (`autoIncrement: true`) | `eas.json` |
| Devices | iPhone only (`supportsTablet: false`) | `app.json` |
| Price | Free | — |
| In-app purchases | **None** (`PAYWALL_ENABLED = false`) | `constants/Subscriptions.ts` |
| Encryption | Exempt, declared in Info.plist (`ITSAppUsesNonExemptEncryption: false`) | `app.json` |
| Widget extension | `com.chewers.franchisev2.widgets` (+ Live Activities) | `app.json` |

---

## 0. ⚠ BLOCKERS — fix these before submitting

These are real gaps found in the codebase, not hypotheticals.

### B1. There is still no support *page*

The contact address is `admin@franchisefantasy.co`. It is now referenced
throughout the legal copy, but App Store Connect requires a **Support URL**, and
Guideline 1.2 (User-Generated Content) requires "a published point of contact."
`landing/src/config/site.ts` has no support route — `ROUTES` is `/`, `/faq`,
`/glossary`, `/dynasty-vs-redraft`, `/privacy`, `/terms`.

**Fix:** add a `https://franchisefantasy.co/support` page (short FAQ + the email
+ an explicit "report abuse" line) and register it in `ROUTES`. Until it exists
you have no valid Support URL to enter, and this is the single most likely cause
of a rejection loop.

*Interim fallback:* you may enter `https://franchisefantasy.co/faq` as the
Support URL if the FAQ page carries the email address prominently — but a real
support page is worth the twenty minutes.

### B2. ✅ DONE — legal copy updated

Both copies (`app/legal.tsx` and `landing/src/lib/legal.ts`) are updated to
**July 2026**. Changes:

- Terms §2 is now sport-agnostic ("fantasy sports application"), so it stays
  accurate when NFL opens up next year without another edit.
- New Terms §5 — **Objectionable Content and Community Conduct**, the
  zero-tolerance clause Guideline 1.2 expects, naming the filter, the report
  tool, Blocked Users, and the 24-hour review commitment.
- New Terms §6 — **League Dues and Payments**, stating plainly that Franchise
  never touches money, takes no fee, and awards no prizes.
- New Terms §7 — **Your Content** (the license you need to legally display a
  user's chat message to their league).
- Privacy gains **Content You Create** and **League Payment Handles** under §1,
  a new §4 **Safety and Moderation**, an explicit no-advertising/no-tracking
  line, and a law-enforcement disclosure clause.
- Every "contact us through the App" replaced with `admin@franchisefantasy.co`.

**One deliberate omission:** no governing-law / arbitration clause. I don't know
your entity's home state and guessing wrong is worse than leaving it out — Apple
doesn't require it. Add one sentence when you know the jurisdiction.

Note the Terms set a 13+ minimum while the App Store rating will be 17+. That
mismatch is normal and fine (the store rating reflects UGC risk, not your
contractual minimum) — just don't lower the store rating to match.

### B3. Real-money / payments surface needs an explicit position

The app deep-links to Venmo, Cash App and PayPal (`LSApplicationQueriesSchemes`
in [app.json:16-20](app.json#L16-L20)) and tracks a league buy-in ledger
([components/home/PaymentNudge.tsx](components/home/PaymentNudge.tsx),
[components/commissioner/PaymentLedgerModal.tsx](components/commissioner/PaymentLedgerModal.tsx)).
This *is* defensible — Franchise never touches money — but review will ask.
Prepared answer is in §4 (Review Notes) and §8 (Rejection Register), and
**Terms §6 now states the position in writing** (done in B2), which the notes
cite by section number so the reviewer can verify it at your Terms URL.

### B4. Rotate the leaked `service_role` key

Carried over from the 2026-07-29 production-readiness audit — still assigned to
you. Do it before the binary is public.

### B5. ~~Third-party SDK privacy manifests~~ — downgraded, not a blocker

**Correction to my first pass.** I overstated this. Of the three SDKs, only
**Google Sign-In** is on Apple's list of SDKs that *require* a privacy manifest
and signature; RevenueCat and PostHog are not on that list, and both ship a
`PrivacyInfo.xcprivacy` in their underlying iOS pod regardless. The manifests
live in `ios/Pods/`, generated at prebuild — which is why the `node_modules`
search came up empty. That result was expected, not a finding.

**Action:** none required. If you want belt-and-braces, after a local
`npx expo prebuild -p ios && pod install` run
`find ios/Pods -name 'PrivacyInfo.xcprivacy'` and confirm `GoogleSignIn` appears.

**On removing RevenueCat: recommend you don't.** See §10.

---

## 1. App Store Connect — App Information

**Name (30 char max)**
```
Franchise: Dynasty Fantasy
```

**Subtitle (30 char max)** — primary
```
Dynasty fantasy, done right
```
Alternates: `Fantasy leagues that last` · `Own the dynasty, every year`

**Primary category:** Sports
**Secondary category:** Games → Sports *(pick Games only if you want the Games
tab; Sports alone is the safer ASO play for a league-management app)*

**Content rights:** "This app contains, shows, or accesses third-party content."
→ **Yes.** (Player names, stats, headshots, team marks, news blurbs.)

**Copyright**
```
2026 Chewers LLC
```
*(Match this to the legal entity on your Apple Developer account exactly.)*

**Support URL** — ⚠ B1
```
https://franchisefantasy.co/support
```

**Marketing URL**
```
https://franchisefantasy.co
```

**Privacy Policy URL**
```
https://franchisefantasy.co/privacy
```

**Terms of Use (EULA) URL** *(optional field, but fill it — UGC app)*
```
https://franchisefantasy.co/terms
```

---

## 2. App Store copy

> **NFL is deliberately absent from all public copy.** It is gated behind
> `profiles.is_admin` plus a `leagues_nfl_admin_gate` DB trigger and is not
> reachable by any normal user, so advertising it would be an unshippable
> feature claim (Guideline 2.3.1, accurate metadata). Promotional Text and
> "What's New" are both editable without a new build — swap NFL in next year the
> day you flip the gate.

### Promotional Text (170 char max — editable without a new build)
```
Dynasty leagues that actually last. Multi-team trades, pick protections, keeper declarations, and a draft lottery your league will still be arguing about in July.
```
*(160 chars.)*

### Description (4,000 char max)
```
Franchise is fantasy for leagues that come back every year.

Most fantasy apps are built for one season. Franchise is built for the ones you keep — where the pick you traded three years ago still matters, where your rookie class is a plan, and where the guy who tanked last year is suddenly the problem.

Play NBA or WNBA. Redraft, keeper, or full dynasty.

— TRADING THAT ACTUALLY WORKS —
Multi-team deals. Counter-offers that go back and forth. Trade draft picks years out, with top-N protections and swap rights you can trade separately from the pick itself. A live fairness score so nobody gets fleeced quietly. And a trade block where you post who's available and see who's interested — instead of spamming the group chat.

— A DRAFT WORTH SHOWING UP FOR —
Live drafts with a real clock, or slow drafts that run for days with overnight quiet hours so nobody gets auto-picked at 3am. Snake or linear. Auction-style keeper declarations with live progress. An animated lottery reveal for your rookie draft order. Offline draft entry if your league does it around a table.

— NUMBERS YOU'LL ACTUALLY USE —
Not just season averages. Home/away and back-to-back splits. Consistency scores so you know if a player is steady or a rollercoaster. Category strengths ranked against your whole league. Aging curves built around your league's scoring settings. Adjustable game windows so you can compare the last 10 to the season.

— BUILT FOR DYNASTY —
Full league history with a trophy case and record book. A head-to-head matrix across every season you've played. Draft capital by year and by team. Your own prospect board, rankable years before a class is even draft-eligible, with landing-spot odds and staff-consensus comparisons.

— COMMISSIONER TOOLS THAT SAVE TIME —
Force lineup and roster moves. League announcements and polls. Divisions, playoff seeding, trade reversals, roster cuts, and waiver processing — without digging through five menus. Track who's paid their league dues and nudge who hasn't.

— IT KEEPS UP WITH YOU —
Live scoring that updates while games are on. A Home Screen widget and a Live Activity for your matchup. Eleven notification categories you can turn on and off one at a time. League chat and direct messages, with a trade rumor mill if you like stirring the pot.

— MOVING A LEAGUE OVER —
Import an existing league from a screenshot, or bring your league history in so year one isn't year one.

Franchise is free. There are no ads.

Franchise is an independent app and is not affiliated with, endorsed by, or sponsored by the NBA, the WNBA, or any of their teams or players' associations. All team names, logos, and player names and likenesses are the property of their respective owners. Franchise is for entertainment only — it does not process payments, take entry fees, or award prizes.

Terms of Use: https://franchisefantasy.co/terms
Privacy Policy: https://franchisefantasy.co/privacy
```

### Keywords (100 char max, comma-separated, **no spaces after commas**)

⚠ **Do not put NBA or WNBA in the keyword field.** Apple regularly rejects
metadata that uses third-party trademarks as keywords (Guideline 5.2.1). They
are fine *inside the description* as descriptive/nominative use with the
disclaimer you already have. No "fantasy football" either — you can't ship it
yet. Safe set:

```
dynasty,fantasy basketball,keeper league,draft,trade,commissioner,roster,waiver,lineup,hoops
```
*(91 chars.)*

### What's New in This Version

**Skip this field if this is your first public release** — it isn't displayed
for an initial submission. For the first update after launch:

```
• Slow drafts can now pause overnight, so nobody gets auto-picked at 3am
• Commissioners can edit rookie draft slots
• Faster league switching
• Fixes to roster cuts, autocut, and draft pick handling
```

---

## 3. Screenshots

iPhone only (`supportsTablet: false`), so you need **one** required set.

| Display | Size | Required? |
|---|---|---|
| 6.9" (iPhone 17 Pro Max / 16 Pro Max) | 1320 × 2868 or 1290 × 2796 | **Yes** |
| 6.5" | 1284 × 2778 / 1242 × 2688 | Optional — 6.9" scales down |
| iPad | — | Not needed |

**App icon:** 1024 × 1024 PNG, **no alpha channel, no rounded corners**. Verify
`assets/images/icon.png` has alpha stripped before upload — a transparent icon is
an automatic upload rejection.

**Shot list (10 max, first 3 carry the conversion):**

1. **Matchup / live scoring** — mid-week, scores moving. Caption: *"Live scoring, all week long."*
2. **Trade center, multi-team deal** — show the fairness score. Caption: *"Multi-team deals. Pick protections. Real trading."*
3. **Draft room, on the clock** — Caption: *"Live drafts, slow drafts, offline drafts."*
4. **Player analytics** — splits + consistency. Caption: *"Numbers that change your decision."*
5. **Prospect board** — Caption: *"Scout classes years out."*
6. **League history / trophy case** — Caption: *"Every season, remembered."*
7. **Lottery reveal** — Caption: *"A draft order worth watching."*
8. **Commissioner tools** — Caption: *"Run your league in two taps."*

Rules that trip people up: no device frames that imply a different device, no
Apple hardware imagery, no "Coming soon" or placeholder content, no real
people's photos you don't have rights to. Player headshots in screenshots are
the one genuine risk — if you want to be conservative, use screens that show
names and stats rather than portrait-heavy lists.

---

## 4. App Review Information

### Sign-In Required: **Yes**

⚠ **Create the demo account before submitting.** It must be a real, working
account in a league that is **mid-season with a completed draft, populated
rosters, at least one pending trade, and a few chat messages** — an empty account
gets you rejected for "we could not evaluate the app's features."

```
Username: appreview@franchisefantasy.co
Password: <set a stable one, do not rotate it during review>
```

Set the account up so that on first launch the reviewer lands directly in a live
league. Do **not** put it in a league where an autodraft/cron could mutate state
mid-review. If any commissioner-only screen matters (it does — §5 of your
description sells it), make the demo account the **commissioner** of that league.

### Notes (paste into "Notes")

**3,841 characters — fits the 4,000 limit with ~160 to spare** (~127 in the worst
case if the field counts CRLF line breaks as two). Pure ASCII: no em dashes,
curly quotes, or arrows, so nothing inflates on paste. If you edit this, re-count
before submitting — the previous draft was 4,672 and silently over.

```
WHAT FRANCHISE IS
Franchise is a fantasy sports league-management app for professional basketball. Users create private leagues with friends, draft players, set lineups, trade, and compete in head-to-head matchups across a season. It is a scorekeeping and league-administration tool for a private group.

DEMO ACCOUNT
The credentials above are the commissioner of a mid-season demo league with a completed draft, full rosters, a pending trade, and chat history, so every feature is reachable immediately after sign-in.

NO REAL-MONEY GAMING, NO GAMBLING, NO PRIZES
Franchise does not accept, hold, process, transfer, or pay out money. There is no wallet, no entry fee collected by us, no wagering, no odds, and no prize awarded by Franchise. Outcomes are determined solely by the real-world statistical performance of the athletes on a user's roster.

Some private leagues collect dues among their own members, entirely outside the app. For those leagues a commissioner may optionally record a dollar amount and their own Venmo, Cash App, or PayPal handle so members can see who has paid. The pay button is a plain deep link opening a third-party app the user already has installed; Franchise passes no amount, receives no funds, takes no fee, and cannot see whether a transfer occurred. Payment status is self-reported and confirmed by the commissioner - a shared checklist, nothing more. This is a person-to-person arrangement about a real-world activity between people who know each other, so it falls outside In-App Purchase (3.1.5(a)) and is not real-money gaming (5.3.4). It is optional and off by default; a league with no buy-in never shows it. This is why LSApplicationQueriesSchemes lists venmo, cashapp and paypal - solely to hide the button when that app is not installed. See Terms of Service section 6.

USER-GENERATED CONTENT (Guideline 1.2)
The app includes private league chat and direct messages, plus user-set team names and logos. All four requirements are implemented:
1. Filtering - a slur/profanity filter runs on the client and again server-side before any message or team name is saved, with leet-speak and accent normalization to defeat evasion.
2. Reporting - every message has a Report action (spam, harassment, hate, sexual, other) with an optional detail field, writing to a moderation queue that alerts us.
3. Blocking - Profile > Blocked Users lets any user block another and manage that list.
4. Contact - published at https://franchisefantasy.co/support and in our Terms.
We act on reports within 24 hours and remove offending content and users. Chat is private to a league the user was invited to; there is no public feed, no discovery of strangers, and no anonymous messaging.

ACCOUNT DELETION (5.1.1(v))
Profile > Delete Account performs full in-app deletion - profile, auth record, push tokens, chat authorship, and team vacancy across every league. No email or web form required.

SIGN IN WITH APPLE
Offered alongside Google and email on the same screen. The app works normally with an Apple private-relay address; no feature requires a real email.

IN-APP PURCHASES
None. The app is free with no ads and no paid tiers. A purchase SDK is present for a planned future release but is never initialized in this version and exposes no purchase UI.

THIRD-PARTY CONTENT
Player names, statistics, headshots, and news are used descriptively for fantasy scoring. Franchise is not affiliated with, endorsed by, or sponsored by any professional league, team, or players' association. A non-affiliation disclaimer appears in our Terms and on the store listing.

PERMISSIONS
Camera and Photo Library are requested only when a user chooses to attach an image to a chat message or set a team logo. Both are optional; everything else works if denied. Notifications are opt-in per category (11 toggleable categories).
```

### Attachment
Attach a short screen recording (30–60s) walking the demo account through:
sign-in → league home → matchup → trade center → chat → Profile > Delete Account.
It measurably reduces round-trips on UGC and payment-adjacent apps.

### Contact info
First/last name, phone, and an email you actually monitor daily during review.

---

## 5. App Privacy questionnaire

Answers derived from what the code actually sends. Data types you must declare:

**Contact Info → Email Address**
- Collected: **Yes**
- Linked to user: **Yes** · Used for tracking: **No**
- Purposes: **App Functionality** (authentication)

**Contact Info → Name**
- Collected: **Yes** (display name; optionally the name Apple shares on first Sign in with Apple)
- Linked: **Yes** · Tracking: **No** · Purpose: **App Functionality**

**User Content → Photos or Videos**
- Collected: **Yes** (chat image attachments, team logos)
- Linked: **Yes** · Tracking: **No** · Purpose: **App Functionality**

**User Content → Customer Support**
- Collected: **Yes** (abuse report details)
- Linked: **Yes** · Tracking: **No** · Purpose: **App Functionality**

**User Content → Other User Content**
- Collected: **Yes** (chat messages, DMs, team names, poll responses)
- Linked: **Yes** · Tracking: **No** · Purpose: **App Functionality**

**Identifiers → User ID**
- Collected: **Yes** (Supabase user id; PostHog `identify`; Expo push token)
- Linked: **Yes** · Tracking: **No** · Purposes: **App Functionality**, **Analytics**

**Identifiers → Device ID**
- Collected: **Yes** (push notification token / device record)
- Linked: **Yes** · Tracking: **No** · Purpose: **App Functionality**

**Usage Data → Product Interaction**
- Collected: **Yes** (PostHog product analytics)
- Linked: **Yes** · Tracking: **No** · Purpose: **Analytics**

**Diagnostics → Crash Data / Performance Data**
- Collected: **Yes** if you keep PostHog exception capture on; otherwise No
- Linked: **Yes** · Tracking: **No** · Purpose: **App Functionality**

**Declare NOT collected:** Health & Fitness, Financial Info (Payment Info,
Credit Info, Other Financial Info — you store a *handle*, never an instrument or
an amount transacted), Location (all types), Sensitive Info, Contacts, Search
History, Browsing History, Purchases, Advertising Data.

> On Financial Info: a Venmo username is a public handle, not payment
> information, and no transaction data ever reaches your servers. If you'd rather
> be conservative, declare it under **Contact Info → Other Contact Info**, linked,
> App Functionality, not used for tracking. Either is defensible; the second is
> safer.

**Tracking:** answer **No** to "Do you or your third-party partners use data for
tracking?" You bundle no ad SDK, no IDFA, and no `expo-tracking-transparency` —
so **no ATT prompt is required**, and you must not add one.

---

## 6. Age Rating questionnaire

Recommended answers under Apple's current global age-rating questionnaire:

| Question | Answer |
|---|---|
| Violence (cartoon / realistic / graphic) | None |
| Sexual content or nudity | None |
| Profanity or crude humor | None *(filtered — see below)* |
| Alcohol, tobacco, or drug use | None |
| Horror / fear themes | None |
| Mature / suggestive themes | None |
| Medical / treatment info | None |
| **Simulated gambling** | **None** |
| **Gambling (real money)** | **No** |
| **Contests** | **Yes** — private, skill-based fantasy contests |
| **User-generated content or messaging** | **Yes** — private league chat and DMs |
| Ability to interact / connect with people | **Yes** — invited league members only |
| Ability to share user location | No |
| Unrestricted web access | **No** |
| In-app controls / parental gate | Not applicable |
| In-app purchases | No |

**Expected rating: 17+** (driven by the UGC/messaging and contests answers). Do
not be tempted to answer "No" to messaging to chase a lower rating — misdeclaring
UGC is a fast rejection and a possible removal later.

**Simulated gambling = None** is correct and important: fantasy outcomes are
determined by real athletes' statistical performance, and the app contains no
casino/wagering mechanic, no odds, no virtual currency, and no chance-based
payout. (The draft *lottery* is a weighted draft-order reveal within a private
league, awards nothing of value, and costs nothing to enter.)

---

## 7. Legal copy — ✅ applied

Both copies are updated and in the working tree:

- [app/legal.tsx](app/legal.tsx) — Terms 13 sections, Privacy 11 sections
- [landing/src/lib/legal.ts](landing/src/lib/legal.ts) — same body text, with
  `LAST_UPDATED` bumped to `"July 2026"`

They are hand-synced by convention (the header comment in `legal.ts` says so and
there is no scanner enforcing it) — **if you edit one, edit the other.**

Full detail on what changed is in **B2** above. Remaining to-dos on this front:

- [ ] Add a governing-law sentence once you know the entity's home state
- [ ] Deploy the landing site so `/privacy` and `/terms` serve the new text
      *before* you submit — the reviewer will open the URL you enter, and stale
      hosted text that contradicts your review notes is a bad look

---

## 8. Rejection-risk register — prepared responses

| # | Risk | Likelihood | Prepared response |
|---|---|---|---|
| 1 | **1.2 UGC** — no published point of contact | **High** until B1 lands | Ship the support page. Then point them at it plus the four implemented controls (filter, report, block, contact), all now named in the Terms. |
| 2 | **5.3.4 real-money gaming** — buy-in tracker + payment deep links | Medium | Paragraph 4 of the Review Notes, now backed by Terms §6. Emphasize: no funds touched, no fee, no prize, self-reported checklist, optional and off by default, person-to-person about a real-world activity. |
| 3 | **3.1.1 / 3.1.5(a)** — external payment links | Medium | Same paragraph. League dues are person-to-person payments for a real-world private arrangement, explicitly outside IAP scope. No digital goods or app functionality is unlocked by paying. |
| 4 | **2.1 App Completeness** — demo account is empty or the reviewer can't reach a feature | Medium | Populated, commissioner-level demo league + attached screen recording. |
| 5 | **5.2.1 / metadata** — league marks in name, subtitle, or keywords | Medium | Marks stay out of the keyword field entirely; they appear only in the description with the non-affiliation disclaimer. |
| 6 | **2.3.1 — metadata describes an unshippable feature** | Low, now that NFL is out of the copy | NFL is admin-gated and absent from all public metadata. Do not re-add it until the gate flips. |
| 7 | **4.8 / 5.1.1** — third-party login without Sign in with Apple | Low | Already implemented — offered on the same screen with equal prominence. |
| 8 | **5.1.1(v)** — no in-app account deletion | Low | Implemented at Profile > Delete Account. Show it in the recording. |
| 9 | **Privacy manifest missing for a bundled SDK** | Low | Downgraded — see B5. Only Google Sign-In is on Apple's required list and it ships one. |
| 10 | **Privacy label mismatch** — labels don't match observed traffic | Low | §5 is derived from actual call sites. Re-open it when you flip the paywall on (that adds Purchases). |
| 11 | **Age rating mismatch** — UGC declared but rated low | Low | Answer Yes to messaging/UGC and accept 17+. |

---

## 9. Pre-flight checklist

**Code / build**
- [ ] `npm ci` (guards against the stale-`node_modules` fingerprint failure)
- [ ] `npm run check` green
- [ ] Version bumped in `app.json` if you want something other than 1.2.1
- [ ] Production build: `eas build --platform ios --profile production`
- [ ] App icon 1024×1024, **alpha channel stripped**
- [ ] Test on a real device: cold launch, sign-up from scratch, Sign in with Apple with "Hide My Email", deny camera + photos and confirm nothing crashes, delete account end-to-end

**Content**
- [x] Legal copy updated in **both** `app/legal.tsx` and `landing/src/lib/legal.ts`
- [ ] Support page live at `franchisefantasy.co/support`, listed in `ROUTES` (B1)
- [ ] `admin@franchisefantasy.co` mailbox actually monitored — the Terms now
      commit you to a 24-hour abuse-report turnaround
- [ ] Landing site **redeployed** so `/privacy` and `/terms` serve the July text
- [ ] Governing-law sentence added once the jurisdiction is settled
- [ ] 6.9" screenshots exported per §3 — **no NFL screens**

**Backend**
- [ ] `service_role` key rotated (B4)
- [ ] Demo league seeded, mid-season, commissioner-owned, excluded from cron mutation
- [ ] Push notifications verified against a production-signed build (`withProductionApsEnvironment` is in the plugin list — confirm the entitlement lands)
- [ ] Confirm no edge function is left deployed with `verify_jwt: true`

**App Store Connect**
- [ ] All §1 fields filled
- [ ] §2 copy pasted
- [ ] §4 review notes + demo credentials entered, recording attached
- [ ] §5 privacy answers submitted
- [ ] §6 age rating submitted
- [ ] Export compliance: **No** (already declared in Info.plist, so ASC should not even ask)
- [ ] Advertising identifier: **No**
- [ ] Release option chosen — recommend **manual release** for a first submission so you control launch day
- [ ] Phased release: **On**

---

## 10. Should you rip RevenueCat out? — No.

**Recommendation: leave it in.** I raised this under B5 and I was wrong about the
premise; here's the corrected reasoning.

**Why removal buys you nothing:**

- The privacy-manifest concern that motivated it doesn't apply (B5). RevenueCat
  is not on Apple's required-manifest list, and ships one anyway.
- The SDK is **never initialized**. `initPurchases()` returns at
  [lib/purchases.ts:69](lib/purchases.ts#L69) before `Purchases.configure()`
  because `PAYWALL_ENABLED` is `false`. No API key is read, no network call is
  made, no data is collected — so there is nothing extra to declare on the
  privacy questionnaire and nothing for a reviewer to see.
- Apple does not reject apps for linking an unused framework. "Contains no IAP"
  stays a truthful answer.

**What removal would actually cost:** it isn't a one-line dependency drop. You'd
be gutting or deleting four things and un-deleting them in a few months —
[lib/purchases.ts](lib/purchases.ts) (all six exported functions),
[hooks/useOfferings.ts](hooks/useOfferings.ts),
[components/account/UpgradeModal.tsx](components/account/UpgradeModal.tsx), and
the `initPurchases`/`logoutPurchases` call sites — plus the `PurchasesPackage`
types those files are written against. Then you'd re-add a native dependency,
which bumps the fingerprint and forces another build cycle right when you're
trying to ship. That's real regression surface bought for zero review benefit.

**If you do want it gone anyway,** the safe order is: delete `UpgradeModal` and
`useOfferings` → reduce `lib/purchases.ts` to just `syncSubscriptionFromRC` (it
only calls a Supabase edge function and has no `react-native-purchases` import)
→ drop the dep → `npx expo prebuild --clean`. Leave the `sync-subscription` /
`manage-subscription` edge functions and the RevenueCat webhook deployed — they
are server-side, cost nothing idle, and re-adding them is the annoying part. Say
the word and I'll do it as its own change.

**Either way, one line is already in the review notes** (§4, "In-App Purchases")
disclosing that a purchase SDK is present but dormant. That's the honest framing
and it costs nothing.
```
