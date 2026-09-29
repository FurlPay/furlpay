import { NextRequest } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { withIdempotency } from "@/lib/idempotency";
import { audit } from "@/lib/audit";
import { requireTenant, ok, problem } from "@/lib/controlPlane/tenancy";
import { insertMandate } from "@/lib/controlPlane/store";
import {
  validateMandateShape,
  mandateSigningPayload,
  authorityScopeHash,
  CONTROL_PLANE_POLICY_VERSION,
  type IntentMandate,
} from "@furlpay/control-plane";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /api/v1/mandates — issue a bounded, verifiable grant.
//
// A mandate is the object a principal SIGNS, and everything downstream is an
// intersection of it. So this route's whole job is to refuse an incoherent one
// BEFORE it can be relied upon: `validateMandateShape` runs on the issue path
// precisely so a mandate with a negative cap, an expiry in the past, or a
// per-transaction limit above its own cumulative limit is never written at all.
// Signature checks catch tampering; they say nothing about coherence.
//
// AMOUNTS ARE STRINGS, AND THAT IS NOT A STYLE CHOICE. A JSON number is a double
// — `9007199254740993` does not survive the round trip, and an 18-decimal token
// amount is far past that. The schema accepts only decimal-digit strings, which
// is the same rule `parseAtomic` applies everywhere else in the repo.
// ---------------------------------------------------------------------------

/** Decimal digits only. Rejects "0x10", "1e6", "+5", " 1 " and "" — every form
 *  `BigInt()` silently coerces (F-9). */
const Atomic = z.string().regex(/^[0-9]+$/, "must be decimal digits in the asset's minor units");

const AuthorityScope = z
  .object({
    currency: z.string().min(1).max(16),
    maxAmountPerTxAtomic: Atomic,
    maxCumulativeAtomic: Atomic,
    spendingWindowSeconds: z.number().int().positive().max(90 * 24 * 3600),
    allowedMerchantDomains: z.array(z.string().max(255)).max(100).optional(),
    allowedCategories: z.array(z.string().max(64)).max(50).optional(),
    allowedRails: z.array(z.string().max(64)).max(20).optional(),
    requireHumanApprovalAboveAtomic: Atomic.optional(),
    allowedJurisdictions: z.array(z.string().length(2)).max(250).optional(),
    blockedJurisdictions: z.array(z.string().length(2)).max(250).optional(),
    asset: z.string().max(16).optional(),
    networks: z.array(z.string().max(64)).max(20).optional(),
  })
  .strict();

const Body = z
  .object({
    principalId: z.string().min(1).max(128),
    delegatedTo: z.string().min(1).max(256),
    authorityScope: AuthorityScope,
    expiresAt: z.string().datetime(),
    notBefore: z.string().datetime().optional(),
    singleUse: z.boolean().optional(),
    credential: z
      .object({
        format: z.enum(["internal-ed25519", "ap2-sd-jwt", "ap2-ed25519", "vc-jwt"]),
        token: z.string().max(8192),
        keyId: z.string().max(256),
      })
      .strict()
      .optional(),
  })
  .strict();

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "v1.mandates.create", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const tenant = await requireTenant(req, "agents:manage");
  if (!tenant.ok) return tenant.res;

  const body = await validateBody(req, Body);
  if (body instanceof Response) return body;

  return withIdempotency(
    req.headers.get("idempotency-key"),
    "v1.mandates.create",
    async () => {
      const mandateId = `cpm_${randomUUID().replace(/-/g, "")}`;
      const issuedAt = new Date().toISOString();

      const candidate: IntentMandate = {
        mandateId,
        organizationId: tenant.tenant.organizationId,
        principalId: body.principalId,
        delegatedTo: body.delegatedTo,
        authorityScope: body.authorityScope,
        issuedAt,
        expiresAt: body.expiresAt,
        notBefore: body.notBefore,
        // Single-use replay guard. Generated here, never accepted from the
        // caller: a nonce a client chooses is a nonce a client can repeat.
        nonce: randomUUID(),
        singleUse: body.singleUse,
        policyVersion: CONTROL_PLANE_POLICY_VERSION,
        status: "ACTIVE",
      };

      // Coherence BEFORE persistence. A signed-but-incoherent mandate is a
      // mandate whose author did not mean what it says.
      const shape = validateMandateShape(candidate);
      if (!shape.ok) {
        return problem(422, "mandate_incoherent", { reason: shape.error, message: shape.detail });
      }

      const stored = await insertMandate({
        id: mandateId,
        organizationId: tenant.tenant.organizationId,
        principalId: body.principalId,
        delegatedTo: body.delegatedTo,
        authorityScope: body.authorityScope,
        payloadHash: authorityScopeHash({ signingPayload: mandateSigningPayload(candidate) }),
        nonce: candidate.nonce,
        policyVersion: candidate.policyVersion,
        expiresAt: body.expiresAt,
        notBefore: body.notBefore,
        singleUse: body.singleUse,
        credentialFormat: body.credential?.format,
        credentialToken: body.credential?.token,
        credentialKeyId: body.credential?.keyId,
      });
      if (!stored) {
        return problem(503, "control_plane_unavailable", {
          message: "The mandate could not be persisted; none was created.",
        });
      }

      audit("agent.key_registered", tenant.tenant.userId, {
        controlPlane: "mandate.issued",
        mandateId,
        organizationId: tenant.tenant.organizationId,
        delegatedTo: body.delegatedTo,
      });

      return ok(
        {
          id: mandateId,
          status: "ACTIVE",
          principalId: body.principalId,
          delegatedTo: body.delegatedTo,
          authorityScope: body.authorityScope,
          issuedAt,
          expiresAt: body.expiresAt,
          policyVersion: candidate.policyVersion,
          revokeUrl: `/api/v1/mandates/${mandateId}/revoke`,
        },
        201
      );
    },
    { principal: tenant.tenant.organizationId, request: body }
  );
}
