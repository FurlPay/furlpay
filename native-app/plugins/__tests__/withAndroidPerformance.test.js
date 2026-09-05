const fs = require("fs");
const path = require("path");
const os = require("os");

// ---------------------------------------------------------------------------
// The performance plugin edits a generated file with a regex, which is exactly
// the kind of code that silently stops matching after a template change and is
// never noticed — the build still succeeds, it just quietly ships four ABIs and
// no baseline profile again.
//
// These tests run the plugin's transforms against the REAL app/build.gradle
// from this project (when it has been prebuilt) and against a pinned fixture
// otherwise, so a template change breaks a test rather than a release.
// ---------------------------------------------------------------------------

const PROJECT = path.join(__dirname, "..", "..");

/** The `android { … }` opener the plugin anchors on, as RN generates it. */
const FIXTURE_GRADLE = `apply plugin: "com.android.application"
apply plugin: "org.jetbrains.kotlin.android"
apply plugin: "com.facebook.react"

react {
    autolinkLibrariesWithApp()
}

def enableProguardInReleaseBuilds = (findProperty('android.enableProguardInReleaseBuilds') ?: false).toBoolean()

android {
    ndkVersion rootProject.ext.ndkVersion
    compileSdk rootProject.ext.compileSdkVersion

    namespace 'com.furlpay.app'
    defaultConfig {
        applicationId 'com.furlpay.app'
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
    }
}
`;

/** Load the real app/build.gradle if the project has been prebuilt. */
function realGradle() {
  const p = path.join(PROJECT, "android", "app", "build.gradle");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

// The plugin destructures its imports at module load
// (`const { withAppBuildGradle } = require("expo/config-plugins")`), so it holds
// direct references. Patching the module object afterwards would not reach it —
// the mock has to be installed BEFORE the plugin is required, which is what
// jest.mock does.
let capturedGradleAction = null;
let capturedDangerousAction = null;

jest.mock("expo/config-plugins", () => ({
  withAppBuildGradle: (config, action) => {
    capturedGradleAction = action;
    return config;
  },
  withDangerousMod: (config, [, action]) => {
    capturedDangerousAction = action;
    return config;
  },
}));

const plugin = require("../withAndroidPerformance.js");

/** Run the plugin, then drive its captured gradle mod over `contents`. */
function applyGradleMod(contents, language = "groovy") {
  capturedGradleAction = null;
  plugin({ name: "FurlPay", slug: "furlpay" });
  if (!capturedGradleAction) throw new Error("plugin never registered a gradle mod");
  const result = capturedGradleAction({ modResults: { language, contents } });
  return result.modResults.contents;
}

/** Run the plugin, then drive its captured baseline-profile copy. */
async function applyBaselineMod(projectRoot, platformProjectRoot) {
  capturedDangerousAction = null;
  plugin({ name: "FurlPay", slug: "furlpay" });
  if (!capturedDangerousAction) throw new Error("plugin never registered a dangerous mod");
  return capturedDangerousAction({ modRequest: { projectRoot, platformProjectRoot } });
}

describe("withAndroidPerformance — ABI filter", () => {
  it("injects a release-only abiFilters block", () => {
    const out = applyGradleMod(FIXTURE_GRADLE);
    expect(out).toContain("abiFilters");
    expect(out).toContain('"arm64-v8a"');
    expect(out).toContain('"armeabi-v7a"');
  });

  it("does NOT ship the x86 ABIs in release", () => {
    // The whole point: x86/x86_64 exist for emulators and cost ~40 MB in the
    // universal APK. If these ever reappear, the size regression is silent.
    const out = applyGradleMod(FIXTURE_GRADLE);
    const injected = out.slice(out.indexOf("--- injected"), out.indexOf("--- end injected"));
    expect(injected).not.toContain("x86");
  });

  it("scopes the filter to the release build type only", () => {
    // Filtering debug too would break every x86 emulator, which is what most
    // people develop on.
    const out = applyGradleMod(FIXTURE_GRADLE);
    const injected = out.slice(out.indexOf("--- injected"), out.indexOf("--- end injected"));
    expect(injected).toContain("release {");
    expect(injected).not.toContain("debug {");
  });

  it("is idempotent — a second prebuild does not double-inject", () => {
    const once = applyGradleMod(FIXTURE_GRADLE);
    const twice = applyGradleMod(once);
    expect(twice).toBe(once);
    expect(once.match(/abiFilters/g)).toHaveLength(1);
  });

  it("anchors on `android {`, not on `androidResources {` or a comment", () => {
    const tricky = FIXTURE_GRADLE.replace(
      "android {",
      "// configure android { } below\nandroidResources {\n    ignoreAssetsPattern '!.svn'\n}\n\nandroid {"
    );
    const out = applyGradleMod(tricky);
    const idx = out.indexOf("--- injected");
    // The injection must land after the real `android {` opener, not inside
    // androidResources.
    const before = out.slice(0, idx);
    expect(before).toMatch(/^android\s*\{\s*$/m);
    expect(out.indexOf("androidResources {")).toBeLessThan(idx);
  });

  it("throws loudly if the anchor is gone instead of silently doing nothing", () => {
    // A silent no-op here means shipping four ABIs forever with a green build.
    expect(() => applyGradleMod("// no android block at all\n")).toThrow(
      /could not find the `android \{` block/
    );
  });

  it("throws if build.gradle is Kotlin DSL, which this injection does not handle", () => {
    expect(() => applyGradleMod(FIXTURE_GRADLE, "kt")).toThrow(/not Groovy/);
  });

  const real = realGradle();
  (real ? it : it.skip)("still matches the REAL generated app/build.gradle", () => {
    const out = applyGradleMod(real);
    expect(out).toContain("abiFilters");
  });
});

describe("withAndroidPerformance — baseline profile source", () => {
  const profilePath = path.join(PROJECT, "android-profile", "baseline-prof.txt");

  it("the profile the plugin copies actually exists", () => {
    expect(fs.existsSync(profilePath)).toBe(true);
  });

  it("is substantially larger than the 2,366-byte R8 stub it replaces", () => {
    const size = fs.statSync(profilePath).size;
    expect(size).toBeGreaterThan(2366);
  });

  it("covers the startup path this app actually has", () => {
    const txt = fs.readFileSync(profilePath, "utf8");
    // Each of these is on the cold-start path for THIS app specifically.
    expect(txt).toContain("com/furlpay/app/MainApplication");
    expect(txt).toContain("com/facebook/react/runtime");
    expect(txt).toContain("com/facebook/hermes");
    expect(txt).toContain("expo/modules/sqlite"); // theme + locale read at boot
    expect(txt).toContain("expo/modules/securestore"); // session token at boot
  });

  it("contains only comments and profile rules — no stray prose", () => {
    const bad = fs
      .readFileSync(profilePath, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .filter((l) => !/^(H?S?P?L|L)[\w/$;>()\[\]*<-]+$/.test(l));
    expect(bad).toEqual([]);
  });
});

describe("withAndroidPerformance — baseline profile copy", () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "furlpay-plugin-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("copies the profile to the exact path AGP reads", () => {
    // AGP only picks up app/src/main/baseline-prof.txt. Anywhere else and the
    // profile is silently absent from the APK.
    const projectRoot = path.join(tmp, "project");
    const platformRoot = path.join(tmp, "project", "android");
    fs.mkdirSync(path.join(projectRoot, "android-profile"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, "android-profile", "baseline-prof.txt"),
      "HSPLcom/furlpay/app/MainApplication;->onCreate()V\n"
    );

    return applyBaselineMod(projectRoot, platformRoot).then(() => {
      const dest = path.join(platformRoot, "app", "src", "main", "baseline-prof.txt");
      expect(fs.existsSync(dest)).toBe(true);
      expect(fs.readFileSync(dest, "utf8")).toContain("MainApplication");
    });
  });

  it("throws when the profile is missing rather than building without one", async () => {
    // Silence here is the original bug: a build that succeeds with a 2 KB stub
    // and nobody notices for a release.
    const projectRoot = path.join(tmp, "empty");
    fs.mkdirSync(projectRoot, { recursive: true });
    await expect(
      applyBaselineMod(projectRoot, path.join(projectRoot, "android"))
    ).rejects.toThrow(/baseline profile missing/);
  });

  it("creates the destination directory when prebuild has not made it yet", async () => {
    const projectRoot = path.join(tmp, "p2");
    const platformRoot = path.join(tmp, "p2", "android");
    fs.mkdirSync(path.join(projectRoot, "android-profile"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "android-profile", "baseline-prof.txt"), "Lcom/x;\n");

    await applyBaselineMod(projectRoot, platformRoot);
    expect(fs.existsSync(path.join(platformRoot, "app", "src", "main"))).toBe(true);
  });
});
