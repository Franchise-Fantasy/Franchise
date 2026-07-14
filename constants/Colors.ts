// Brand palette — single source of truth, referenced by theme tokens below.
// Not `as const` on purpose: downstream callers pass `Colors[scheme]`
// (a union of `Colors.light | Colors.dark`) around, and narrow literal
// types would make those two branches structurally mismatch.
const BRAND: Record<string, string> = {
  ecru: "#E9E2CB",
  cream: "#D9CFA6",
  hardwood: "#B8A06A",
  vintageGold: "#B57B30",
  // Heritage gold — the older, warmer gold that pre-dated the deck's
  // Vintage Gold. Retained as a second gold for UI elements where
  // Vintage Gold reads too bright/saturated (e.g. player headshot
  // rings, analytics card surface).
  heritageGold: "#9E8A60",
  heritageGoldDark: "#9E8A60",
  merlot: "#671A1E",
  // Lifted wine/rose — the dark-mode-legible relative of deep merlot, which
  // reads ~1.1:1 on the warm dark surfaces (invisible). #CF6B72 clears WCAG
  // AA (~4.3–5.0:1) for text/icons in dark mode. Now used ONLY by
  // RumorBubble's dark rumor accent — the WNBA theme chrome (tabs, tint,
  // links, active state) uses Heritage Gold in dark mode instead, because
  // the rose read as "too pink" against the gold-heavy dark UI.
  merlotSoft: "#CF6B72",
  turfGreen: "#1C552E",
  turfGreenDim: "#15421F",
  // Dark-mode success/positive — lifted so it reads as TEXT on the warm dark
  // surfaces. The old #2F6D42 was ~2.8:1 (failed AA); #4E9E6A clears ~4.0–5.3:1.
  turfGreenBright: "#4E9E6A",
  // Dark-mode danger/negative — lifted coral. The old #C44F35 was ~3.2:1 as
  // normal-size text (failed AA); #E07A60 clears ~4.4–5.9:1.
  coral: "#E07A60",
  sapphire: "#164D78",
  umber: "#A53C2A",
  ink: "#141010",
  inkMuted: "rgba(20, 16, 16, 0.72)",
  inkFaint: "rgba(20, 16, 16, 0.55)",
  ecruMuted: "rgba(233, 226, 203, 0.72)",
  ecruFaint: "rgba(233, 226, 203, 0.50)",
};

const tintColorLight = BRAND.turfGreen;
// Dark mode leans on the softer olive Heritage Gold instead of the
// brighter Vintage Gold — on the warm ink background Vintage Gold reads
// as orange, while Heritage Gold keeps the refined "aged leather"
// feel the deck's dark aesthetic is after.
const tintColorDark = BRAND.heritageGoldDark;

export const Colors = {
  light: {
    text: BRAND.ink,
    background: BRAND.ecru,
    tint: tintColorLight,
    icon: BRAND.turfGreen,
    tabIconDefault: "rgba(20, 16, 16, 0.35)",
    tabIconSelected: BRAND.vintageGold,
    card: "#FAF7F2",
    cardAlt: "#F4EFDC",
    border: "rgba(20, 16, 16, 0.12)",
    secondaryText: BRAND.inkMuted,
    input: "#FAF7F2",
    accent: BRAND.vintageGold,
    accentText: "#FFFFFF",
    activeCard: "#EFE8D0",
    activeBorder: BRAND.turfGreen,
    activeText: BRAND.turfGreen,
    buttonDisabled: "#B0A898",
    success: BRAND.turfGreen,
    successMuted: "rgba(28, 85, 46, 0.12)",
    danger: BRAND.merlot,
    dangerMuted: "rgba(103, 26, 30, 0.10)",
    warning: BRAND.vintageGold,
    warningMuted: "rgba(181, 123, 48, 0.12)",
    gold: BRAND.vintageGold,
    goldMuted: "rgba(181, 123, 48, 0.18)",
    // Announcement banner "feature" accent (the 4th banner type). NBA
    // baseline = umber; WNBA overrides to a brighter orange via SPORT_THEMES.
    bannerFeature: BRAND.umber,
    bannerFeatureText: BRAND.ecru,
    // Heritage gold — softer olive, used where Vintage Gold reads too
    // loud. Prefer this over `gold` for subtle surfaces and thin UI
    // strokes (rings, hairlines) against warm backgrounds.
    heritageGold: BRAND.heritageGold,
    heritageGoldMuted: "rgba(158, 138, 96, 0.18)",
    statusText: "#FFFFFF",
    link: BRAND.turfGreen,
    analyticsAccent: BRAND.vintageGold,
    analyticsBg: "rgba(181, 123, 48, 0.06)",
    analyticsBorder: "rgba(181, 123, 48, 0.18)",
    // Signature "hero" surface — deep field-green for the league/team
    // identity strip on home + the prospect profile hero. Sport-themed
    // (WNBA swaps to merlot via SPORT_THEMES).
    heroSurface: BRAND.turfGreen,
    heroShadow: {
      shadowColor: BRAND.turfGreen,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.18,
      shadowRadius: 16,
      elevation: 6,
    },
    // Primary brand accent — selected pills, segmented controls, brand
    // buttons, scoreboard header, champion crowning, profile/analytics
    // hero strips. Sport-themed (WNBA → merlot). Distinct from `success`
    // (kept turfGreen always) and `accent` (gold family).
    primary: BRAND.turfGreen,
    onPrimary: BRAND.ecru,
  },
  dark: {
    text: BRAND.ecru,
    // Warm dark olive — evokes aged leather / mid-century wood, matching
    // the deck's golden-era aesthetic. Replaces the previous near-black
    // (#0E0D0B) which felt too cool/modern against the ecru brand.
    background: "#1E1A10",
    tint: tintColorDark,
    icon: "#B5A48A",
    tabIconDefault: "rgba(233, 226, 203, 0.35)",
    tabIconSelected: tintColorDark,
    card: "#2B261C",
    cardAlt: "#36301F",
    border: "rgba(233, 226, 203, 0.10)",
    secondaryText: BRAND.ecruMuted,
    input: "#2B261C",
    accent: BRAND.heritageGoldDark,
    accentText: BRAND.ink,
    activeCard: "rgba(28, 85, 46, 0.16)",
    activeBorder: BRAND.heritageGoldDark,
    activeText: BRAND.heritageGoldDark,
    buttonDisabled: "#554545",
    success: BRAND.turfGreenBright,
    successMuted: "rgba(47, 109, 66, 0.18)",
    danger: BRAND.coral,
    dangerMuted: "rgba(196, 79, 53, 0.18)",
    warning: BRAND.heritageGoldDark,
    warningMuted: "rgba(158, 138, 96, 0.20)",
    gold: BRAND.heritageGoldDark,
    goldMuted: "rgba(158, 138, 96, 0.25)",
    bannerFeature: BRAND.umber,
    bannerFeatureText: BRAND.ecru,
    heritageGold: BRAND.heritageGoldDark,
    heritageGoldMuted: "rgba(158, 138, 96, 0.20)",
    statusText: "#FFFFFF",
    link: BRAND.heritageGoldDark,
    analyticsAccent: BRAND.heritageGoldDark,
    analyticsBg: "rgba(158, 138, 96, 0.10)",
    analyticsBorder: "rgba(158, 138, 96, 0.22)",
    heroSurface: BRAND.turfGreen,
    heroShadow: {
      shadowColor: BRAND.turfGreen,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.18,
      shadowRadius: 16,
      elevation: 6,
    },
    primary: BRAND.turfGreen,
    onPrimary: BRAND.ecru,
  },
};

export const Brand = BRAND;

// ── Sport-keyed theme overrides ────────────────────────────────────────────
// Each sport inherits the full Colors palette; the registry below overrides
// the accent family (gold / accent / tabIconSelected / warning / link /
// analyticsAccent) AND the primary brand surface family for sports that
// want to break from the green baseline (WNBA → merlot for `primary`,
// `heroSurface`, `heroShadow`, `tint`, `link`, `active*`). Tokens like
// `success` (turfGreen) and `icon` are intentionally never overridden so
// success doesn't collide with `danger` (merlot) and icon hue stays
// stable across sports.
//
// To add a new sport (NFL, NHL, MLB):
//   1. Widen `Sport` in constants/LeagueDefaults.ts
//   2. Add the corresponding entry below
//   3. ALTER TABLE leagues to allow the new value in the CHECK constraint
//
// NBA is the baseline (no overrides → uses Colors[scheme] verbatim).
type AccentOverrides = {
  light: Partial<typeof Colors.light>;
  dark:  Partial<typeof Colors.dark>;
};

export const SPORT_THEMES: Record<string, AccentOverrides> = {
  // WNBA — keeps the gold accent family and swaps the green-baseline tokens
  // to merlot. In LIGHT mode that covers the full accent set (hero, active
  // state, link, tint, selected tab icon, primary). In DARK mode deep merlot
  // is invisible and the lifted rose read "too pink", so only the hero
  // surface + primary button fill stay merlot — the rest inherit the
  // Heritage Gold baseline. `success` intentionally stays turfGreen so it
  // doesn't collide with `danger`, which is also merlot.
  wnba: {
    light: {
      bannerFeature:    '#C15C2A', // brighter orange — WNBA's sampled 4th accent
      tabIconSelected:  BRAND.merlot,
      tint:             BRAND.merlot,
      activeBorder:     BRAND.merlot,
      activeText:       BRAND.merlot,
      activeCard:       'rgba(103, 26, 30, 0.10)',
      link:             BRAND.merlot,
      heroSurface:      BRAND.merlot,
      heroShadow: {
        shadowColor:   BRAND.merlot,
        shadowOffset:  { width: 0, height: 6 },
        shadowOpacity: 0.18,
        shadowRadius:  16,
        elevation:     6,
      },
      primary:          BRAND.merlot,
    },
    // Dark mode: deep merlot is invisible (~1.1:1) and the lifted rose
    // (#CF6B72) read as "too pink" against the gold-heavy dark UI, so the
    // chrome accents (tint, selected tab icon, link, active pill
    // border/text) inherit the Heritage Gold dark baseline. Only the active
    // wash is pinned to gold (base dark washes green) and the hero surface +
    // primary button fill stay merlot, where merlot has the surface area to
    // read.
    dark: {
      bannerFeature:    '#C15C2A',
      activeCard:       'rgba(158, 138, 96, 0.20)',
      heroSurface:      BRAND.merlot,
      heroShadow: {
        shadowColor:   BRAND.merlot,
        shadowOffset:  { width: 0, height: 6 },
        shadowOpacity: 0.18,
        shadowRadius:  16,
        elevation:     6,
      },
      primary:          BRAND.merlot,
    },
  },

  // NFL — league navy primary + league red accent. Dark mode lifts navy to
  // a brighter sky-blue for tint/link so it reads against the warm dark
  // background, and softens red so it doesn't compete with `danger`.
  nfl: {
    light: {
      accent:           '#D50A0A',
      gold:             '#D50A0A',
      goldMuted:        'rgba(213, 10, 10, 0.18)',
      tabIconSelected:  '#013369',
      warning:          '#D50A0A',
      warningMuted:     'rgba(213, 10, 10, 0.12)',
      analyticsAccent:  '#D50A0A',
      analyticsBg:      'rgba(213, 10, 10, 0.06)',
      analyticsBorder:  'rgba(213, 10, 10, 0.18)',
      tint:             '#013369',
      activeBorder:     '#013369',
      activeText:       '#013369',
      activeCard:       'rgba(1, 51, 105, 0.10)',
      link:             '#013369',
      heroSurface:      '#013369',
      heroShadow: {
        shadowColor:   '#013369',
        shadowOffset:  { width: 0, height: 6 },
        shadowOpacity: 0.18,
        shadowRadius:  16,
        elevation:     6,
      },
      primary:          '#013369',
    },
    dark: {
      accent:           '#B8332E',
      gold:             '#B8332E',
      goldMuted:        'rgba(184, 51, 46, 0.25)',
      tint:             '#3A6FA8',
      tabIconSelected:  '#3A6FA8',
      warning:          '#B8332E',
      warningMuted:     'rgba(184, 51, 46, 0.20)',
      link:             '#3A6FA8',
      analyticsAccent:  '#B8332E',
      analyticsBg:      'rgba(184, 51, 46, 0.10)',
      analyticsBorder:  'rgba(184, 51, 46, 0.22)',
      activeBorder:     '#3A6FA8',
      activeText:       '#3A6FA8',
      activeCard:       'rgba(58, 111, 168, 0.20)',
      heroSurface:      '#013369',
      heroShadow: {
        shadowColor:   '#013369',
        shadowOffset:  { width: 0, height: 6 },
        shadowOpacity: 0.18,
        shadowRadius:  16,
        elevation:     6,
      },
      primary:          '#013369',
    },
  },

  // ── Future sports — fill in when adding ──────────────────────────────
  // nhl: { light: { accent: '#2D7A8E', gold: '#2D7A8E', ... }, dark: { ... } },
  // mlb: { light: { accent: '#9C5A3F', gold: '#9C5A3F', ... }, dark: { ... } },
};

export const cardShadow = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.08,
  shadowRadius: 8,
  elevation: 2,
} as const;

export const cardShadowMedium = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.14,
  shadowRadius: 14,
  elevation: 5,
} as const;

// Brand typography tokens — the licensed Franchise type system, loaded in
// app/_layout.tsx. Consumers: ThemedText's types, plus any custom styled Text
// component that wants the brand voice.
//
// Each weight is registered as its OWN single-weight family (see
// components/web/globalWebStyles.ts): native ignores `fontWeight` on a custom
// fontFamily, so the family name — not the weight — picks the face.
//
// NUMERALS. Two faces, split by size — a dot-matrix face is only legible when
// it's big:
//   `mono`  — every stat readout (columns, records, cells, tickers). ~112 sites.
//             Not a monospace face any more; the token name survives because the
//             ROLE didn't change and ThemedText's "mono" type points at it.
//   `score` — the focal score ONLY, where the dot-matrix reads as a stadium
//             board. Anything under ~30px must use `mono` instead: Dothed's dots
//             collapse into mush at stat-cell sizes. It's also subset to digits
//             and separators, so it renders TOFU for letters.
//
// Neither vendored file is what the designer delivered — both are normalized by
// scripts/fonts/normalize-numerals.py. Retail display faces consistently arrive
// (a) optically small, since fontSize is the em box and not the ink, and every
// size in this app was tuned against Space Mono's digit height; and (b) with
// proportional digits and no `tnum`, so a narrow '1' frays columns and makes a
// live score change width as it ticks. The script fixes both, which is why
// swapping the numerals face has never required touching a single fontSize.
// Re-run it against any new delivery.
//
// Any numeric readout belongs on one of these two. The other three faces have
// proportional digits (Stoner 53%, Desporm 50% spread) and will visibly reflow.
//
// ACCENTS. Desporm shipped with Latin-1 only — no Latin Extended-A — so player
// names like Dončić / Porziņģis dropped to the OS fallback font mid-word. The
// vendored file has those glyphs synthesized from the face's own accent parts
// by scripts/fonts/add-accents.py. Re-run it against any new Desporm delivery.
// Stoner / Fascond / JUST Sans arrived with full coverage and need nothing.
export const Fonts = {
  display: "Desporm", // headlines, hero, big moments
  varsitySemibold: "StonerSport", // secondary varsity labels
  varsityBold: "StonerSport", // primary varsity labels, tracked
  body: "JustSans_400Regular",
  bodyMedium: "JustSans_500Medium",
  bodySemibold: "JustSans_600SemiBold",
  bodyBold: "JustSans_700Bold",
  mono: "Fascond", // stat numerals — condensed, tabular
  score: "DothedScore", // focal score only, >=30px (digits + separators only)
} as const;
