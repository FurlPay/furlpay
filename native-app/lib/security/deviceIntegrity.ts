import { Platform } from "react-native";
import { requestIntegrityToken } from "react-native-google-play-integrity";
import * as SecureStore from "expo-secure-store";
import { DEVICE_ONLY } from "../storageOptions";
import * as Crypto from "expo-crypto";

let AppAttest: any;
if (Platform.OS === "ios") {
  AppAttest = require("react-native-app-attest").default;
}

// ---------------------------------------------------------------------------
// Device-integrity SIGNALS for the self-custodial wallet.
// ---------------------------------------------------------------------------

export type IntegritySignal = "ok" | "suspect" | "unknown";

export interface IntegrityReport {
  debugBuild: boolean;
  emulator: IntegritySignal;
  unofficialBuild: IntegritySignal;
  attestation: "not_configured" | "supported" | "unsupported" | "error";
  concerns: IntegrityConcern[];
}

export type IntegrityConcern = "debug_build" | "emulator" | "unofficial_build";

export interface PlatformFacts {
  os: string;
  dev: boolean;
  fingerprint?: string | null;
  model?: string | null;
  brand?: string | null;
  manufacturer?: string | null;
}

const has = (value: string | null | undefined, needle: string): boolean =>
  typeof value === "string" && value.toLowerCase().includes(needle);

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

export function classifyUnofficialBuild(facts: PlatformFacts): IntegritySignal {
  if (!facts.fingerprint) return "unknown";
  return has(facts.fingerprint, "test-keys") ? "suspect" : "ok";
}

export function assessIntegrity(facts: PlatformFacts): IntegrityReport {
  const emulator = classifyEmulator(facts);
  const unofficialBuild = classifyUnofficialBuild(facts);

  const concerns: IntegrityConcern[] = [];
  if (facts.dev) concerns.push("debug_build");
  if (emulator === "suspect") concerns.push("emulator");
  if (unofficialBuild === "suspect") concerns.push("unofficial_build");

  // `not_configured`, not `supported`.
  //
  // assessIntegrity reads LOCAL signals only — build fingerprint, model, brand.
  // It never calls Play Integrity or App Attest, and even `attestDevice()` below
  // only obtains a token; nothing verifies one server-side yet (see its own
  // comment: "In a real flow, we'd send attestation to backend to verify").
  //
  // Reporting "supported" here claims an attestation that did not happen. A
  // caller reading it would conclude the device had been cryptographically
  // vouched for by Google or Apple when the only thing checked was whether the
  // build fingerprint contains the word "generic" — a string a tampered ROM can
  // simply not contain. That is a false security assurance, which is worse than
  // none, because its absence would also be read as meaningful.
  return { debugBuild: facts.dev, emulator, unofficialBuild, attestation: "not_configured", concerns };
}

export function concernText(concern: IntegrityConcern): { title: string; detail: string } {
  switch (concern) {
    case "debug_build":
      return {
        title: "This is a development build",
        detail: "Debug builds can be inspected while they run.",
      };
    case "emulator":
      return {
        title: "This looks like an emulator",
        detail: "Emulator storage is readable from the host machine.",
      };
    case "unofficial_build":
      return {
        title: "This device runs an unofficial system build",
        detail: "The system was not signed by the manufacturer.",
      };
  }
}

export function integritySummary(report: IntegrityReport): string | null {
  if (report.concerns.length === 0) return null;
  if (report.concerns.length === 1) return concernText(report.concerns[0]).title;
  return `${report.concerns.length} things about this device could put wallet keys at risk`;
}

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
  } catch {}
  return facts;
}

export function deviceIntegrity(): IntegrityReport {
  return assessIntegrity(readPlatformFacts());
}

// ---------------------------------------------------------------------------
// Server-Side Device Attestation (Play Integrity / App Attest)
// ---------------------------------------------------------------------------

/**
 * Generate a SHA-256 hash of a transaction intent for the integrity nonce.
 */
async function generateNonce(intent: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, intent);
  return digest;
}

/**
 * Get Play Integrity Token (Android) or App Attest (iOS) for a transaction intent.
 */
export async function getDeviceAttestation(intent: string): Promise<{ type: 'play_integrity' | 'app_attest', token?: string, keyId?: string, assertion?: string, error?: string }> {
  try {
    const nonce = await generateNonce(intent);

    if (Platform.OS === 'android') {
      try {
        const token = await requestIntegrityToken(nonce);
        return { type: 'play_integrity', token };
      } catch (err: any) {
        return { type: 'play_integrity', error: err.message || "Play Services not available or error requesting token" };
      }
    } else if (Platform.OS === 'ios' && AppAttest) {
      try {
        let keyId = await SecureStore.getItemAsync('app_attest_key_id', DEVICE_ONLY);
        if (!keyId) {
          keyId = await AppAttest.generateAttestationKey();
          if (keyId) {
            await SecureStore.setItemAsync('app_attest_key_id', keyId, DEVICE_ONLY);
            // We attest it with the backend challenge
            const attestation = await AppAttest.attestDevice(nonce);
            // In a real flow, we'd send attestation to backend to verify.
            // For now, return the assertion
            const assertion = await AppAttest.signAssertion(keyId, nonce);
            return { type: 'app_attest', keyId, assertion, token: attestation };
          }
        }
        
        if (keyId) {
          const assertion = await AppAttest.signAssertion(keyId, nonce);
          return { type: 'app_attest', keyId, assertion };
        }
        return { type: 'app_attest', error: "Could not generate key" };
      } catch (err: any) {
        return { type: 'app_attest', error: err.message || "App Attest error" };
      }
    }
    
    return { type: 'play_integrity', error: "Unsupported platform" };
  } catch (e: any) {
    return { type: 'play_integrity', error: e.message };
  }
}

