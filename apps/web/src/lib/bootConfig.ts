import { assertAdminConfig, isProductionRuntime } from "@/lib/adminIdentity";
import { proxyTrust } from "@/lib/clientIp";
import { configuredPublicOrigin } from "@/lib/publicOrigin";

// Everything a production process must have before it serves a request. Called
// from instrumentation.ts register(); a throw here stops the server from
// booting. Kept separate from instrumentation.ts so it is unit-testable.
//
// Add a check here only when running WITHOUT the value is unsafe (a security
// fallback would kick in). A merely-degraded feature belongs in lib/env.ts's
// presence report instead.

type Env = Record<string, string | undefined>;

/**
 * Values that are placeholders, never secrets. Terraform creates every app
 * secret as "REPLACE_ME" (infra/aws/modules/env/compute.tf) for an operator to
 * fill in; if one reaches a process unfilled, the app would treat a string
 * printed in the repository as its secret — a STRIPE_WEBHOOK_SECRET of
 * "REPLACE_ME" lets anyone forge signed events.
 */
export const PLACEHOLDER_VALUES = ["REPLACE_ME", "whsec_placeholder", "changeme", "CHANGEME", "TODO"];

export class BootConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BootConfigError";
  }
}

export function placeholderVariables(env: Env): string[] {
  return Object.entries(env)
    .filter(([, v]) => v !== undefined && PLACEHOLDER_VALUES.includes(v.trim()))
    .map(([k]) => k)
    .sort();
}

/** Production data plane: without these the app has no database/KV and some
 *  paths would otherwise fall back (lib/kv.ts refuses its in-memory fallback
 *  per call; this refuses the whole process up front). */
export function missingCoreVariables(env: Env): string[] {
  const missing: string[] = [];
  if (!env.FURLPAY_SESSION_SECRET?.trim()) missing.push("FURLPAY_SESSION_SECRET");
  if (!env.SUPABASE_URL?.trim()) missing.push("SUPABASE_URL");
  if (!env.SUPABASE_SERVICE_ROLE_KEY?.trim()) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  const kv =
    (env.KV_REST_API_URL?.trim() && env.KV_REST_API_TOKEN?.trim()) ||
    (env.UPSTASH_REDIS_REST_URL?.trim() && env.UPSTASH_REDIS_REST_TOKEN?.trim());
  if (!kv) missing.push("KV_REST_API_URL/KV_REST_API_TOKEN");
  return missing;
}

/**
 * Edge trust (docs/release/CLIENT_IP_TRUST_MODEL.md). Behind CloudFront
 * (ORIGIN_VERIFY_REQUIRED=true) every viewer header is forwarded, so without a
 * hop count the client would choose its own rate-limit identity, and without
 * a public origin every redirect, OAuth issuer and DPoP htu would name the
 * container's bind address.
 */
export function edgeTrustProblems(env: Env): string[] {
  const problems: string[] = [];
  const trust = proxyTrust(env);
  if (trust.mode === "invalid") {
    problems.push(`FURLPAY_TRUSTED_PROXY_HOPS must be an integer 1-8 (got ${JSON.stringify(trust.value)})`);
  }
  try {
    configuredPublicOrigin(env);
  } catch (e) {
    problems.push((e as Error).message);
  }
  if (env.ORIGIN_VERIFY_REQUIRED === "true") {
    if (trust.mode === "platform") problems.push("FURLPAY_TRUSTED_PROXY_HOPS is required behind CloudFront (ORIGIN_VERIFY_REQUIRED=true)");
    if (!env.PUBLIC_API_ORIGIN?.trim()) problems.push("PUBLIC_API_ORIGIN is required behind CloudFront (ORIGIN_VERIFY_REQUIRED=true)");
    // Off Vercel there is no VERCEL_URL to derive from: without these, passkeys
    // would bind to rpID "localhost" (lib/webauthn.ts falls back to it).
    if (!env.FURLPAY_RP_ID?.trim()) problems.push("FURLPAY_RP_ID is required behind CloudFront");
    if (!env.FURLPAY_ORIGIN?.trim()) problems.push("FURLPAY_ORIGIN is required behind CloudFront");
  }
  // A production process must never hand out a loopback or bind-address URL.
  for (const name of ["PUBLIC_API_ORIGIN", "FURLPAY_ORIGIN", "FURLPAY_RP_ID"] as const) {
    if (/(^|[/,.\s])(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])([:/,\s]|$)/i.test(env[name] ?? "")) {
      problems.push(`${name} names a loopback or bind address; production URLs must be public`);
    }
  }
  return problems;
}

/** Non-fatal findings the boot hook logs; the process still serves traffic. */
export interface BootReport {
  warnings: string[];
}

export function assertBootConfig(env: Env = process.env): BootReport {
  const warnings: string[] = [];
  const admin = assertAdminConfig(env); // throws only for a malformed value
  if (admin === "disabled_not_configured" && isProductionRuntime(env)) {
    warnings.push(
      "FURLPAY_ADMIN_EMAIL is not set: administration is DISABLED (no account holds the admin role; there is no fallback). Set it to enable admin and ops routes."
    );
  }
  if (!isProductionRuntime(env)) return { warnings };
  const edge = edgeTrustProblems(env);
  if (edge.length) {
    throw new BootConfigError(`edge trust misconfigured: ${edge.join("; ")}`);
  }
  const placeholders = placeholderVariables(env);
  if (placeholders.length) {
    throw new BootConfigError(`placeholder values in production for: ${placeholders.join(", ")}`);
  }
  const missing = missingCoreVariables(env);
  if (missing.length) {
    throw new BootConfigError(`missing required production configuration: ${missing.join(", ")}`);
  }
  return { warnings };
}
