import Constants from "expo-constants";
import { Platform } from "react-native";
import {
  setThreatListeners,
  talsecStart,
  type TalsecConfig,
  type ThreatEventActions,
} from "freerasp-react-native";

// ---------------------------------------------------------------------------
// Runtime tamper detection (freeRASP), feeding lib/security/riskEngine.ts.
//
// THE BUG THIS REPLACES. The config was hardcoded: packageName
// "com.furlpay.mobile" (the app is com.furlpay.app), certificateHashes
// ["TODO_CERT_HASH"], appTeamId "YOUR_TEAM_ID", isProd: true — and a start
// failure was swallowed with console.warn. freeRASP checks the running app's
// identity against that config, so a genuine install either reported
// appIntegrity (compromised → riskEngine BLOCKS every money move for every user)
// or the SDK rejected the config and the app ran with no protection while
// reporting nothing.
//
// THE RULE NOW.
//   - Config comes from the build (app.config.js → extra.freerasp): the
//     resolved package / bundle id and the real signing identity. A release
//     build without it does not get built.
//   - A threat callback that indicates tampering → compromised → BLOCK.
//     Unchanged: on a rooted or hooked device the app's own prompts can be
//     bypassed, so asking harder achieves nothing.
//   - Detection NOT positively running — not started yet, config missing or
//     malformed, or talsecStart threw → integrity UNKNOWN → riskEngine asks for
//     step-up (proof of presence) on money moves. Never a silent allow, never a
//     blanket block of a device we simply could not assess.
// ---------------------------------------------------------------------------

export type TamperStatus = "pending" | "running" | "unavailable";

let compromised = false;
let status: TamperStatus = "pending";
let unavailableReason: string | null = null;
const threatsSeen = new Set<string>();

/** A tampering threat has been reported this session. */
export function isDeviceCompromised(): boolean {
  return compromised;
}

/**
 * True whenever tamper detection is not positively running. riskEngine turns
 * this into STEP_UP for money-moving actions (rule `integrity_unknown`).
 */
export function isIntegrityUnknown(): boolean {
  return status !== "running";
}

/** Diagnostics for the security screen / support. No secrets in here. */
export function tamperState(): { status: TamperStatus; reason: string | null; threats: string[] } {
  return { status, reason: unavailableReason, threats: [...threatsSeen] };
}

/** Shape app.config.js writes into `extra.freerasp`. */
export interface FreeraspBuildConfig {
  packageName?: unknown;
  appBundleId?: unknown;
  certificateHashes?: unknown;
  appTeamId?: unknown;
  isProd?: unknown;
}

const CERT_HASH = /^[A-Za-z0-9+/]{43}=$/; // base64 SHA-256 (32 bytes)
const TEAM_ID = /^[A-Z0-9]{10}$/;
const APP_ID = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/;
const WATCHER_MAIL = "security@furlpay.com";

export type BuiltTalsecConfig = { ok: true; config: TalsecConfig } | { ok: false; reason: string };

/**
 * Validate the build-provided config for THIS platform. Pure, so the rules are
 * unit-testable. Anything missing or malformed is a refusal — the caller marks
 * integrity unknown instead of starting freeRASP against a wrong identity.
 */
export function buildTalsecConfig(raw: FreeraspBuildConfig | null | undefined, os: string): BuiltTalsecConfig {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "no freeRASP config in this build" };
  const isProd = raw.isProd === true;

  if (os === "android") {
    const packageName = typeof raw.packageName === "string" ? raw.packageName : "";
    if (!APP_ID.test(packageName)) return { ok: false, reason: "android package name missing or malformed" };
    const hashes = Array.isArray(raw.certificateHashes) ? raw.certificateHashes : [];
    if (hashes.length === 0) return { ok: false, reason: "no signing certificate hash configured" };
    if (!hashes.every((h) => typeof h === "string" && CERT_HASH.test(h))) {
      return { ok: false, reason: "a signing certificate hash is not a base64 SHA-256" };
    }
    return {
      ok: true,
      config: {
        androidConfig: { packageName, certificateHashes: hashes as string[], supportedAlternativeStores: [] },
        watcherMail: WATCHER_MAIL,
        isProd,
      },
    };
  }

  if (os === "ios") {
    const appBundleId = typeof raw.appBundleId === "string" ? raw.appBundleId : "";
    if (!APP_ID.test(appBundleId)) return { ok: false, reason: "iOS bundle id missing or malformed" };
    const appTeamId = typeof raw.appTeamId === "string" ? raw.appTeamId : "";
    if (!TEAM_ID.test(appTeamId)) return { ok: false, reason: "Apple Team ID missing or malformed" };
    return { ok: true, config: { iosConfig: { appBundleId, appTeamId }, watcherMail: WATCHER_MAIL, isProd } };
  }

  return { ok: false, reason: `unsupported platform ${os}` };
}

/** Threats that mean the device or the app binary cannot be trusted. */
const TAMPER_THREATS = [
  "privilegedAccess",
  "debug",
  "simulator",
  "appIntegrity",
  "hooks",
  "deviceBinding",
  "obfuscationIssues",
  "devMode",
] as const;

/** Reported but not, on their own, evidence of tampering. */
const ADVISORY_THREATS = ["unofficialStore", "secureHardwareNotAvailable", "passcode", "systemVPN"] as const;

export function threatActions(): ThreatEventActions {
  const actions: ThreatEventActions = {};
  for (const t of TAMPER_THREATS) {
    actions[t] = () => {
      threatsSeen.add(t);
      compromised = true;
    };
  }
  for (const t of ADVISORY_THREATS) {
    actions[t] = () => {
      threatsSeen.add(t);
    };
  }
  return actions;
}

function markUnavailable(reason: string): void {
  status = "unavailable";
  unavailableReason = reason;
  // Loud but secret-free: the reason names what is missing, never a value.
  console.warn(`[tamper] detection unavailable: ${reason} — money moves will require step-up`);
}

export async function startTamperDetection(): Promise<void> {
  if (status === "running") return;
  const raw = (Constants.expoConfig?.extra as { freerasp?: FreeraspBuildConfig } | undefined)?.freerasp;
  const built = buildTalsecConfig(raw, Platform.OS);
  if (!built.ok) {
    markUnavailable(built.reason);
    return;
  }
  try {
    await setThreatListeners(threatActions());
    await talsecStart(built.config);
    status = "running";
    unavailableReason = null;
  } catch (e) {
    markUnavailable(`freeRASP failed to start (${e instanceof Error ? e.name : "error"})`);
  }
}

/** Test seam. */
export function __resetTamperStateForTests(): void {
  compromised = false;
  status = "pending";
  unavailableReason = null;
  threatsSeen.clear();
}
