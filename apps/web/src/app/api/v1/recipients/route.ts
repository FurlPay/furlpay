import { NextRequest } from "next/server";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { withIdempotency } from "@/lib/idempotency";
import { audit } from "@/lib/audit";
import { requireTenant, ok, problem } from "@/lib/controlPlane/tenancy";
import {
  upsertRecipient,
  attestDestination,
  loadRecipient,
  canonicalAddress,
} from "@/lib/controlPlane/recipientStore";
import { networkSpec, trustClassFor } from "@furlpay/control-plane";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /api/v1/recipients — allowlist a destination the organization vouches for.
//
// WHAT THIS ROUTE IS AND IS NOT. It creates an ENTERPRISE ALLOWLIST entry. The
// organization is saying "we believe this address belongs to this payee". That
// is a real and useful trust statement, and it is the WEAKEST of the three the
// system models — no independent check happened, and the record says so.
//
// THE METHOD IS NOT A REQUEST FIELD, AND THAT IS THE SECURITY PROPERTY.
// `domain_signature`, `well_known` and `penny_drop` all assert that FurlPay
// performed a check that could have FAILED. No such checker exists yet. If a
// caller could name the method, a request would be able to manufacture the
// strongest trust class in the system out of nothing — which is worse than
// having no attestation store at all, because it would look verified in the
// evidence. So this route hard-codes `human_confirmed` and there is no path
// from the request body to that field.
//
// `provenance` records WHICH user vouched, taken from the authenticated
// credential rather than the body, so the row names a real accountable party.
//
// A NEW RECIPIENT IS NOT IMMEDIATELY PAYABLE. Recipients are created PENDING.
// `verifyRecipient` denies a PENDING recipient, so creation alone does not
// authorize anything; activation is a separate, deliberate act.
// ---------------------------------------------------------------------------

const Body = z
  .object({
    recipientId: z.string().min(1).max(128),
    displayName: z.string().min(1).max(200),
    /** ISO-3166 alpha-2. Uppercase — the schema's check constraint requires it. */
    jurisdiction: z.string().length(2).regex(/^[A-Z]{2}$/).optional(),
    mcc: z.string().max(8).optional(),
    destination: z
      .object({
        networkId: z.string().min(1).max(64),
        asset: z.string().min(1).max(16),
        address: z.string().min(1).max(256),
        /** ISO-8601. Absent means the attestation does not expire. */
        expiresAt: z.string().datetime().optional(),
      })
      .strict(),
  })
  .strict();

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "v1.recipients.create", {
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const tenant = await requireTenant(req, "agents:manage");
  if (!tenant.ok) return tenant.res;

  const body = await validateBody(req, Body);
  if (body instanceof Response) return body;

  return withIdempotency(
    req.headers.get("idempotency-key"),
    "v1.recipients.create",
    async () => {
      const org = tenant.tenant.organizationId;

      // The network must be one the system actually knows how to validate an
      // address for. An unknown network id would be stored happily and then
      // never match anything — an attestation that silently cannot be used is
      // worse than a rejected one, because the operator believes it is in place.
      const spec = networkSpec(body.destination.networkId);
      if (!spec) {
        return problem(422, "network_unknown", {
          network: body.destination.networkId,
          message:
            "This network is not in the trusted network registry, so an address on it cannot be " +
            "validated or paid.",
        });
      }

      // A live tenant must not allowlist a testnet address: it is either a
      // mistake or an attempt to get a testnet destination into a live path.
      if (tenant.tenant.environment === "live" && !spec.mainnet) {
        return problem(422, "network_not_mainnet", {
          network: body.destination.networkId,
          message: "A live organization cannot attest a testnet destination.",
        });
      }

      const created = await upsertRecipient({
        organizationId: org,
        recipientId: body.recipientId,
        displayName: body.displayName,
        mcc: body.mcc,
        jurisdiction: body.jurisdiction,
      });
      if (!created) {
        return problem(503, "control_plane_unavailable", {
          message: "The recipient store is unavailable.",
        });
      }

      const attested = await attestDestination({
        organizationId: org,
        recipientId: body.recipientId,
        networkId: body.destination.networkId,
        asset: body.destination.asset,
        address: body.destination.address,
        // NOT from the body. See the header.
        method: "human_confirmed",
        provenance: `user:${tenant.tenant.userId}`,
        expiresAt: body.destination.expiresAt,
      });
      if (!attested) {
        // The recipient exists but has no attested destination, which means it
        // is not payable. Say so rather than reporting a success that would
        // leave the operator believing a destination was recorded.
        return problem(503, "attestation_failed", {
          message:
            "The recipient was created but the destination attestation was not recorded, so it " +
            "is not payable.",
        });
      }

      audit("recipient.attested", tenant.tenant.userId, {
        organizationId: org,
        recipientId: body.recipientId,
        networkId: body.destination.networkId,
        asset: body.destination.asset,
        method: "human_confirmed",
      });

      return ok(
        {
          recipientId: body.recipientId,
          status: "PENDING",
          destination: {
            networkId: body.destination.networkId,
            asset: body.destination.asset.toUpperCase(),
            address: canonicalAddress(body.destination.address, body.destination.networkId),
            method: "human_confirmed",
            // Returned explicitly so a caller cannot mistake an allowlist entry
            // for something FurlPay verified.
            trustClass: trustClassFor("human_confirmed"),
            expiresAt: body.destination.expiresAt ?? null,
          },
          message:
            "Created PENDING. A PENDING recipient is not payable — activate it once the " +
            "destination has been confirmed out of band.",
        },
        201
      );
    },
    // The organization, so one tenant's `order_123` can never resolve to
    // another tenant's cached response.
    { principal: tenant.tenant.organizationId, request: body }
  );
}

const QuerySchema = z.object({ id: z.string().min(1).max(128) });

export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "v1.recipients.read", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;

  const tenant = await requireTenant(req, "payments:read");
  if (!tenant.ok) return tenant.res;

  const parsed = QuerySchema.safeParse({
    id: new URL(req.url).searchParams.get("id") ?? "",
  });
  if (!parsed.success) {
    return problem(422, "invalid_query", { message: "An `id` query parameter is required." });
  }

  const lookup = await loadRecipient(tenant.tenant.organizationId, parsed.data.id);
  if (lookup === null) {
    return problem(503, "control_plane_unavailable", {
      message: "The recipient store is unavailable.",
    });
  }
  // A recipient belonging to another tenant and a recipient that does not exist
  // return the same 404, so an id cannot be used as an existence oracle.
  if (!lookup.record) {
    return problem(404, "not_found", { message: "No such recipient." });
  }

  return ok({
    recipientId: lookup.record.recipientId,
    displayName: lookup.record.displayName,
    status: lookup.record.status,
    verifiedDomain: lookup.record.verifiedDomain ?? null,
    jurisdiction: lookup.record.jurisdiction ?? null,
    seenBefore: lookup.seenBefore,
    destinations: lookup.record.destinations.map((d) => ({
      networkId: d.networkId,
      asset: d.asset,
      address: d.address,
      method: d.method,
      // The three trust statements stay distinguishable all the way out to the
      // API. Collapsing them into "attested: true" here would undo the point.
      trustClass: trustClassFor(d.method),
      provenance: d.provenance ?? null,
      attestedAt: d.attestedAt,
      expiresAt: d.expiresAt ?? null,
    })),
  });
}
