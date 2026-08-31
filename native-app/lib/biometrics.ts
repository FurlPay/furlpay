import * as LocalAuthentication from "expo-local-authentication";
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
 *   - the device has no enrolled biometrics (nothing to prompt with), or
 *   - the biometric prompt succeeded.
 * Resolves false only when the prompt was shown and failed/dismissed.
 */
export async function confirmWithBiometrics(promptMessage: string): Promise<boolean> {
  if (!biometricApprovalsEnabled()) return true;
  const enrolled =
    (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
  if (!enrolled) return true;
  const res = await LocalAuthentication.authenticateAsync({ promptMessage });
  return res.success;
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
