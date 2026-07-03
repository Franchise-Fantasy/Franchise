import { Dimensions } from "react-native";

// Web variant of utils/scale.ts. The native file derives SCALE from the actual
// device width over a 402pt (iPhone 17 Pro) base. On the web that base is wrong:
// a 1440px monitor would yield SCALE ~3.6 and blow every sized element up to ~3.6x.
//
// Clamp the basis so desktop renders at the intended phone proportions inside a
// constrained column (DesktopShell caps the page width). Sub-phone-width browser
// windows still scale down like native. Exports the same s()/ms() signatures, so
// every existing callsite gets sane web values with zero component edits.

const BASE_WIDTH = 402; // matches native scale.ts
const MAX_BASIS = 430; // a hair wider than base for slightly more breathing room

// During the Node static-export pass there's no window, so Dimensions can report
// 0 — fall back to BASE_WIDTH (SCALE = 1) rather than collapsing everything.
const rawWidth = Dimensions.get("window").width;
const EFFECTIVE_WIDTH = Math.min(rawWidth > 0 ? rawWidth : BASE_WIDTH, MAX_BASIS);

const SCALE = EFFECTIVE_WIDTH / BASE_WIDTH;

/** Scale a pixel value proportionally to screen width. Use for spacing, padding, widths, heights, icon sizes. */
export function s(size: number): number {
  return Math.round(size * SCALE);
}

/**
 * Moderate scale — partially scales a value, controlled by factor (0–1).
 * factor=0 means no scaling, factor=1 means full proportional scaling.
 * Default 0.5 is a good middle ground for font sizes.
 */
export function ms(size: number, factor = 0.5): number {
  return Math.round(size + (s(size) - size) * factor);
}
