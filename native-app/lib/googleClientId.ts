// Pure, dependency-free so it is unit-testable without loading expo-auth-session
// and the rest of oauth.ts's native imports.

/**
 * True only for a REAL Google OAuth client id: ends in
 * `.apps.googleusercontent.com` and is not one of the format-valid PLACEHOLDER
 * ids a test/CI build injects to satisfy app.config.js's release guard.
 *
 * Gates whether the native Google button renders. A placeholder id passes the
 * build guard (correct — it lets a device-test AAB build without real Google
 * config) but must NOT surface a button that dead-ends on Google's
 * "Error 401: invalid_client / The OAuth client was not found."
 */
export function isRealGoogleClientId(id: string | undefined | null): boolean {
  return !!id && /\.apps\.googleusercontent\.com$/.test(id) && !/placeholder/i.test(id);
}
