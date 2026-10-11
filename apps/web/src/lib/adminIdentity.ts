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
//   - production (not a Vercel preview) with it unset → the server BOOTS with
//     administration disabled, logs that loudly at boot, and reports it in
//     /api/ops/readiness. Admin-only routes have no admin to grant.
//   - set but malformed → assertAdminConfig() throws and the server refuses
//     to boot: an explicit wrong value is a mistake to stop on, not a mode.
//
// WHY A MISSING ADMIN NO LONGER STOPS THE BOOT (2026-10-02). The takeover is
// closed by the null identity above — tested independently in
// adminFallback.spec ("nobody is the bootstrap admin", "an OTP login for the
// old fallback email creates a plain, empty, unprivileged account"). The boot
// exit added no access control on top of that; it converted a missing
// OPERATOR setting into a total outage of the public site, payments included.
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

export type AdminConfigStatus = "configured" | "disabled_not_configured" | "development_seed";

/**
 * Boot-time check. Throws ONLY for a malformed configured value. Returns the
 * mode so the boot hook can say, loudly, that production is running without
 * an administrator. It never returns or substitutes an address.
 */
export function assertAdminConfig(env: Env = process.env): AdminConfigStatus {
  adminBootstrapEmail(env); // throws AdminConfigError when set but malformed
  if ((env.FURLPAY_ADMIN_EMAIL ?? "").trim()) return "configured";
  return env.NODE_ENV === "production" ? "disabled_not_configured" : "development_seed";
}

/** For health/readiness: whether bootstrap administration is available. Never throws. */
export function adminConfigStatus(env: Env = process.env): AdminConfigStatus | "invalid" {
  try {
    return assertAdminConfig(env);
  } catch {
    return "invalid";
  }
}

/** True when `email` is the configured bootstrap admin. Null-safe: when no
 *  bootstrap identity exists, nobody matches. */
export function isBootstrapAdminEmail(email: string | null | undefined, env: Env = process.env): boolean {
  const bootstrap = adminBootstrapEmail(env);
  if (!bootstrap) return false;
  return canonicalEmail(email ?? "") === bootstrap;
}
