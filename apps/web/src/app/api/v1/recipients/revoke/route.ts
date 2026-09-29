import { NextRequest } from "next/server";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { audit } from "@/lib/audit";
import { requireTenant, ok, problem } from "@/lib/controlPlane/tenancy";
import { revokeDestination, loadRecipient } from "@/lib/controlPlane/recipientStore";
import { revokeSubject } from "@/lib/controlPlane/revocationAdapter";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /api/v1/recipients/revoke — withdraw trust in a destination.
//
// TWO DIFFERENT THINGS CAN BE REVOKED, AND THEY ARE NOT THE SAME.
//
//   · ONE ADDRESS. "This particular address on this particular network is no
//     longer ours." Other attested addresses for the same payee stay payable.
//   · THE WHOLE RECIPIENT. "Do not pay this payee at all." Written to
//     `cp_revocations`, which the live revocation engine reads on the very next
//     authorization — including for a payment already in flight.
//
// Conflating them would mean an operator who wanted to disown one compromised
// address had to choose between leaving it payable and blocking a legitimate
// counterparty entirely, which is how an incident response ends up doing
// neither in time.
//
// REVOCATION IS AN UPDATE, NEVER A DELETE. The row survives with `revoked_at`
// set, so "was this address trusted when that payment was authorized?" stays
// answerable afterwards — which is the question an incident actually asks, and
// the one a DELETE destroys.
//
// IT IS ALSO RECHECKED AT EXECUTION. `/payments/execute` re-reads the
// attestation before submitting, so revoking here stops a payment that was
// authorized before the revocation and has not yet been executed.
// ---------------------------------------------------------------------------

const Body = z
  .object({
    recipientId: z.string().min(1).max(128),
    reason: z.string().min(1).max(500),
    /** Present = revoke this one destination. Absent = revoke the payee. */
    destination: z
      .object({
        networkId: z.string().min(1).max(64),
        asset: z.string().min(1).max(16),
        address: z.string().min(1).max(256),
      })
      .strict()
      .optional(),
  })
  .strict();

export async function POST(req: NextRequest) {
  // Tighter than the read limit: revocation is an incident control, and a flood
  // of them is either a bug or an attempt to obscure one.
  const limited = await rateLimitOr429(req, "v1.recipients.revoke", {
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const tenant = await requireTenant(req, "agents:manage");
  if (!tenant.ok) return tenant.res;

  const body = await validateBody(req, Body);
  if (body instanceof Response) return body;

  const org = tenant.tenant.organizationId;

  // Tenant-scoped: another organization's recipient is simply not found, so
  // this route cannot be used to block a competitor's counterparty.
  const lookup = await loadRecipient(org, body.recipientId);
  if (lookup === null) {
    return problem(503, "control_plane_unavailable", {
      message: "The recipient store is unavailable.",
    });
  }
  if (!lookup.record) {
    return problem(404, "not_found", { message: "No such recipient." });
  }

  if (body.destination) {
    const revoked = await revokeDestination({
      organizationId: org,
      recipientId: body.recipientId,
      networkId: body.destination.networkId,
      asset: body.destination.asset,
      address: body.destination.address,
      reason: body.reason,
      revokedBy: tenant.tenant.userId,
    });

    audit("recipient.destination_revoked", tenant.tenant.userId, {
      organizationId: org,
      recipientId: body.recipientId,
      networkId: body.destination.networkId,
      alreadyRevoked: !revoked,
    });

    // Revoking an already-revoked destination is a SUCCESS, not a conflict. A
    // client retrying after a timeout must not be told something went wrong
    // when the thing it wanted is already true.
    return ok({
      recipientId: body.recipientId,
      scope: "destination",
      revoked: true,
      changed: revoked,
    });
  }

  const recorded = await revokeSubject({
    organizationId: org,
    kind: "recipient",
    subjectId: body.recipientId,
    reason: body.reason,
    revokedBy: tenant.tenant.userId,
  });
  if (!recorded) {
    // The money path reads `cp_revocations`. If that write did not land, the
    // payee is still payable, and reporting success would be a lie with
    // financial consequences.
    return problem(503, "revocation_not_recorded", {
      message:
        "The revocation was not recorded, so this recipient is still payable. Retry — do not " +
        "assume it took effect.",
    });
  }

  audit("recipient.revoked", tenant.tenant.userId, {
    organizationId: org,
    recipientId: body.recipientId,
  });

  return ok({ recipientId: body.recipientId, scope: "recipient", revoked: true, changed: true });
}
