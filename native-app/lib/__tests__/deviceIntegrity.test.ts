import {
  assessIntegrity,
  classifyEmulator,
  classifyUnofficialBuild,
  concernText,
  integritySummary,
  type PlatformFacts,
} from "../security/deviceIntegrity";

// ---------------------------------------------------------------------------
// Device-integrity signals.
//
// The property this file defends hardest is the one that is easiest to lose in
// a refactor: A FAILED PROBE IS NOT A PASS. When the platform supplies nothing,
// the answer is `unknown`, and nothing anywhere may turn that into "fine".
// Every real-world variant of this bug looks the same — someone writes
// `=== "suspect"` and treats everything else as clean — so the distinction is
// asserted directly rather than only through the report.
//
// The other property is honesty about the clean case: there is deliberately no
// "your device is secure" output, because this check reads a handful of build
// strings that any rooted device can rewrite and therefore cannot establish it.
// ---------------------------------------------------------------------------

const retail: PlatformFacts = {
  os: "android",
  dev: false,
  fingerprint: "Redmi/sweet/sweet:16/UP1A.231005.007/V816.0.5.0.UKFINXM:user/release-keys",
  model: "M2101K6G",
  brand: "Redmi",
  manufacturer: "Xiaomi",
};

const emulator: PlatformFacts = {
  os: "android",
  dev: false,
  fingerprint: "google/sdk_gphone64_x86_64/emu64x:14/UE1A.230829.036/11228894:user/release-keys",
  model: "sdk_gphone64_x86_64",
  brand: "google",
  manufacturer: "Google",
};

const customRom: PlatformFacts = {
  os: "android",
  dev: false,
  fingerprint: "google/raven/raven:14/UQ1A.240105.004/eng.build:userdebug/test-keys",
  model: "Pixel 6 Pro",
  brand: "google",
  manufacturer: "Google",
};

describe("a failed probe is never a pass", () => {
  const blind: PlatformFacts = { os: "ios", dev: false };

  it("reports unknown, not ok, when the platform supplied nothing", () => {
    expect(classifyEmulator(blind)).toBe("unknown");
    expect(classifyUnofficialBuild(blind)).toBe("unknown");
  });

  it("raises no concern from an unknown signal", () => {
    // Unknown must not become a warning either — crying wolf on every iOS
    // device would train users past the banner before it ever fires for cause.
    const report = assessIntegrity(blind);
    expect(report.concerns).toEqual([]);
    expect(integritySummary(report)).toBeNull();
  });

  it("keeps unknown distinct from ok in the report itself", () => {
    expect(assessIntegrity(blind).emulator).toBe("unknown");
    expect(assessIntegrity(retail).emulator).toBe("ok");
  });
});

describe("emulator detection", () => {
  it("flags an emulator image", () => {
    expect(classifyEmulator(emulator)).toBe("suspect");
  });

  it("does not flag an ordinary retail handset", () => {
    expect(classifyEmulator(retail)).toBe("ok");
  });

  it("reads the build strings rather than matching a device-name list", () => {
    // A phone this code has never heard of must pass. If a new model needs to
    // be added here for the check to behave, the check is a maintenance list
    // and will be wrong within a year.
    const unknownPhone: PlatformFacts = {
      os: "android",
      dev: false,
      fingerprint: "Nothing/Pacman/Pacman:14/UKQ1.230924.001/2401121022:user/release-keys",
      model: "A065",
      brand: "Nothing",
      manufacturer: "Nothing",
    };
    expect(classifyEmulator(unknownPhone)).toBe("ok");
    expect(classifyUnofficialBuild(unknownPhone)).toBe("ok");
  });
});

describe("unofficial build detection", () => {
  it("flags test-keys", () => {
    expect(classifyUnofficialBuild(customRom)).toBe("suspect");
  });

  it("does not flag a release-keys build", () => {
    expect(classifyUnofficialBuild(retail)).toBe("ok");
    expect(classifyUnofficialBuild(emulator)).toBe("ok");
  });
});

describe("the report", () => {
  it("says nothing at all about a clean retail device", () => {
    // No green tick. This check cannot establish that a device is safe, and a
    // reassurance it has no basis for is worse than silence — the user would
    // then read its absence as meaningful too.
    const report = assessIntegrity(retail);
    expect(report.concerns).toEqual([]);
    expect(integritySummary(report)).toBeNull();
  });

  it("never claims attestation happened", () => {
    // Play Integrity is not wired. The honest word for that is not "passed".
    for (const facts of [retail, emulator, customRom]) {
      expect(assessIntegrity(facts).attestation).toBe("not_configured");
    }
  });

  it("separates a debug build from an emulator", () => {
    // A release build on an emulator and a debug build on a real phone are
    // different situations with different advice.
    const debugOnRealPhone = assessIntegrity({ ...retail, dev: true });
    expect(debugOnRealPhone.concerns).toEqual(["debug_build"]);

    const releaseOnEmulator = assessIntegrity(emulator);
    expect(releaseOnEmulator.concerns).toEqual(["emulator"]);
  });

  it("accumulates every concern that fires", () => {
    const worst = assessIntegrity({ ...customRom, dev: true });
    expect(worst.concerns).toEqual(["debug_build", "unofficial_build"]);
    expect(integritySummary(worst)).toMatch(/2 things/);
  });

  it("gives every concern user-facing copy", () => {
    for (const concern of ["debug_build", "emulator", "unofficial_build"] as const) {
      const copy = concernText(concern);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.detail.length).toBeGreaterThan(0);
    }
  });
});
