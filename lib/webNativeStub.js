// No-op stand-in for native-only packages on web (see metro.config.js).
//
// expo-router eagerly evaluates EVERY route module at startup to validate the
// route tree, so a native package that throws at import (e.g. Skia/view-shot
// registering native views via requireNativeViewManager) crashes the whole web
// boot even on the login screen. This callable Proxy makes any import of such a
// package side-effect-free on web: every property access and call just returns
// the proxy again, so module-scope usage (`Skia.Path.Make()`, `captureRef(...)`,
// `<Canvas>`) never throws during evaluation. The features that use these
// packages are native-only and unavailable on web by design.
//
// Two escape hatches keep the stub from becoming a trap:
// - `then` reports undefined so the stub is NOT thenable — without this,
//   `await captureRef(...)` would call stub.then(resolve, reject), never settle,
//   and hang the caller forever.
// - `Symbol.toPrimitive` returns a real string so `String(stub)` and template
//   literals coerce instead of throwing.
const handler = {
  get: (_target, prop) => {
    if (prop === "__esModule") return true;
    if (prop === "then") return undefined;
    if (prop === Symbol.toPrimitive) {
      return () => "[native module unavailable on web]";
    }
    return stub;
  },
  apply: () => stub,
};

const stub = new Proxy(function noop() {}, handler);

module.exports = stub;
