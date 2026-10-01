import { canonicalEmail } from "@/lib/identity";

// ---------------------------------------------------------------------------
// The bootstrap admin identity — one place, and no production fallback.
//
// THE BUG THIS CLOSES. authz.ts and compliance/roleGrants.ts each read
// `process.env.FURLPAY_ADMIN_EMAIL ?? "ashutosh@furlpay.app"`. The fallback is
// the seeded demo account's email, and `furlpay.app` was an unregistered domain
// (NXDOMAIN on 2026-09-30). On any deployment that forgot the variable — the
// AWS task definition did not set it — anyone who registered that domain could
// receive the login OTP for the seeded account, which carried the admin and
// compliance_officer roles in every process. The fallback turned a missing env
// var into a full admin takeover.
//
// THE RULE NOW.
//   - FURLPAY_ADMIN_EMAIL set          → that address, validated.
//   - unset, NODE_ENV !== "production" → the local demo account (dev/test only,
//                                        where the seed is a convenience).
//   - unset, NODE_ENV === "production" → null: NOBODY is the bootstrap admin.
//                                        Preview deployments land here too.
//   - production (not a Vercel preview) with it unset → assertAdminConfig()
//     throws, and instrumentation.ts refuses to boot the server.
// ---------------------------------------------------------------------------

/** Local-development-only bootstrap identity (the seeded demo account). Never
 *  returned when NODE_ENV === "production". */
const DEVELOPMENT_BOOTSTRAP_EMAIL = "ashutosh@furlpay.app";

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Env = Record<string, string | undefined>;

export class AdminConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminConfigError";
  }
}

/** A real production deployment: production build, not a Vercel preview. */
export function isProductionRuntime(env: Env = process.env): boolean {
  return env.NODE_ENV === "production" && env.VERCEL_ENV !== "preview";
}

/**
 * The email whose account may hold bootstrap admin rights, or null when no
 * such identity exists in this deployment.
 */
export function adminBootstrapEmail(env: Env = process.env): string | null {
  const configured = canonicalEmail(env.FURLPAY_ADMIN_EMAIL ?? "");
  if (configured) {
    if (!EMAIL_SHAPE.test(configured)) {
      throw new AdminConfigError("FURLPAY_ADMIN_EMAIL is set but is not an email address");
    }
    return configured;
  }
  if (env.NODE_ENV === "production") return null;
  return DEVELOPMENT_BOOTSTRAP_EMAIL;
}

/** Boot-time check. Throws in a production runtime without an explicit admin. */
export function assertAdminConfig(env: Env = process.env): void {
  if (isProductionRuntime(env) && !(env.FURLPAY_ADMIN_EMAIL ?? "").trim()) {
    throw new AdminConfigError(
      "FURLPAY_ADMIN_EMAIL must be set in production. There is no fallback admin identity."
    );
  }
  adminBootstrapEmail(env); // validates the shape when set
}

/** True when `email` is the configured bootstrap admin. Null-safe: when no
 *  bootstrap identity exists, nobody matches. */
export function isBootstrapAdminEmail(email: string | null | undefined, env: Env = process.env): boolean {
  const bootstrap = adminBootstrapEmail(env);
  if (!bootstrap) return false;
  return canonicalEmail(email ?? "") === bootstrap;
}
