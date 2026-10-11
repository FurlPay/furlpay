// BVNK configuration (docs: https://docs.bvnk.com/bvnk/api-explorer/api-overview/authentication).
//
// Every value is read from the environment at call time and nothing has a
// default: an unset BVNK_ENVIRONMENT means "BVNK is not configured", never
// "assume sandbox" — and certainly never "assume production".

export const BVNK_BASE_URLS = {
  sandbox: "https://api.sandbox.bvnk.com",
  production: "https://api.bvnk.com",
} as const;
export type BvnkEnvironment = keyof typeof BVNK_BASE_URLS;

export class BvnkNotConfigured extends Error {
  constructor(what: string) {
    super(`BVNK is not configured: ${what}`);
    this.name = "BvnkNotConfigured";
  }
}

export type BvnkApiConfig = { environment: BvnkEnvironment; baseUrl: string; authId: string; authKey: string };

/** API credentials, or a BvnkNotConfigured error naming what is missing. */
export function bvnkApiConfig(env: NodeJS.ProcessEnv = process.env): BvnkApiConfig {
  const environment = (env.BVNK_ENVIRONMENT ?? "").trim();
  if (environment !== "sandbox" && environment !== "production") throw new BvnkNotConfigured("BVNK_ENVIRONMENT must be sandbox or production");
  const authId = (env.BVNK_HAWK_AUTH_ID ?? "").trim();
  const authKey = (env.BVNK_HAWK_AUTH_KEY ?? "").trim();
  if (!authId || !authKey) throw new BvnkNotConfigured("BVNK_HAWK_AUTH_ID and BVNK_HAWK_AUTH_KEY");
  return { environment, baseUrl: BVNK_BASE_URLS[environment], authId, authKey };
}

/** The webhook secret, or null (the route then refuses every delivery). */
export function bvnkWebhookSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = env.BVNK_WEBHOOK_SECRET ?? "";
  // Used exactly as BVNK displays it (the documented samples use the string's
  // UTF-8 bytes, not a base64 decode), so it is not trimmed or transformed.
  return secret.length >= 16 ? secret : null;
}

/**
 * Money-moving calls (transfer creation, quote acceptance) are refused unless
 * this is explicitly on. It is a deployment decision taken after sandbox
 * verification, provider approval and compliance review — not a default.
 */
export function bvnkMoneyMovementEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BVNK_MONEY_MOVEMENT_ENABLED === "1";
}
