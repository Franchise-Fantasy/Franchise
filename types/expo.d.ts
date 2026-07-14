// Pulls in Expo's ambient types (react-native-web's `hovered` on
// PressableStateCallbackType, the `process`/`process.env` globals from
// expo/types/metro-require.d.ts, etc.).
//
// The Expo CLI normally provides this via the generated `expo-env.d.ts`, but
// that file is gitignored (.gitignore), so it doesn't exist in a fresh CI
// checkout — nothing in the Actions runner invokes the Expo CLI to regenerate
// it. Without it `tsc --noEmit` fails in CI while passing locally. This tracked
// file makes the reference survive a clean clone. Duplicate `reference types`
// directives are a no-op, so it costs nothing when expo-env.d.ts is present.
/// <reference types="expo/types" />
