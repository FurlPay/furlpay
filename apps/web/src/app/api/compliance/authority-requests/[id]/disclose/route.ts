import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { retrieveDisclosurePackage } from "@/lib/compliance/authorityRequest";
import { audit } from "@/lib/audit";
import { recordSecurityEvent } from "@/lib/ops/events";
import { noteSensitiveAccess } from "@/lib/ops/dataAccessAnomaly";

export const dynamic = "force-dynamic";

const DiscloseBodySchema = z.object({
  token: z.string().trim().min(30).max(128),
});

// POST /api/compliance/authority-requests/[id]/disclose
//
// Redeems the single-use disclosure token minted by a dual-approved request.
//
// DELIBERATELY UNAUTHENTICATED. The token IS the credential: 256 bits of
// entropy, stored only as a SHA-256 hash, valid for one hour and one read. The
// receiving authority holds it out of band and has no FurlPay session. Adding a
// login here would not add security — it would add an account to compromise.
//
// WHAT THAT COSTS, AND HOW IT IS PAID. An unauthenticated endpoint must not
// become an oracle. The previous version returned the library's own error
// strings verbatim, so anyone holding a request id — which is shared far more
// widely than the token, appearing in correspondence and ticketing — could read
// back "Package not in approved state (status: staged)". That discloses the
// existence and progress of a law-enforcement investigation into a named
// customer, which is the one thing these workflows are usually required NOT to
// reveal, and it does so to a caller who has proven nothing.
//
// So the caller gets one generic refusal for every failure mode, and the real
// reason goes to the audit trail and the security event stream, where the people
// entitled to it can see it.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const limited = await rateLimitOr429(req, "compliance.auth_req.disclose", {
    limit: 10,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const { id } = await props.params;
  const body = await validateBody(req, DiscloseBodySchema);
  if (body instanceof NextResponse) return body;

  try {
    const pkg = await retrieveDisclosurePackage(id, body.token);
    return NextResponse.json({
      ok: true,
      disclosurePackage: pkg,
      notice:
        "This disclosure package has been released under authorized statutory authority. This access token has now been permanently invalidated.",
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown";

    // A failed redemption is a security event, not a 403 and nothing else.
    // Previously it left no trace at all: someone probing tokens against a known
    // request id was invisible. This is the signal that says somebody tried.
    audit("auth.mfa_failed", "authority_token_holder", {
      action: "authority.disclosure_denied",
      requestId: id,
      reason,
    });
    await recordSecurityEvent({
      rail: "transfers",
      kind: "authority_disclosure_denied",
      severity: "high",
      detail: `Disclosure token rejected for ${id}: ${reason}`,
      actor: "authority_token_holder",
    }).catch(() => {});

    // Repeated failures against one request id is token probing. The request id
    // circulates in correspondence; the token does not, so a run of misses is a
    // caller guessing rather than an authority fumbling a paste.
    await noteSensitiveAccess({
      kind: "authority_disclosure_denied",
      actorId: `req:${id}`,
      resourceRef: id,
    });

    // ONE message for every cause — bad token, wrong state, expired, unknown id.
    // A caller who legitimately holds a valid token never sees this; a caller who
    // does not learns nothing about why.
    return NextResponse.json(
      {
        ok: false,
        error:
          "This disclosure request could not be completed. Contact the FurlPay compliance team through the channel used to issue your authorization.",
      },
      { status: 403 }
    );
  }
}
