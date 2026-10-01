// ---------------------------------------------------------------------------
// Origin verification — proof that a request reached this server through our
// CloudFront distribution (docs/aws/RUNBOOK.md §3).
//
// CloudFront adds `X-Origin-Verify: <secret>` to every request it forwards to
// the ALB. The ALB security group admits only CloudFront's managed prefix list,
// but those addresses are shared by every CloudFront customer, so anyone's
// distribution could otherwise reach the origin and skip our WAF. This header
// is what makes the origin private at the application layer.
//
// NOT A SUBSTITUTE FOR NETWORK CONTROLS. It complements the security-group
// restriction and an ALB listener rule on the same header (which also covers
// the static assets this middleware never sees — see its matcher).
//
// FAILS CLOSED WHERE IT IS REQUIRED. The runbook's sketch
// (`if (expected && header !== expected)`) silently switches the check OFF when
// the secret is missing from the task — the likely misconfiguration, since the
// secret is created in Terraform but must also be injected into the task. So a
// deployment that declares ORIGIN_VERIFY_REQUIRED=true and has no usable secret
// refuses everything (503) instead of serving an unprotected origin.
//
// Environments that declare nothing (local dev, Vercel) are unaffected.
//
// Edge-runtime safe: no Node APIs.
// ---------------------------------------------------------------------------

export const ORIGIN_VERIFY_HEADER = "x-origin-verify";

/** Minimum secret length accepted; Terraform generates 64. */
const MIN_SECRET_LENGTH = 32;

/**
 * Paths reachable without the header. Only the liveness probe: ALB health
 * checks connect to the target directly and cannot carry a CloudFront header.
 */
const EXEMPT_PATHS = new Set(["/api/health"]);

export type OriginDecision = "allow" | "reject" | "misconfigured";

interface OriginEnv {
  ORIGIN_VERIFY_REQUIRED?: string;
  ORIGIN_VERIFY_SECRET?: string;
}

/** Constant-time comparison for equal-length strings (no Node crypto on Edge). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function checkOrigin(
  pathname: string,
  method: string,
  headerValue: string | null,
  env: OriginEnv = process.env as OriginEnv
): OriginDecision {
  const required = env.ORIGIN_VERIFY_REQUIRED === "true";
  const expected = (env.ORIGIN_VERIFY_SECRET ?? "").trim();

  // Nothing declared: not running behind CloudFront (local dev, Vercel).
  if (!required && !expected) return "allow";

  // Declared as required but no usable secret: refuse rather than run open.
  // Checked BEFORE the health exemption on purpose: the liveness probe then
  // fails too, so ECS marks the task unhealthy and the deployment circuit
  // breaker rolls the bad release back instead of keeping a fleet that passes
  // health checks while answering 503 to everyone.
  if (expected.length < MIN_SECRET_LENGTH) return "misconfigured";

  if (EXEMPT_PATHS.has(pathname) && (method === "GET" || method === "HEAD")) return "allow";

  return headerValue !== null && safeEqual(headerValue, expected) ? "allow" : "reject";
}
