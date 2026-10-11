// Signing key for reusable KYC credentials (/api/compliance/credential).

/** In-repo, therefore public. Usable ONLY outside production builds. */
const DEV_SECRET = "furlpay_credential_issuer_sandbox";

/**
 * The key credentials are signed and verified with.
 *
 * This used to fall back to DEV_SECRET everywhere. Production does not set
 * FURLPAY_CREDENTIAL_SECRET, so it signed "KYC verified, sanctions clear"
 * credentials with a string anyone can read in this repository — and verified
 * them with it too, so a forged credential checked out as valid. A production
 * build now refuses to issue or verify without a real secret of its own.
 */
export function credentialSecret(env: Record<string, string | undefined> = process.env): string | null {
  const configured = (env.FURLPAY_CREDENTIAL_SECRET ?? "").trim();
  if (configured && configured !== DEV_SECRET && configured.length >= 32) return configured;
  return env.NODE_ENV === "production" ? null : DEV_SECRET;
}
