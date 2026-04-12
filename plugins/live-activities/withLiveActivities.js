/**
 * Expo Config Plugin for iOS Live Activities (ActivityKit + WidgetKit).
 *
 * At EAS Build time this plugin:
 * 1. Adds NSSupportsLiveActivities = YES to the main app Info.plist
 * 2. Creates a Widget Extension target for the Live Activity UI
 * 3. Adds an App Group shared between the app and extension
 * 4. Copies Swift source files into the extension
 * 5. Registers the native module bridge in the main app target
 */
const {
  withInfoPlist,
  withXcodeProject,
  withEntitlementsPlist,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const WIDGET_BUNDLE_ID = 'com.chewers.franchisev2.LiveActivity';
const APP_GROUP = 'group.com.chewers.franchisev2';
const EXTENSION_NAME = 'FranchiseLiveActivity';
const DEPLOYMENT_TARGET = '16.1';

// ── Step 1: Info.plist ──────────────────────────────────────────────────────

function withLiveActivityPlist(config) {
  return withInfoPlist(config, (mod) => {
    mod.modResults.NSSupportsLiveActivities = true;
    return mod;
  });
}

// ── Step 2: App Group entitlement ───────────────────────────────────────────

function withAppGroupEntitlement(config) {
  return withEntitlementsPlist(config, (mod) => {
    const groups = mod.modResults['com.apple.security.application-groups'] || [];
    if (!groups.includes(APP_GROUP)) {
      groups.push(APP_GROUP);
    }
    mod.modResults['com.apple.security.application-groups'] = groups;
    return mod;
  });
}

// ── Step 3: Widget Extension target in Xcode project ────────────────────────

function withWidgetExtension(config) {
  return withXcodeProject(config, (mod) => {
    const proj = mod.modResults;

    // Copy Swift files into the iOS build directory
    const iosDir = mod.modRequest.platformProjectRoot;
    const extDir = path.join(iosDir, EXTENSION_NAME);
    if (!fs.existsSync(extDir)) {
      fs.mkdirSync(extDir, { recursive: true });
    }

    // Copy widget Swift files
    const widgetSrcDir = path.join(__dirname, 'widget');
    const srcDir = path.join(__dirname, 'src');

    const widgetFiles = fs.existsSync(widgetSrcDir)
      ? fs.readdirSync(widgetSrcDir).filter((f) => f.endsWith('.swift'))
      : [];
    const srcFiles = fs.existsSync(srcDir)
      ? fs.readdirSync(srcDir).filter(
          (f) => f.endsWith('.swift') && f !== 'FranchiseLiveActivityModule.swift',
        )
      : [];

    for (const file of widgetFiles) {
      fs.copyFileSync(path.join(widgetSrcDir, file), path.join(extDir, file));
    }
    for (const file of srcFiles) {
      fs.copyFileSync(path.join(srcDir, file), path.join(extDir, file));
    }

    // Write Info.plist for the extension
    const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>Franchise Live</string>
  <key>CFBundleIdentifier</key>
  <string>${WIDGET_BUNDLE_ID}</string>
  <key>CFBundleName</key>
  <string>${EXTENSION_NAME}</string>
  <key>CFBundlePackageType</key>
  <string>XPC!</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.widgetkit-extension</string>
  </dict>
</dict>
</plist>`;
    fs.writeFileSync(path.join(extDir, 'Info.plist'), infoPlist);

    // Write entitlements for the extension (App Group)
    const entitlements = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.application-groups</key>
  <array>
    <string>${APP_GROUP}</string>
  </array>
</dict>
</plist>`;
    fs.writeFileSync(
      path.join(extDir, `${EXTENSION_NAME}.entitlements`),
      entitlements,
    );

    // Add files to Xcode project
    const allSwiftFiles = [...widgetFiles, ...srcFiles];

    for (const file of allSwiftFiles) {
      const fileRefUuid = proj.generateUuid();
      const buildFileUuid = proj.generateUuid();

      proj.addToPbxFileReferenceSection({
        uuid: fileRefUuid,
        isa: 'PBXFileReference',
        lastKnownFileType: 'sourcecode.swift',
        name: file,
        path: `${EXTENSION_NAME}/${file}`,
        sourceTree: '"<group>"',
      });

      proj.addToPbxBuildFileSection({
        uuid: buildFileUuid,
        isa: 'PBXBuildFile',
        fileRef: fileRefUuid,
      });
    }

    // Add native target
    const target = proj.addTarget(
      EXTENSION_NAME,
      'app_extension',
      EXTENSION_NAME,
      WIDGET_BUNDLE_ID,
    );

    // Set build settings for the extension target
    if (target && target.buildConfigurationList) {
      const configs =
        proj.pbxXCConfigurationList()[target.buildConfigurationList];
      if (configs && configs.buildConfigurations) {
        for (const configRef of configs.buildConfigurations) {
          const buildConfig =
            proj.pbxXCBuildConfigurationSection()[configRef.value];
          if (buildConfig && buildConfig.buildSettings) {
            buildConfig.buildSettings.SWIFT_VERSION = '5.0';
            buildConfig.buildSettings.IPHONEOS_DEPLOYMENT_TARGET =
              DEPLOYMENT_TARGET;
            buildConfig.buildSettings.CODE_SIGN_ENTITLEMENTS = `${EXTENSION_NAME}/${EXTENSION_NAME}.entitlements`;
            buildConfig.buildSettings.PRODUCT_BUNDLE_IDENTIFIER =
              WIDGET_BUNDLE_ID;
            buildConfig.buildSettings.TARGETED_DEVICE_FAMILY = '"1,2"';
            buildConfig.buildSettings.CODE_SIGN_STYLE = 'Automatic';
            buildConfig.buildSettings.GENERATE_INFOPLIST_FILE = 'NO';
            buildConfig.buildSettings.INFOPLIST_FILE = `${EXTENSION_NAME}/Info.plist`;
          }
        }
      }
    }

    // Add the extension as a dependency of the main app target
    const appTarget = proj.getFirstTarget();
    if (appTarget && appTarget.firstTarget) {
      proj.addTargetDependency(appTarget.firstTarget.uuid, [target.uuid]);
    }

    // Embed the extension in the app
    const embedBuildFileUuid = proj.generateUuid();
    const productUuid = proj.generateUuid();

    proj.addToPbxBuildFileSection({
      uuid: embedBuildFileUuid,
      isa: 'PBXBuildFile',
      fileRef: productUuid,
      settings: { ATTRIBUTES: ['RemoveHeadersOnCopy'] },
    });

    proj.addBuildPhase(
      [embedBuildFileUuid],
      'PBXCopyFilesBuildPhase',
      'Embed Foundation Extensions',
      appTarget.firstTarget.uuid,
      'app_extension',
    );

    return mod;
  });
}

// ── Step 4: Copy native module to main app target ───────────────────────────

function withNativeModule(config) {
  return withXcodeProject(config, (mod) => {
    const iosDir = mod.modRequest.platformProjectRoot;
    const moduleSrc = path.join(
      __dirname,
      'src',
      'FranchiseLiveActivityModule.swift',
    );

    if (fs.existsSync(moduleSrc)) {
      const destDir = path.join(
        iosDir,
        mod.modRequest.projectName || 'franchise.v2',
      );
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      fs.copyFileSync(
        moduleSrc,
        path.join(destDir, 'FranchiseLiveActivityModule.swift'),
      );

      // Add to Xcode project main target
      const proj = mod.modResults;
      const appTarget = proj.getFirstTarget();
      if (appTarget && appTarget.firstTarget) {
        proj.addSourceFile(
          'FranchiseLiveActivityModule.swift',
          { target: appTarget.firstTarget.uuid },
          proj.getFirstProject().firstProject.mainGroup,
        );
      }
    }

    return mod;
  });
}

// ── Compose all plugins ─────────────────────────────────────────────────────

function withLiveActivities(config) {
  config = withLiveActivityPlist(config);
  config = withAppGroupEntitlement(config);
  config = withWidgetExtension(config);
  config = withNativeModule(config);
  return config;
}

module.exports = withLiveActivities;
