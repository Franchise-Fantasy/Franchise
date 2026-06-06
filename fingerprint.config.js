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
 * @type {import('@expo/fingerprint').Config}
 */
module.exports = {
  ignorePaths: [
    'ios/**',
    'android/**',
    'node_modules/@shopify/react-native-skia/**',
  ],
};
