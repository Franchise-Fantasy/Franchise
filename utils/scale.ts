import { Dimensions } from "react-native";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const BASE_WIDTH = 402; // iPhone 17 Pro logical width (points)

const SCALE = SCREEN_WIDTH / BASE_WIDTH;

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
