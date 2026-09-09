const withWindowsPathFix = require("../withWindowsPathFix");

// ---------------------------------------------------------------------------
// The plugin injects a CMake argument into a GENERATED file with a regex, which
// is the same failure shape withAndroidPerformance guards against: a template
// change makes the anchor stop matching, the injection silently does nothing,
// and the next Windows release build dies in ninja after ninety minutes of
// compiling.
//
// The regression this prevents is expensive to rediscover — the error surfaces
// as `Filename longer than 260 characters` from a C++ object path, which reads
// like an environment problem rather than a missing build flag.
// ---------------------------------------------------------------------------

/** The `android { … }` opener, as React Native's template generates it. */
const FIXTURE_GRADLE = `apply plugin: "com.android.application"
apply plugin: "org.jetbrains.kotlin.android"

react {
    autolinkLibrariesWithApp()
}

android {
    ndkVersion rootProject.ext.ndkVersion
    compileSdk rootProject.ext.compileSdkVersion

    defaultConfig {
        applicationId 'com.furlpay.app'
        minSdkVersion rootProject.ext.minSdkVersion
    }
}
`;

/** Run the plugin the way expo/config-plugins does, capturing the result. */
function apply(contents, language = "groovy") {
  let captured;
  const fakeWithAppBuildGradle = (config, action) => {
    captured = action({ ...config, modResults: { language, contents } });
    return captured;
  };

  jest.resetModules();
  jest.doMock("expo/config-plugins", () => ({ withAppBuildGradle: fakeWithAppBuildGradle }));
  const plugin = require("../withWindowsPathFix");
  plugin({ name: "FurlPay" });
  jest.dontMock("expo/config-plugins");

  return captured.modResults.contents;
}

describe("withWindowsPathFix", () => {
  it("injects the CMake object-path limit into the android block", () => {
    const out = apply(FIXTURE_GRADLE);
    expect(out).toContain("-DCMAKE_OBJECT_PATH_MAX=250");
    expect(out).toContain("externalNativeBuild");
  });

  it("places the injection INSIDE the android block, not before it", () => {
    const out = apply(FIXTURE_GRADLE);
    const androidAt = out.indexOf("android {");
    const argAt = out.indexOf("-DCMAKE_OBJECT_PATH_MAX");
    // Outside the block the argument is a Gradle syntax error rather than a
    // no-op, so position is correctness, not tidiness.
    expect(androidAt).toBeGreaterThanOrEqual(0);
    expect(argAt).toBeGreaterThan(androidAt);
  });

  // prebuild runs plugins on every invocation. A second copy of the block is a
  // Gradle syntax error, so re-entrancy is a hard requirement.
  it("is idempotent across repeated prebuilds", () => {
    const once = apply(FIXTURE_GRADLE);
    const twice = apply(once);
    expect(twice).toBe(once);
    // Counted on the ARGUMENT, not the bare name: the explanatory comment above
    // the block also mentions CMAKE_OBJECT_PATH_MAX, so matching the name alone
    // finds two occurrences in a correctly-injected file.
    expect(twice.match(/-DCMAKE_OBJECT_PATH_MAX=250/g)).toHaveLength(1);
  });

  // A silent no-op here costs a ~90-minute build before ninja reports a path
  // error that looks like an environment problem.
  it("throws when the android block anchor is gone", () => {
    expect(() => apply("// a build.gradle with no android block\n")).toThrow(/android \{/);
  });

  it("throws when the template is not Groovy", () => {
    expect(() => apply(FIXTURE_GRADLE, "kotlin")).toThrow(/not Groovy/);
  });

  it("leaves the rest of the file intact", () => {
    const out = apply(FIXTURE_GRADLE);
    expect(out).toContain("applicationId 'com.furlpay.app'");
    expect(out).toContain("autolinkLibrariesWithApp()");
  });
});
