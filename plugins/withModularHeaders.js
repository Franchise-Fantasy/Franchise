const fs = require('fs');
const path = require('path');

const { withDangerousMod } = require('@expo/config-plugins');

/**
 * Enables modular headers on the three non-modular Swift pods in the
 * @react-native-google-signin/google-signin -> GoogleSignIn -> AppCheckCore
 * dependency chain.
 *
 * Fixes the EAS / CocoaPods error:
 *   "[!] The following Swift pods cannot yet be integrated as static
 *    libraries: AppCheckCore depends upon GoogleUtilities and
 *    RecaptchaInterop, which do not define modules."
 *
 * GoogleSignIn 9.x (pulled transitively by
 * @react-native-google-signin/google-signin ^16.1.2) now depends on
 * AppCheckCore, which depends on GoogleUtilities and RecaptchaInterop. Those
 * three include Swift but declare no module map. CocoaPods integrates pods as
 * static LIBRARIES by default (no use_frameworks! here), and a Swift pod
 * (AppCheckCore) can't import non-modular dependencies in that mode — hence
 * "cannot yet be integrated as static libraries ... do not define modules".
 * modular_headers generates the module maps those deps need.
 *
 * We enable modular headers ONLY on those three pods rather than the global
 * use_modular_headers! flag, which would force module maps onto React
 * Native's own ReactCommon pods and trigger a "Redefinition of module
 * 'ReactCommon'" failure on RN 0.85 New Architecture
 * (facebook/react-native#45000).
 *
 * This is a managed (CNG) app with no committed ios/ directory, so the
 * Podfile is regenerated on every prebuild / EAS build. This plugin
 * re-applies the patch each time, mirroring
 * plugins/withDisableResourceBundleSigning.js.
 */

const MARKER = 'Modular headers for AppCheckCore Swift dependency chain';

const POD_LINES = [
  '',
  '    # ' + MARKER,
  "    pod 'GoogleUtilities', :modular_headers => true",
  "    pod 'RecaptchaInterop', :modular_headers => true",
  "    pod 'AppCheckCore', :modular_headers => true",
].join('\n');

function withModularHeaders(config) {
  return withDangerousMod(config, [
    'ios',
    async (mod) => {
      const podfilePath = path.join(
        mod.modRequest.platformProjectRoot,
        'Podfile',
      );

      if (!fs.existsSync(podfilePath)) {
        return mod;
      }

      let podfile = fs.readFileSync(podfilePath, 'utf8');

      // Don't patch twice
      if (podfile.includes(MARKER)) {
        return mod;
      }

      // Inject the targeted pod declarations into the main app target, right
      // after use_expo_modules! (where the GoogleSignIn chain is autolinked).
      // A same-name pod line with :modular_headers => true merges with the
      // autolinked spec rather than redeclaring it.
      if (podfile.includes('use_expo_modules!')) {
        podfile = podfile.replace(
          'use_expo_modules!',
          'use_expo_modules!' + POD_LINES,
        );
        fs.writeFileSync(podfilePath, podfile, 'utf8');
      }

      return mod;
    },
  ]);
}

module.exports = withModularHeaders;
