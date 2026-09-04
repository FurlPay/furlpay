import { Platform } from "react-native";

// ---------------------------------------------------------------------------
// Device-integrity SIGNALS for the self-custodial wallet.
//
// READ guardian/…/taptopay/DeviceIntegrity.kt BEFORE CHANGING ANYTHING HERE.
// That module states the rule this one obeys: "Trust is a server's conclusion,
// not a client's claim." It deliberately has no `Trusted` case carrying a local
// boolean, and neither does this. A verdict computed on the device and trusted
// by the device is worth nothing — anyone who can root a phone can patch the
// function that reports it was rooted.
//
// SO WHAT IS THIS FOR? Two things a local check genuinely does well:
//
//  1. It catches the ACCIDENTAL cases. A user running the wallet on an
//     emulator, or on a debug build handed to them by someone, is usually not
//     under attack — they are about to put a real seed phrase somewhere it
//     should never go, and nobody has told them.
//  2. It gives an honest warning a motivated attacker will bypass and an
//     ordinary user will heed. That asymmetry is the entire value, and
//     overstating it is how security theatre starts.
//
// WHAT IT IS NOT. It is not attestation. The real control is Play Integrity,
// whose token must be sent to a BACKEND and decoded against Google's servers —
// exactly as the Kotlin module describes. That is not wired here:
//
//    TODO(backend + native): no Play Integrity provider exists in this app and
//    no route accepts an integrity token. Wiring it needs (a) a native module
//    or expo-device/`react-native-google-play-integrity`, added and validated
//    on a real device, and (b) a server endpoint that decodes the token with a
//    server-generated single-use nonce. Until BOTH exist, `attestation` below
//    reports "not_configured" and the app must not pretend otherwise.
//
// EVERY SIGNAL COMES FROM THE OS, NOT FROM A GUESS. `Platform.constants` on
// Android is populated by the platform from the real system build; the
// classifier below reads those values rather than carrying a table of device
// names to match against. A probe that returns nothing is itself an answer and
// is reported as `unknown`, never as "clean".
// ---------------------------------------------------------------------------

/** What a local probe can honestly conclude. Note the absence of "trusted". */
export type IntegritySignal =
  /** The OS reported a value and it looks like an ordinary retail device. */
  | "ok"
  /** The OS reported a value that indicates an emulator or a non-retail build. */
  | "suspect"
  /** The probe returned nothing. NOT the same as "ok". */
  | "unknown";

export interface IntegrityReport {
  /** Running under a debugger / Metro rather than a release binary. */
  debugBuild: boolean;
  /** Emulator or a development/test system image. */
  emulator: IntegritySignal;
  /** Android build signed with test-keys — an unofficial or engineering ROM. */
  unofficialBuild: IntegritySignal;
  /**
   * Real attestation. Always "not_configured" today, and the honest word for
   * it — see the TODO above. `"not_configured"` must never be read as a pass.
   */
  attestation: "not_configured";
  /** Everything that fired, for display. Empty means nothing fired. */
  concerns: IntegrityConcern[];
}

export type IntegrityConcern = "debug_build" | "emulator" | "unofficial_build";

/**
 * The raw values a platform can supply. Passed in rather than read inside, so
 * the classifier is pure and directly testable — the OS read is the four lines
 * at the bottom of this file.
 */
export interface PlatformFacts {
  os: string;
  /** `__DEV__`, or a debuggable build flag. */
  dev: boolean;
  /** Android `Build.FINGERPRINT`. */
  fingerprint?: string | null;
  /** Android `Build.MODEL`. */
  model?: string | null;
  /** Android `Build.BRAND`. */
  brand?: string | null;
  /** Android `Build.MANUFACTURER`. */
  manufacturer?: string | null;
}

const has = (value: string | null | undefined, needle: string): boolean =>
  typeof value === "string" && value.toLowerCase().includes(needle);

/**
 * Emulator detection from the system build strings.
 *
 * These are the markers Android's own emulator images carry — `generic`,
 * `sdk_`, `goldfish`/`ranchu` (the two emulator kernels), and the
 * `Android SDK built for …` model string. They are read off the build the OS
 * reports, not matched against a list of handset names, so a new phone model
 * never has to be added here for the check to keep behaving.
 *
 * Returns `unknown` when the platform supplied nothing, which is the state on
 * iOS through this path and on any Android build that withholds the constants.
 * Reporting that as `ok` would turn a failed probe into a clean bill of health.
 */
export function classifyEmulator(facts: PlatformFacts): IntegritySignal {
  const { fingerprint, model, brand, manufacturer } = facts;
  if (!fingerprint && !model && !brand && !manufacturer) return "unknown";

  const suspect =
    has(fingerprint, "generic") ||
    has(fingerprint, "unknown") ||
    has(fingerprint, "emulator") ||
    has(fingerprint, "sdk_gphone") ||
    has(model, "sdk") ||
    has(model, "emulator") ||
    has(model, "android sdk built for") ||
    has(brand, "generic") ||
    has(manufacturer, "genymotion") ||
    has(manufacturer, "unknown");

  return suspect ? "suspect" : "ok";
}

/**
 * A build signed with `test-keys` was not signed by the device manufacturer's
 * release key — it is an engineering build or a custom ROM. That is the single
 * most reliable thing `Build.FINGERPRINT` says about whether the system is the
 * one the vendor shipped, and it correlates strongly with a rooted device
 * without claiming to detect root, which a local check cannot do reliably.
 */
export function classifyUnofficialBuild(facts: PlatformFacts): IntegritySignal {
  if (!facts.fingerprint) return "unknown";
  return has(facts.fingerprint, "test-keys") ? "suspect" : "ok";
}

/** Build the report from a set of facts. Pure. */
export function assessIntegrity(facts: PlatformFacts): IntegrityReport {
  const emulator = classifyEmulator(facts);
  const unofficialBuild = classifyUnofficialBuild(facts);

  const concerns: IntegrityConcern[] = [];
  // A debug build is reported on its own rather than folded into "emulator":
  // a release build on an emulator and a debug build on a real phone are
  // different situations with different advice.
  if (facts.dev) concerns.push("debug_build");
  if (emulator === "suspect") concerns.push("emulator");
  if (unofficialBuild === "suspect") concerns.push("unofficial_build");

  return { debugBuild: facts.dev, emulator, unofficialBuild, attestation: "not_configured", concerns };
}

/** What to tell the user, in their terms. */
export function concernText(concern: IntegrityConcern): { title: string; detail: string } {
  switch (concern) {
    case "debug_build":
      return {
        title: "This is a development build",
        detail:
          "Debug builds can be inspected while they run. Don't put a seed phrase you use for real money into one.",
      };
    case "emulator":
      return {
        title: "This looks like an emulator",
        detail:
          "Emulator storage is readable from the host machine. A wallet created here should be treated as disposable.",
      };
    case "unofficial_build":
      return {
        title: "This device runs an unofficial system build",
        detail:
          "The system was not signed by the manufacturer, which usually means it is rooted or running a custom ROM. Other apps may be able to read this one's storage.",
      };
  }
}

/**
 * One line summarising the report, or null when nothing fired.
 *
 * Deliberately does NOT say "your device is secure" in the clean case. This
 * check cannot establish that, and a green tick claiming it would be the exact
 * overstatement the module header warns against — so the clean case says
 * nothing at all.
 */
export function integritySummary(report: IntegrityReport): string | null {
  if (report.concerns.length === 0) return null;
  if (report.concerns.length === 1) return concernText(report.concerns[0]).title;
  return `${report.concerns.length} things about this device could put wallet keys at risk`;
}

// ── the OS read ────────────────────────────────────────────────────────────

/**
 * Android exposes `Build` fields through `Platform.constants`. Typed loosely
 * and guarded: the shape has changed across React Native versions, and a
 * missing field must degrade to `unknown` rather than throw on a screen the
 * user opened to look at their wallet.
 */
function readPlatformFacts(): PlatformFacts {
  const facts: PlatformFacts = { os: Platform.OS, dev: typeof __DEV__ !== "undefined" && __DEV__ };
  try {
    const c = (Platform as unknown as { constants?: Record<string, unknown> }).constants;
    if (c) {
      const str = (key: string): string | null =>
        typeof c[key] === "string" ? (c[key] as string) : null;
      facts.fingerprint = str("Fingerprint");
      facts.model = str("Model");
      facts.brand = str("Brand");
      facts.manufacturer = str("Manufacturer");
    }
  } catch {
    // Leave the fields undefined — assessIntegrity reports `unknown`, which is
    // the truthful answer for a probe that did not run.
  }
  return facts;
}

/** The report for the device the app is running on. */
export function deviceIntegrity(): IntegrityReport {
  return assessIntegrity(readPlatformFacts());
}
