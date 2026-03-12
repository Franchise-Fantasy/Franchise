import Constants from "expo-constants";

/**
 * True when running inside Expo Go (development).
 * False for TestFlight / production builds (EAS Build).
 */
export const isExpoGo = Constants.appOwnership === "expo";
