// Learn more https://docs.expo.dev/guides/customizing-metro
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Native-only packages with no web build that throw at IMPORT on web (they
// register native views/modules at module scope). expo-router eagerly evaluates
// every route module at startup, so any one of these crashes the entire web
// boot — even on the login screen — when a route transitively imports it.
// Redirect them to a no-op on web. The features that use them (Skia analytics
// charts, view-shot screenshot sharing) are native-only and out of scope for
// the web app. @expo/ui / expo-widgets (the live-activity widget) are handled
// separately by widgets/MatchupActivity.web.tsx.
const WEB_NATIVE_STUBS = new Set([
  "@shopify/react-native-skia",
  "react-native-view-shot",
]);
const webNativeStub = path.resolve(__dirname, "lib/webNativeStub.js");

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === "web" && WEB_NATIVE_STUBS.has(moduleName)) {
    return { type: "sourceFile", filePath: webNativeStub };
  }
  return context.resolveRequest(context, moduleName, platform);
};

// Defer module execution to first use (Expo defaults this OFF). Without it,
// every module in the bundle is evaluated at cold launch; with it, screens
// pay for their imports when first opened. Bare side-effect imports (e.g.
// polyfills) are not inlined and stay eager.
config.transformer.getTransformOptions = async () => ({
  transform: {
    experimentalImportSupport: true,
    inlineRequires: true,
  },
});

module.exports = config;
