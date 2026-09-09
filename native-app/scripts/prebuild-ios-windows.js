#!/usr/bin/env node
/**
 * Generate the iOS native project on Windows.
 *
 * WHY THIS EXISTS. `expo prebuild --platform ios` refuses to run on Windows —
 * not because the generation cannot work, but because of one unconditional
 * guard in @expo/cli:
 *
 *   // node_modules/@expo/cli/build/src/prebuild/resolveOptions.js
 *   function ensureValidPlatforms(platforms) {
 *     if (process.platform === 'win32' && platforms.includes('ios')) {
 *       log.warn('Skipping generating the iOS native project files...');
 *       return platforms.filter((p) => p !== 'ios');
 *     }
 *     return platforms;
 *   }
 *
 * There is no flag to bypass it. The guard exists because the LAST step of an
 * iOS prebuild — `pod install` — needs CocoaPods and the macOS toolchain. But
 * the steps before it are pure file generation and work anywhere:
 *
 *   1. resolve the prebuild template from npm
 *   2. copy ios/ out of it
 *   3. rename the template app to this app's name
 *   4. apply every config plugin (Info.plist, entitlements, project.pbxproj)
 *
 * WHAT THIS PRODUCES AND WHAT IT DOES NOT. Running this yields exactly what a
 * macOS `expo prebuild --platform ios --no-install` yields: a complete,
 * correct `ios/` directory with the Xcode project, Info.plist, entitlements
 * and Podfile.
 *
 * It does NOT produce `Pods/`, `Podfile.lock` or `FurlPay.xcworkspace` —
 * those are created by `pod install`, which is a DEPENDENCY-INSTALL step (the
 * iOS equivalent of `npm install`) and genuinely requires macOS. Anyone
 * cloning this on a Mac runs `pod install` and opens the workspace.
 *
 * THIS IS NOT A HACK AROUND CORRECTNESS. It calls Expo's own exported
 * functions, in Expo's own order, with Expo's own config. Nothing about the
 * generated project is hand-written or approximated. The only thing skipped is
 * a guard about which machine is running it.
 */

const path = require("path");
const fs = require("fs");

async function main() {
  const projectRoot = path.resolve(__dirname, "..");

  // Expo's own modules, used exactly as the CLI uses them.
  const { updateFromTemplateAsync } = require("@expo/cli/build/src/prebuild/updateFromTemplate");
  const { configureProjectAsync } = require("@expo/cli/build/src/prebuild/configureProjectAsync");
  const { ensureConfigAsync } = require("@expo/cli/build/src/prebuild/ensureConfigAsync");

  const platforms = ["ios"];

  console.log("• Resolving config for iOS…");
  const { exp } = await ensureConfigAsync(projectRoot, { platforms });

  console.log(`• App: ${exp.name} (${exp.ios && exp.ios.bundleIdentifier})`);

  console.log("• Copying the prebuild template and applying autolinking…");
  const { hasNewProjectFiles, needsPodInstall } = await updateFromTemplateAsync(projectRoot, {
    exp,
    pkg: require(path.join(projectRoot, "package.json")),
    platforms,
    // The template comes from npm exactly as the CLI resolves it.
    templateDirectory: undefined,
    template: undefined,
skipDependencyUpdate: undefined,
  });

  console.log(`  new project files: ${hasNewProjectFiles} | pods needed: ${needsPodInstall}`);

  console.log("• Applying config plugins (Info.plist, entitlements, pbxproj)…");
  await configureProjectAsync(projectRoot, { platforms, exp });

  // Prove the important artefacts exist rather than assuming the call worked.
  const iosDir = path.join(projectRoot, "ios");
  if (!fs.existsSync(iosDir)) {
    throw new Error("ios/ was not created — prebuild did not run.");
  }

  const expected = ["Podfile", ".xcodeproj"];
  const entries = fs.readdirSync(iosDir);
  const missing = expected.filter(
    (e) => !entries.some((f) => (e.startsWith(".") ? f.endsWith(e) : f === e)),
  );

  console.log("\nGenerated ios/:");
  for (const e of entries) console.log("   ", e);

  if (missing.length) {
    throw new Error(`ios/ is missing expected entries: ${missing.join(", ")}`);
  }

  console.log("\n✔ iOS project generated.");
  console.log("  `pod install` (macOS + CocoaPods) is still required to create");
  console.log("  Pods/, Podfile.lock and the .xcworkspace.");
}

main().catch((e) => {
  console.error("\n✖ iOS prebuild failed:", e.message);
  if (process.env.FURLPAY_DEBUG) console.error(e.stack);
  process.exit(1);
});
