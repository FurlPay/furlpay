import { NextRequest, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/validate";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { getIdentityProvider } from "@/lib/compliance/providers/factory";
import { getCountryRule } from "@/lib/compliance/ruleEngine";
import { kvIncr, kvIncrBy, kvSetNx } from "@/lib/kv";
import { networkOf, trustedClientIp } from "@/lib/clientIp";
import { recordSecurityEvent } from "@/lib/ops/events";

// Every call opens a session at a paid identity provider, and the caller has
// no account. The per-IP limit alone is not a budget: it is per address, and
// addresses are cheap. This is the ceiling on what anonymous callers can open
// across ALL addresses in an hour. Past it the route refuses rather than keep
// spending; a signed-in user verifies through /api/compliance/verify, which is
// bound to their account and unaffected.
const ANON_SESSIONS_PER_HOUR = (() => {
  const n = Number(process.env.KYC_ANON_SESSIONS_PER_HOUR);
  return Number.isInteger(n) && n > 0 ? n : 200;
})();

// The global ceiling is shared by every legitimate signup, so draining it is a
// way to lock signups out. The per-IP limit (30 an hour) let about seven
// addresses empty it. Addresses are cheap, networks less so: each IPv4 /24 or
// IPv6 /48 gets its own hourly budget, so draining the ceiling takes at least
// ANON_SESSIONS_PER_HOUR / PER_NETWORK distinct networks, and the first time
// it is reached in a window an alert goes to the security event log.
const PER_NETWORK_PER_HOUR = 10;


const KycBody = z.object({
  fullName: z.string().min(1).max(200),
  dateOfBirth: z.string().max(20),
  documentNumber: z.string().min(1).max(100),
  country: z.string().length(2).optional(),
  selfieProvided: z.boolean().optional(),
});

// POST /api/compliance/kyc — start identity verification via Persona/Sumsub.
// Public route (runs during signup before a session exists).
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "compliance.kyc", { limit: 5, windowMs: 600_000 });
  if (limited) return limited;

  const parsed = KycBody.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.errors },
      { status: 400 },
    );
  }

  const { fullName, country } = parsed.data;
  const code = (country ?? "US").toUpperCase();
  const rule = getCountryRule(code);

  if (rule.autoBlock) {
    return NextResponse.json(
      { error: "Verification not available for this jurisdiction" },
      { status: 403 },
    );
  }

  // Counted only for requests that would actually reach the provider. If the
  // counter cannot be read the route fails closed: an unmetered paid call is
  // the thing this exists to prevent.
  // A caller whose network cannot be determined shares one budget, rather
  // than escaping the per-network limit.
  const net = networkOf(trustedClientIp(req)) ?? "unknown";
  let perNet: number;
  try {
    perNet = await kvIncr(`kyc:anon:net:${net}`, 3600);
  } catch {
    return NextResponse.json({ error: "verification_unavailable" }, { status: 503 });
  }
  if (perNet > PER_NETWORK_PER_HOUR) {
    return NextResponse.json(
      { error: "rate_limited", detail: "Too many verification attempts from this network. Try again later." },
      { status: 429, headers: { "Retry-After": "600" } },
    );
  }

  let opened: number;
  try {
    opened = await kvIncr("kyc:anon:sessions", 3600);
  } catch {
    return NextResponse.json({ error: "verification_unavailable" }, { status: 503 });
  }
  if (opened > ANON_SESSIONS_PER_HOUR) {
    // Once per window: a drained ceiling means signups are being refused. A
    // set-if-absent flag rather than "opened === limit + 1", which a limit
    // lowered mid-window would step over.
    if (await kvSetNx("kyc:anon:ceiling-alerted", 1, 3600).catch(() => false)) {
      await recordSecurityEvent({
        kind: "kyc_anon_ceiling_reached",
        rail: "transfers",
        severity: "high",
        detail: `Anonymous KYC ceiling (${ANON_SESSIONS_PER_HOUR}/h) reached; new signups are refused until the window resets.`,
      }).catch(() => {});
    }
    return NextResponse.json(
      { error: "verification_busy", detail: "Identity verification is busy. Try again later." },
      { status: 503, headers: { "Retry-After": "600" } },
    );
  }

  const provider = await getIdentityProvider();
  const ref = crypto.randomUUID();

  let session: Awaited<ReturnType<typeof provider.startVerification>>;
  try {
    session = await provider.startVerification(fullName, {
      requiredDocs: rule.requiredDocs,
      requiredChecks: rule.requiredChecks,
      referenceId: ref,
      country: code,
    });
  } catch (e) {
    // No session was opened, so nothing was spent: give the slots back. A
    // failed refund only makes the ceiling stricter, never looser.
    await Promise.all([kvIncrBy("kyc:anon:sessions", -1, 3600), kvIncrBy(`kyc:anon:net:${net}`, -1, 3600)]).catch(() => {});
    console.error("[compliance/kyc] provider failed:", (e as Error).message?.slice(0, 200));
    return NextResponse.json({ error: "verification_provider_error" }, { status: 502 });
  }

  return NextResponse.json({
    sessionId: session.sessionId,
    sessionUrl: session.sessionUrl,
    provider: provider.name,
    requiredDocs: rule.requiredDocs,
    requiredChecks: rule.requiredChecks,
  });
}
