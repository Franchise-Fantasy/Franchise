/**
 * Config plugin that disables code signing on ALL CocoaPods resource bundle
 * targets. React Native only patches React-Core; this covers every pod.
 *
 * Fixes: "Starting from Xcode 14, resource bundles are signed by default,
 * which requires setting the development team for each resource bundle target."
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const POST_INSTALL_SNIPPET = `
    # Disable code signing for all CocoaPods resource bundle targets (Xcode 14+)
    installer.target_installation_results.pod_target_installation_results.each do |pod_name, target_installation_result|
      target_installation_result.resource_bundle_targets.each do |resource_bundle_target|
        resource_bundle_target.build_configurations.each do |config|
          config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
        end
      end
    end`;

function withDisableResourceBundleSigning(config) {
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
      if (podfile.includes('Disable code signing for all CocoaPods resource bundle targets')) {
        return mod;
      }

      // Insert before the final 'end' of the post_install block,
      // or before the last 'end' in the file if there's no post_install
      if (podfile.includes('post_install do |installer|')) {
        // Add our snippet right after the post_install opening line
        podfile = podfile.replace(
          'post_install do |installer|',
          `post_install do |installer|${POST_INSTALL_SNIPPET}`,
        );
      } else {
        // No post_install block — add one before the final 'end'
        const lastEnd = podfile.lastIndexOf('\nend');
        if (lastEnd !== -1) {
          podfile =
            podfile.slice(0, lastEnd) +
            `\n  post_install do |installer|${POST_INSTALL_SNIPPET}\n  end` +
            podfile.slice(lastEnd);
        }
      }

      fs.writeFileSync(podfilePath, podfile, 'utf8');
      return mod;
    },
  ]);
}

module.exports = withDisableResourceBundleSigning;
