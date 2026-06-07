/**
 * Forces aps-environment to 'production' on production builds.
 *
 * expo-widgets' own push-notifications plugin hardcodes
 * aps-environment = 'development' (see
 * node_modules/expo-widgets/plugin/src/ios/withPushNotifications.ts). That's
 * fine for dev / preview / TestFlight signed with development entitlements,
 * but on a release-signed binary iOS sees the mismatch and silently never
 * issues a push token to the Live Activity — Activity.pushToken stays nil
 * forever, getPushToken() returns null, and the activity_tokens insert
 * never lands.
 *
 * This plugin runs AFTER expo-widgets and rewrites the value when EAS reports
 * the build profile as 'production'. Dev / preview builds keep the
 * sandbox-flavored 'development' value the expo-widgets plugin emitted.
 */

const { withEntitlementsPlist } = require('expo/config-plugins');

const withProductionApsEnvironment = (config) => {
  return withEntitlementsPlist(config, (mod) => {
    const profile = process.env.EAS_BUILD_PROFILE;
    if (profile === 'production') {
      mod.modResults['aps-environment'] = 'production';
    }
    return mod;
  });
};

module.exports = withProductionApsEnvironment;
