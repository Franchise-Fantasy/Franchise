// Web stub for the iOS Live Activity widget.
//
// The native widgets/MatchupActivity.tsx imports `@expo/ui/swift-ui` and
// `expo-widgets` at module scope — both register native code that throws on web
// (`requireNativeViewManager`). hooks/useLiveActivity.ts imports this module,
// and app/(tabs)/matchup.tsx imports that hook, so expo-router's eager route
// evaluation pulls this chain in at web boot. useLiveActivity gates every real
// call behind `Platform.OS === 'ios'`, so on web this stub only needs to exist
// with the right shape — its methods are never invoked.
import type {
  LiveCategoryLine,
  LivePlayerLine,
} from "@/utils/liveActivity/contentState";

export type MatchupPlayerLine = LivePlayerLine;
export type MatchupCategoryLine = LiveCategoryLine;
export type { MatchupActivityProps } from "./MatchupActivity";

export const MatchupActivity = {
  start() {
    throw new Error("Live Activities are not supported on web");
  },
  getInstances() {
    return [];
  },
} as unknown as typeof import("./MatchupActivity").MatchupActivity;
