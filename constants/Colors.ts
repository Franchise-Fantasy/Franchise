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
  // Lighter merlot for dark-mode UI accents (tab icon, tint, link, active
  // state) where the deep merlot loses contrast against the warm dark
  // background. Mirrors the turfGreen → turfGreenSoft pattern.
  merlotSoft: "#8E2C36",
  turfGreen: "#1C552E",
  turfGreenDim: "#15421F",
  turfGreenSoft: "#2F6D42",
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
    success: BRAND.turfGreenSoft,
    successMuted: "rgba(47, 109, 66, 0.18)",
    danger: "#C44F35",
    dangerMuted: "rgba(196, 79, 53, 0.18)",
    warning: BRAND.heritageGoldDark,
    warningMuted: "rgba(158, 138, 96, 0.20)",
    gold: BRAND.heritageGoldDark,
    goldMuted: "rgba(158, 138, 96, 0.25)",
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
  // WNBA — burnt orange accent + merlot for the green-baseline tokens
  // (hero surface/shadow, active state, link, icon, tint). `success`
  // intentionally stays turfGreen so it doesn't collide with `danger`,
  // which is also merlot.
  wnba: {
    light: {
      accent:           '#BF5C30',
      gold:             '#BF5C30',
      goldMuted:        'rgba(191, 92, 48, 0.18)',
      tabIconSelected:  BRAND.merlot,
      warning:          '#BF5C30',
      warningMuted:     'rgba(191, 92, 48, 0.12)',
      analyticsAccent:  '#BF5C30',
      analyticsBg:      'rgba(191, 92, 48, 0.06)',
      analyticsBorder:  'rgba(191, 92, 48, 0.18)',
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
    dark: {
      accent:           '#A6502A',
      gold:             '#A6502A',
      goldMuted:        'rgba(166, 80, 42, 0.25)',
      tint:             BRAND.merlotSoft,
      tabIconSelected:  BRAND.merlotSoft,
      warning:          '#A6502A',
      warningMuted:     'rgba(166, 80, 42, 0.20)',
      link:             BRAND.merlotSoft,
      analyticsAccent:  '#A6502A',
      analyticsBg:      'rgba(166, 80, 42, 0.10)',
      analyticsBorder:  'rgba(166, 80, 42, 0.22)',
      activeBorder:     BRAND.merlotSoft,
      activeText:       BRAND.merlotSoft,
      activeCard:       'rgba(142, 44, 54, 0.20)',
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

  // ── Future sports — fill in when adding ──────────────────────────────
  // nfl: { light: { accent: '#2A5C3D', gold: '#2A5C3D', ... }, dark: { ... } },
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

// Brand typography tokens — set after fonts load in app/_layout.tsx.
// Consumers: ThemedText "display" and "varsity" types, plus any custom styled
// Text components that want the brand voice.
export const Fonts = {
  display: "AlfaSlabOne_400Regular", // headlines, hero, big moments
  varsitySemibold: "Oswald_500Medium", // secondary varsity labels
  varsityBold: "Oswald_700Bold", // primary varsity labels, tracked
  body: "Inter_400Regular",
  bodyMedium: "Inter_500Medium",
  bodyBold: "Inter_700Bold",
  mono: "SpaceMono", // pre-existing, already loaded
} as const;
