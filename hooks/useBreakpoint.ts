import { Platform, useWindowDimensions } from "react-native";

/**
 * Viewport breakpoints for the web companion. Native always reports
 * `isDesktop: false` so phone screens never accidentally take the desktop
 * branch — the wide layouts are web-only. Re-renders on resize via
 * useWindowDimensions.
 */
export function useBreakpoint(): { width: number; isDesktop: boolean; isWide: boolean } {
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  return {
    width,
    isDesktop: isWeb && width >= 1024,
    isWide: isWeb && width >= 1440,
  };
}
