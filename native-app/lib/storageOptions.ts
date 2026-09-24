import * as SecureStore from "expo-secure-store";

// ---------------------------------------------------------------------------
// One place that decides how anything sensitive is stored at rest.
//
// THE BUG THIS EXISTS TO KILL: the wallet mnemonic was stored correctly —
// `requireAuthentication: true` + `WHEN_UNLOCKED_THIS_DEVICE_ONLY` — while the
// session JWT, the anti-phishing phrase, the App Attest key id, the install id
// and both wallet addresses were each written with NO options at all, taking
// the platform default. On iOS that default admits the item to an encrypted
// iCloud Keychain backup, so those values could reappear on a restored device
// the user no longer holds.
//
// Nothing about that was a decision. Each call site simply omitted the third
// argument, and an omission is invisible in review — which is why the policy
// now has a name that has to be typed.
// ---------------------------------------------------------------------------

/**
 * Default for everything sensitive: readable only while the device is unlocked,
 * and never leaves this device.
 *
 * NOT `requireAuthentication`. That triggers a biometric prompt on every READ,
 * which is correct for a seed phrase the user touches rarely and wrong for
 * anything on a hot path — a background token refresh has no UI to prompt with,
 * and prompting constantly trains the user to approve reflexively.
 */
export const DEVICE_ONLY: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/**
 * For key material whose use should itself require the device owner: the
 * mnemonic, and anything that can sign on its own.
 *
 * Decryption is gated by the Secure Enclave / StrongBox, not by JavaScript — a
 * caller cannot read the value without a successful biometric or device-credential
 * check, whatever the calling code does.
 */
export const DEVICE_ONLY_BIOMETRIC: SecureStore.SecureStoreOptions = {
  requireAuthentication: true,
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/**
 * For values that must survive a device lock because a background task reads
 * them while the screen is off — push registration state, for instance.
 *
 * Still `ThisDeviceOnly`: the relaxation is about WHEN it can be read, never
 * about whether it can leave the device. Use sparingly and say why at the call
 * site; `DEVICE_ONLY` is the right answer almost always.
 */
export const BACKGROUND_READABLE: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};
