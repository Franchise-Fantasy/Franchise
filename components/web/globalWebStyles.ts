/**
 * Global CSS the RN style system can't express, injected once at import time.
 * Imported only from WebShell.web.tsx, so it never reaches a native bundle.
 *
 * Why this isn't in `app/+html.tsx`: that file only runs for STATIC rendering.
 * The app's web output is `"single"` (SPA), where Expo serves its own default
 * HTML shell and never evaluates `+html.tsx` — so anything put there silently
 * does nothing. Runtime injection works in both `expo start --web` and the
 * exported bundle.
 *
 * `font-synthesis: none` is the important one. Every brand face is loaded as a
 * SINGLE-WEIGHT family (`Fonts.varsityBold` *is* the bold file; SpaceMono ships
 * Regular only), and the codebase pairs them with `fontWeight: '600' | '700'`
 * all over. Native ignores fontWeight on a custom fontFamily and draws the real
 * face; the browser instead FAKES the weight by smearing the glyphs, which is
 * what made mono stat readouts and varsity caps look blurry on web. Disabling
 * synthesis makes the browser draw the real face — matching native exactly.
 */
// The inputs paint their own focus state (border goes accent), so the browser's
// default focus ring just doubles up on it. Keyboard focus stays visible via
// that border — we are not removing the affordance, only the duplicate.
const CSS = `
  * { font-synthesis: none; }
  html, body {
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  input:focus, textarea:focus, select:focus { outline: none; }
`;

const STYLE_ID = "franchise-web-globals";

if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

export {};
