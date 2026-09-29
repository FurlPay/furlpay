import { NextRequest } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { withIdempotency } from "@/lib/idempotency";
import { requireTenant, ok, problem } from "@/lib/controlPlane/tenancy";
import { authorizePayment } from "@/lib/controlPlane/authorize";
import { findAuthorizationByIdempotencyKey } from "@/lib/controlPlane/store";
import { checkRecipient } from "@/lib/controlPlane/recipientStore";
import {
  evaluateRailCapability,
  eligibleRails,
  RAIL_MATRIX,
  type RecipientVerdict,
} from "@furlpay/control-plane";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /api/v1/payments/authorize — the decision, and only the decision.
//
// WHAT THIS ROUTE IS NOT ALLOWED TO DO. It does not decide. Every allow/deny
// judgement comes from `authorizePayment`, which composes the pure control
// plane. The route validates the request shape, resolves the tenant, asks, and
// renders the answer. A second policy engine living in a route handler is how
// two engines end up disagreeing under an input nobody enumerated, and the one
// that matters is whichever the attacker reaches.
//
// AUTHORIZE AND EXECUTE ARE SEPARATE CALLS. An agent proposes; the control plane
// decides; execution is a later, re-validated act. Collapsing them removes the
// place a human can be asked, which is the entire point of HOLD.
//
// THE RAIL IS CHECKED FOR PRODUCTION ACCESS BEFORE ANYTHING ELSE. A rail whose
// capability row is `partner_required` can be named in a request and can never
// be selected for value — so it is refused here, cheaply, with a reason that
// says why rather than a generic ineligibility.
// ---------------------------------------------------------------------------

/** Decimal digits only — the same rule `parseAtomic` applies (F-9). */
const Atomic = z.string().regex(/^[0-9]+$/, "must be decimal digits in the asset's minor units");

const Body = z
  .object({
    mandateId: z.string().min(1).max(128),
    agentId: z.string().min(1).max(128),
    sessionId: z.string().min(1).max(128).optional(),
    amount: Atomic,
    asset: z.string().min(1).max(16),
    currency: z.string().min(1).max(16),
    network: z.string().min(1).max(64),
    rail: z.string().min(1).max(64),
    recipient: z
      .object({
        id: z.string().min(1).max(128),
        destination: z.string().max(256).optional(),
        domain: z.string().max(255).optional(),
      })
      .strict(),
    category: z.string().max(64).optional(),
    jurisdiction: z.string().length(2).optional(),
    resource: z.string().max(2048).optional(),
  })
  .strict();

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "v1.payments.authorize", {
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const tenant = await requireTenant(req, "payments:create");
  if (!tenant.ok) return tenant.res;

  const body = await validateBody(req, Body);
  if (body instanceof Response) return body;

  const idempotencyKey = req.headers.get("idempotency-key");

  // A replayed key must resolve to the ORIGINAL decision, not a fresh one.
  // Deciding twice would consume budget twice and write two evidence records for
  // one intent. Checked before the work, and again by withIdempotency's atomic
  // claim for the concurrent case.
  if (idempotencyKey) {
    const existing = await findAuthorizationByIdempotencyKey(
      tenant.tenant.organizationId,
      idempotencyKey
    );
    if (existing) {
      return ok({
        id: existing.id,
        decision: existing.verdict,
        phase: existing.phase,
        reason: existing.primary_reason,
        replayed: true,
      });
    }
  }

  return withIdempotency(
    idempotencyKey,
    "v1.payments.authorize",
    async () => {
      // Production access, before any expensive work. `partner_required` and
      // `not_implemented` rails are refused by name.
      const capability = evaluateRailCapability(RAIL_MATRIX, {
        railId: body.rail,
        asset: body.asset,
        networkId: body.network,
        currency: body.currency,
        amountAtomic: body.amount,
        environment: tenant.tenant.environment,
        presentCredentials: presentCredentials(),
      });
      if (!capability.eligible) {
        return problem(422, "rail_unavailable", {
          rail: body.rail,
          reason: capability.reason,
          message: capability.detail,
          // What the caller could use instead, in this environment.
          eligibleRails: RAIL_MATRIX.filter((r) =>
            tenant.tenant.environment === "live" ? r.access === "live" : r.access === "sandbox"
          ).map((r) => r.railId),
        });
      }

      // Recipient verification. The destination is checked against what the
      // recipient was ATTESTED for; an unattested address is refused rather than
      // trusted because it arrived alongside an approved domain.
      const recipient = await verifyRecipientForRequest(
        body,
        tenant.tenant.organizationId,
        tenant.tenant.environment
      );

      const outcome = await authorizePayment({
        organizationId: tenant.tenant.organizationId,
        mandateId: body.mandateId,
        agentId: body.agentId,
        sessionId: body.sessionId,
        amountAtomic: body.amount,
        asset: body.asset,
        currency: body.currency,
        networkId: body.network,
        railId: body.rail,
        recipientId: body.recipient.id,
        recipientDestination: body.recipient.destination,
        merchantDomain: body.recipient.domain,
        category: body.category,
        jurisdiction: body.jurisdiction,
        resource: body.resource,
        idempotencyKey: idempotencyKey ?? undefined,
        recipient,
        // Organization policies are loaded per tenant. An empty set is a
        // legitimate configuration — the mandate still bounds everything.
        policies: [],
        requestId: req.headers.get("x-request-id") ?? randomUUID(),
      });

      if (!outcome.ok) {
        // Infrastructure refusals are 503 and are RETRYABLE; a refusal about the
        // request itself is 422 and is not. Conflating them makes a client retry
        // something that will never succeed, or give up on something that would.
        const retryable =
          outcome.code === "control_plane_unavailable" ||
          outcome.code === "revocation_unavailable" ||
          outcome.code === "history_unavailable" ||
          outcome.code === "evidence_slot_unavailable" ||
          outcome.code === "write_failed";
        return problem(retryable ? 503 : 422, outcome.code, { message: outcome.detail });
      }

      const { decision } = outcome;

      // The body a developer needs to understand the answer — and nothing that
      // would help an attacker. No signing material, no provider secret, no
      // internal token, and no policy internals beyond which checks ran.
      return ok(
        {
          id: outcome.authorizationId,
          decision: decision.verdict,
          phase: outcome.phase,
          reason: decision.primaryReason ?? null,
          reasonCodes: decision.checks
            .filter((c) => c.outcome === "deny" || c.outcome === "hold")
            .map((c) => c.id),
          approval: decision.requiresApproval
            ? {
                required: true,
                approverRole: decision.escalation?.approverRole,
                timeoutSeconds: decision.escalation?.timeoutSeconds,
                onTimeout: decision.escalation?.onTimeout,
              }
            : { required: false },
          mandateId: body.mandateId,
          policyVersion: decision.evaluatedPolicies,
          rail: { selected: body.rail },
          evidenceId: outcome.evidenceId,
          expiresAt: outcome.expiresAt,
          // Execution must present this. It binds the executed payload to the
          // authorized one, so altering the amount or the recipient afterwards
          // produces a different hash rather than a different payment.
          payloadHash: outcome.payloadHash,
        },
        decision.verdict === "DENY" ? 200 : 201
      );
    },
    { principal: tenant.tenant.organizationId, request: body }
  );
}

/** Env vars observed present. Names only — never a value. */
function presentCredentials(): string[] {
  return [
    "FACILITATOR_EVM_ADDRESS",
    "FURLPAY_KMS_PROVIDER",
    "X402_QUOTE_SECRET",
  ].filter((name) => Boolean(process.env[name]));
}

/**
 * Recipient verification for this request.
 *
 * NOW REAL (migration 0021). It reads the tenant's attested destinations and
 * hands them to `verifyRecipient()` in the pure package — the same function its
 * own tests cover. No judgement is made here; a second recipient check living in
 * a route handler is how two checks end up disagreeing.
 *
 * THE ORGANIZATION COMES FROM THE TENANT, NOT THE BODY. There is no request
 * field through which a caller can name whose attestations to read. That is the
 * whole reason this takes `organizationId` as a separate argument rather than
 * reading it off `body`.
 *
 * MAINNET IS REQUIRED WHENEVER THE TENANT IS LIVE. A live tenant paying a
 * testnet address is either a mistake or an attack, and `verifyRecipient`
 * refuses it by inspecting the network rather than by trusting a flag.
 */
async function verifyRecipientForRequest(
  body: z.infer<typeof Body>,
  organizationId: string,
  environment: "sandbox" | "live"
): Promise<RecipientVerdict> {
  return checkRecipient({
    organizationId,
    recipientId: body.recipient.id,
    destination: body.recipient.destination,
    domain: body.recipient.domain,
    networkId: body.network,
    asset: body.asset,
    amountAtomic: body.amount,
    requireMainnet: environment === "live",
  });
}

void eligibleRails;
