import * as LocalAuthentication from "expo-local-authentication";
import { Platform } from "react-native";
import { queryClient } from "./queries";

// ---------------------------------------------------------------------------
// The ONE gate for biometric approval prompts on money/account actions
// (send, swap, order, off-ramp, bill pay, earn, card issuance, co-pilot
// confirmations).
//
// Why it exists: Settings → Security → "Biometric approvals" PATCHes
// security.biometricEnabled on the profile, but every screen used to call
// LocalAuthentication directly — so the toggle changed NOTHING. This helper
// honors it, with fail-secure defaults: prompt unless the user has explicitly
// opted out on a profile we can actually see.
//
// Deliberately NOT routed through here:
//   * lib/auth.ts unlock()        — the app-lock gate, a different control;
//   * lib/wallet.ts key access    — enforced by the Android Keystore itself
//                                   (requireAuthentication), not by JS;
//   * cards.tsx DetailsModal      — revealing PAN/CVV is sensitive-data
//                                   ACCESS, not an approval; it stays gated
//                                   regardless of this preference (same norm
//                                   as Google Wallet).
//
// Those last two go through authenticateDeviceOwner() at the bottom of this
// file instead — same module, stricter contract.
// ---------------------------------------------------------------------------

interface ProfileShape {
  security?: { biometricEnabled?: boolean };
}

// --- naming ----------------------------------------------------------------
//
// The login screen said "Sign in with Fingerprint", and all three passkey error
// strings said "Fingerprint" too, in an app that ships on iPhones where the only
// biometric is Face ID. Naming hardware the device does not have reads as a bug
// in the app — and SignerPicker.tsx already got this right with "Face ID or
// fingerprint", so the app contradicted itself screen to screen.
//
// Resolved from what the device ACTUALLY enrols rather than from Platform.OS:
// plenty of Android phones are face-only, plenty of iPads are Touch ID, and
// both facts are readable.

let cachedLabel: string | null = null;

/**
 * What to call the biometric on THIS device — "Face ID", "Fingerprint",
 * "Touch ID", or a neutral fallback.
 *
 * Synchronous by necessity: it renders inside a button label. The first call
 * returns the neutral fallback and warms the cache via
 * `primeBiometricLabel()`, which the login screen awaits on mount.
 */
export function biometricLabel(): string {
  return cachedLabel ?? "Biometrics";
}

/**
 * Resolve and cache the device's biometric name. Call once at startup or on
 * mount of any screen that renders {@link biometricLabel}.
 *
 * Falls back to the neutral term on ANY failure. A wrong-but-confident label is
 * worse than a generic one: the user is being asked to authenticate, and the
 * prompt they are about to see names the real hardware regardless.
 */
export async function primeBiometricLabel(): Promise<string> {
  if (cachedLabel) return cachedLabel;
  try {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    const { FACIAL_RECOGNITION, FINGERPRINT, IRIS } = LocalAuthentication.AuthenticationType;

    if (types.includes(FACIAL_RECOGNITION)) {
      // Apple's is a trademark with an exact spelling; Android has no single
      // brand name for face unlock, so it gets the plain description.
      cachedLabel = Platform.OS === "ios" ? "Face ID" : "Face Unlock";
    } else if (types.includes(FINGERPRINT)) {
      cachedLabel = Platform.OS === "ios" ? "Touch ID" : "Fingerprint";
    } else if (types.includes(IRIS)) {
      cachedLabel = "Iris";
    } else {
      cachedLabel = "Biometrics";
    }
  } catch {
    cachedLabel = "Biometrics";
  }
  return cachedLabel;
}

/** The user's stated preference, read from the cached profile. Defaults to ON
 *  when the profile isn't loaded — unknown must never mean "skip the check". */
export function biometricApprovalsEnabled(): boolean {
  const profile = queryClient.getQueryData<ProfileShape>(["profile"]);
  return profile?.security?.biometricEnabled ?? true;
}

/**
 * Ask the user to confirm an action with biometrics.
 *
 * Resolves true when the action may proceed:
 *   - the user disabled "Biometric approvals" in Settings (their choice), or
 *   - the device owner completed a biometric or device-credential prompt.
 *
 * A missing biometric enrollment is NOT an approval. On that device the
 * system PIN/pattern/passcode is the appropriate fallback; on a device with
 * no lock at all this returns false. Skipping confirmation in either case
 * would make a money-moving action one tap away on an unprotected handset.
 */
export async function confirmWithBiometrics(promptMessage: string): Promise<boolean> {
  if (!biometricApprovalsEnabled()) return true;
  return (await authenticateDeviceOwner(promptMessage)).ok;
}

// ---------------------------------------------------------------------------
// Device-owner authentication — a DIFFERENT control from the approvals gate
// above, and deliberately stricter.
//
// confirmWithBiometrics guards an ACTION the user just initiated on an already
// unlocked app, so "no biometrics enrolled → proceed" is the right default:
// there is nothing to prompt with, and the user is already inside. The two
// callers below are not that. They gate ACCESS:
//
//   * revealing a card's PAN/CVV, and
//   * opening a session that the Keystore is still holding a token for.
//
// Falling through on an un-enrolled device turned both into no-ops — a phone
// with biometrics switched off in Settings showed card details, and the lock
// screen unlocked itself. Neither may depend on a fingerprint being enrolled,
// because a device PIN, pattern or passcode is an equally valid proof of
// device ownership and nearly every phone has one.
// ---------------------------------------------------------------------------

export type DeviceAuthResult =
  /** Proven: biometric or device credential succeeded. */
  | { ok: true }
  /** Prompted and the user failed or dismissed it. */
  | { ok: false; reason: "rejected" }
  /** The device has no lock at all — nothing can prove ownership here. */
  | { ok: false; reason: "no_device_lock" };

/**
 * Prove device ownership with whatever the device actually has: a fingerprint
 * or face when one is enrolled, the device PIN/pattern/passcode otherwise.
 *
 * `disableDeviceFallback: false` is what buys the second half — it maps to
 * `LAPolicyDeviceOwnerAuthentication` on iOS and to BiometricPrompt with
 * DEVICE_CREDENTIAL among the allowed authenticators on Android, so a
 * passcode-only device still gets a real prompt instead of a silent pass.
 *
 * `no_device_lock` is the one case with nothing to prompt for. It is returned,
 * never swallowed: the caller has to decide, and both callers here refuse.
 */
export async function authenticateDeviceOwner(
  promptMessage: string,
  cancelLabel = "Cancel"
): Promise<DeviceAuthResult> {
  // SecurityLevel.NONE means no biometric AND no PIN/pattern/passcode.
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  if (level === LocalAuthentication.SecurityLevel.NONE) {
    return { ok: false, reason: "no_device_lock" };
  }
  const res = await LocalAuthentication.authenticateAsync({
    promptMessage,
    cancelLabel,
    disableDeviceFallback: false,
    requireConfirmation: false,
  });
  return res.success ? { ok: true } : { ok: false, reason: "rejected" };
}
