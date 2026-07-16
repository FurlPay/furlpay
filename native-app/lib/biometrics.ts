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
