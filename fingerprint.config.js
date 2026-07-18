/**
 * @expo/fingerprint config — stabilizes the runtimeVersion fingerprint across
 * Windows ↔ EAS macOS so `eas build` and `eas update` produce matching hashes.
 *
 * Why each path is ignored:
 * - `ios/**` / `android/**`: the prebuild-generated native dirs only exist on
 *   whichever OS ran `expo prebuild`. EAS Build always regenerates them on
 *   macOS, but our Windows dev box never has them. Hashing them guarantees the
 *   fingerprint will diverge from the EAS-side computation. Skipping is safe —
 *   package.json + package-lock.json + plugin config already capture every
 *   meaningful native input via CNG.
 * - `node_modules/@shopify/react-native-skia/**`: Skia ships platform-specific
 *   prebuilt frameworks; npm installs different files on darwin-arm64 vs
 *   win32-x64, so the directory hash varies by OS. Skia version bumps still
 *   invalidate the fingerprint via package-lock.json — we only ignore the
 *   installed content, not the dependency declaration.
 *
 * `sourceSkips: ['GitIgnore']` drops `.gitignore` (fingerprint source reason
 * `bareGitIgnore`) from the hash. Editing it — e.g. adding a `!scripts/fonts/*.py`
 * negation — otherwise bumps the runtimeVersion and orphans every later OTA update
 * from the shipped binary: the app asks the server for its old fingerprint, the
 * server only has updates under the new one, and `checkForUpdateAsync()` silently
 * returns `isAvailable: false` — no error, no Install prompt. That stranded build
 * 103. Nothing we keep in `.gitignore` affects the native surface (this is a CNG
 * project — `ios/**` and `android/**` are already ignored above), so it has no
 * business gating OTA compatibility.
 *
 * @type {import('@expo/fingerprint').Config}
 */
module.exports = {
  ignorePaths: [
    'ios/**',
    'android/**',
    'node_modules/@shopify/react-native-skia/**',
  ],
  sourceSkips: ['GitIgnore'],
};
