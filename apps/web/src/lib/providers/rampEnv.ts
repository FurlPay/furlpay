// ---------------------------------------------------------------------------
// Internal ramp-partner names and their environment variables.
//
// Inside the codebase the ramp partners go by internal names — FurlGateway,
// FurlBridge, FurlPayout — so routes, logs and audit rows do not hard-wire a
// vendor. That renaming is INTERNAL ONLY. A user paying through Coinbase is
// paying Coinbase: its terms, its KYC, its receipt. Every user-facing surface
// names the real company via `rampAttribution()`; hiding who holds the money
// would misrepresent the transaction.
//
// Env vars accept the new names first and the original vendor names as a
// fallback, so a deployment that already holds CDP_API_KEY_ID keeps working
// without a coordinated secret rename. Protocol values (JWT claims, header
// names, API hosts, provider status enums) are the vendor's and never renamed.
// ---------------------------------------------------------------------------

export type RampPartnerId = "furlgateway" | "furlbridge" | "furlpayout";

/** The company that actually processes the payment. Shown to users. */
export const RAMP_ATTRIBUTION: Readonly<Record<RampPartnerId, { company: string; termsUrl: string }>> = {
  furlgateway: { company: "Coinbase", termsUrl: "https://www.coinbase.com/legal/user_agreement" },
  furlbridge: { company: "Transak", termsUrl: "https://transak.com/terms-of-service" },
  furlpayout: { company: "Echo Money", termsUrl: "https://echo.money" },
};

export function rampAttribution(id: string): { company: string; termsUrl: string } | null {
  return (RAMP_ATTRIBUTION as Record<string, { company: string; termsUrl: string }>)[id] ?? null;
}

/** New internal name → the vendor-named variable it replaces. */
export const RAMP_ENV_ALIASES: Readonly<Record<string, string>> = {
  FURLGATEWAY_API_KEY_ID: "CDP_API_KEY_ID",
  FURLGATEWAY_API_KEY_SECRET: "CDP_API_KEY_SECRET",
  FURLBRIDGE_API_KEY: "TRANSAK_API_KEY",
  FURLBRIDGE_SECRET_KEY: "TRANSAK_SECRET_KEY",
  FURLBRIDGE_ACCESS_TOKEN: "TRANSAK_ACCESS_TOKEN",
  FURLBRIDGE_API_URL: "TRANSAK_API_URL",
  FURLPAYOUT_API_KEY: "ECHO_API_KEY",
  FURLPAYOUT_API_SECRET: "ECHO_API_SECRET",
  FURLPAYOUT_API_URL: "ECHO_API_URL",
};

/**
 * Read a ramp env var by its internal name, falling back to the legacy vendor
 * name. Blank values count as unset, so `FURLGATEWAY_API_KEY_ID=""` does not
 * shadow a real CDP_API_KEY_ID.
 */
export function rampEnv(name: string): string | undefined {
  const primary = (process.env[name] ?? "").trim();
  if (primary) return primary;
  const legacy = RAMP_ENV_ALIASES[name];
  const fallback = legacy ? (process.env[legacy] ?? "").trim() : "";
  return fallback || undefined;
}
