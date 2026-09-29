import { NextRequest } from "next/server";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { withIdempotency } from "@/lib/idempotency";
import { log } from "@/lib/log";
import { requireTenant, ok, notFound, problem } from "@/lib/controlPlane/tenancy";
import { executionPayloadHash } from "@/lib/controlPlane/authorize";
import { revocationLookup } from "@/lib/controlPlane/revocationAdapter";
import { checkRecipient } from "@/lib/controlPlane/recipientStore";
import { railAdapterFor, submitToRail } from "@/lib/controlPlane/railAdapter";
import {
  findAuthorization,
  findMandate,
  loadChain,
  recordExecutionAttempt,
  transitionAuthorization,
} from "@/lib/controlPlane/store";
import {
  applyPhaseEvent,
  evaluateRevocation,
  mandateLiveness,
  resolveAuthority,
  subjectsForPayment,
  evaluateRailCapability,
  authorizeFailover,
  RAIL_MATRIX,
  DEFAULT_MAX_STALENESS_MS,
  LifecycleError,
  type LifecycleRecord,
} from "@furlpay/control-plane";
import { financialEnvironment } from "@/lib/flags";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /api/v1/payments/execute — the second act, which re-checks everything.
//
// THE PREMISE: AN AUTHORIZATION IS A STATEMENT ABOUT A MOMENT. It was true when
// it was made. Between then and now the mandate may have been revoked, the
// employee behind the delegation may have been deprovisioned, the kill switch
// may have been pulled, the mandate may have expired. A signature that verifies
// is not evidence that the authority behind it still exists, and neither is a
// decision record.
//
// So this route re-runs the chain, the revocation check and the mandate
// liveness check BEFORE anything is submitted. That is not belt-and-braces; it
// is the only thing standing between "authorize, revoke, execute" and a payment
// the principal cancelled.
//
// THE THREE THINGS IT MUST NEVER DO:
//
//   1. WIDEN AUTHORITY. The rail is compared against the authorization's rail.
//      A request naming a different one is refused, not accommodated — a rail
//      outage does not change what was authorized.
//   2. EXECUTE A DIFFERENT PAYLOAD. The payload hash is recomputed from THIS
//      request and compared to the one recorded at authorization. Altering the
//      amount or the recipient afterwards produces a different hash.
//   3. TREAT UNKNOWN AS SETTLED. Submission is recorded as SUBMITTED, never as
//      SETTLED. Only authoritative settlement confirmation moves it, and that
//      arrives through the rail's own status path.
// ---------------------------------------------------------------------------

const Body = z
  .object({
    authorizationId: z.string().min(1).max(128),
    /** Echoed from the authorize response. Binds this call to that decision. */
    payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
    /** Must equal the authorized rail. Present so a mismatch is explicit. */
    rail: z.string().min(1).max(64),
  })
  .strict();

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "v1.payments.execute", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const tenant = await requireTenant(req, "payments:create");
  if (!tenant.ok) return tenant.res;

  const body = await validateBody(req, Body);
  if (body instanceof Response) return body;

  return withIdempotency(
    req.headers.get("idempotency-key"),
    "v1.payments.execute",
    async () => {
      const org = tenant.tenant.organizationId;

      // Tenant-scoped: another organization's authorization is not found.
      const auth = await findAuthorization(org, body.authorizationId);
      if (!auth) return notFound("payment");

      // ── 1. The decision must permit execution at all ────────────────────
      //
      // DENIED and HOLD are not executable. PENDING_APPROVAL is not executable
      // either: that is precisely the state in which a human has not answered,
      // and executing from it would make the approval decorative.
      if (auth.verdict !== "ALLOW") {
        return problem(409, "not_authorized", {
          phase: auth.phase,
          decision: auth.verdict,
          message:
            auth.verdict === "HOLD"
              ? "This payment is held and requires a human decision before it can execute."
              : "This payment was denied.",
          reason: auth.primary_reason,
        });
      }
      if (auth.phase !== "AUTHORIZED" && auth.phase !== "APPROVED") {
        return problem(409, "wrong_phase", {
          phase: auth.phase,
          message: `A payment in phase ${auth.phase} cannot be executed.`,
        });
      }

      // ── 2. The authorization must not have expired ──────────────────────
      if (Date.parse(auth.expires_at) <= Date.now()) {
        await transitionAuthorization({
          organizationId: org,
          authorizationId: auth.id,
          from: auth.phase,
          to: "EXPIRED",
        });
        return problem(409, "authorization_expired", {
          expiresAt: auth.expires_at,
          message: "This authorization expired. Request a new one.",
        });
      }

      // ── 3. The payload must be the authorized one ───────────────────────
      //
      // Recomputed from the STORED authorization, then compared to what the
      // caller echoed. A caller who altered anything holds a hash that no longer
      // matches, and a caller who simply replays the right one proves they are
      // executing the payment that was actually decided.
      const expected = executionPayloadHash({
        organizationId: org,
        mandateId: auth.mandate_id,
        agentId: auth.agent_id,
        amountAtomic: String(auth.amount_atomic),
        asset: auth.asset,
        networkId: auth.network_id,
        railId: auth.rail_id,
        recipientId: auth.recipient_id,
        recipientDestination: auth.recipient_destination ?? undefined,
        resource: auth.resource ?? undefined,
      });
      if (expected !== auth.payload_hash || body.payloadHash !== expected) {
        return problem(409, "payload_mismatch", {
          message:
            "The execution payload does not match the authorized one. Re-authorize rather than " +
            "executing a payment that was not the one decided.",
        });
      }

      // ── 4. The rail must be the authorized rail ─────────────────────────
      //
      // THE ROUTER MAY NARROW, NEVER WIDEN. `authorizeFailover` defaults to
      // refusing, so an unauthorized rail cannot be reached even when the
      // authorized one is unavailable. A rail outage is a failed payment, not a
      // different payment.
      if (body.rail !== auth.rail_id) {
        const failover = authorizeFailover({
          policy: undefined, // no cross-rail fallback was authorized
          allowedRails: [auth.rail_id],
          failedRailId: auth.rail_id,
        });
        return problem(409, "rail_not_authorized", {
          authorizedRail: auth.rail_id,
          requestedRail: body.rail,
          message: failover.permitted
            ? "This rail is not the authorized one."
            : `This payment authorized ${auth.rail_id}. ${failover.reason}`,
        });
      }

      // ── 5. Production access for the rail, re-checked ───────────────────
      const capability = evaluateRailCapability(RAIL_MATRIX, {
        railId: auth.rail_id,
        asset: auth.asset,
        networkId: auth.network_id,
        currency: auth.currency,
        amountAtomic: String(auth.amount_atomic),
        environment: tenant.tenant.environment,
        presentCredentials: Object.keys(process.env).filter((k) =>
          ["FACILITATOR_EVM_ADDRESS", "FURLPAY_KMS_PROVIDER", "X402_QUOTE_SECRET"].includes(k)
        ),
      });
      if (!capability.eligible) {
        return problem(422, "rail_unavailable", {
          rail: auth.rail_id,
          reason: capability.reason,
          message: capability.detail,
        });
      }

      // ── 6. THE RACE: re-resolve the chain and re-check revocation ───────
      //
      // This is the check that catches "authorize, revoke, execute". Nothing
      // above would notice: the decision record still says ALLOW.
      const chain = await loadChain({
        organizationId: org,
        agentId: auth.agent_id,
      });
      if (!chain) {
        return problem(503, "control_plane_unavailable", {
          message: "Chain store unavailable; execution refused.",
        });
      }
      const nowMs = Date.now();
      const authority = resolveAuthority({
        principal: chain.principal,
        delegation: chain.delegation,
        operator: chain.operator,
        agent: chain.agent,
        session: chain.session,
        nowMs,
        requireVerifiedPrincipal: financialEnvironment() === "production",
      });
      if (!authority.ok) {
        await failAttempt(org, auth.id, auth.rail_id, `chain_broken:${authority.break}`);
        return problem(409, "authority_revoked", {
          reason: authority.break,
          message: `The authority behind this payment is no longer intact: ${authority.detail}`,
        });
      }

      const mandate = await findMandate(org, auth.mandate_id);
      if (!mandate) {
        await failAttempt(org, auth.id, auth.rail_id, "mandate_missing");
        return problem(409, "authority_revoked", { message: "The mandate no longer exists." });
      }
      const liveness = mandateLiveness(mandate, nowMs);
      if (!liveness.live) {
        await failAttempt(org, auth.id, auth.rail_id, `mandate_${liveness.reason}`);
        return problem(409, "authority_revoked", {
          reason: liveness.reason,
          message: `The mandate is no longer live: ${liveness.detail}`,
        });
      }

      const revocation = evaluateRevocation({
        lookup: await revocationLookup(org),
        subjects: subjectsForPayment({
          organizationId: org,
          principalId: authority.authority.principalId,
          delegationId: authority.authority.delegationId,
          operatorId: authority.authority.operatorId,
          agentId: authority.authority.agentId,
          sessionId: authority.authority.sessionId,
          mandateId: mandate.mandateId,
          recipientId: auth.recipient_id,
        }),
        organizationId: org,
        nowMs,
        maxStalenessMs: DEFAULT_MAX_STALENESS_MS,
      });
      if (!revocation.live) {
        await failAttempt(org, auth.id, auth.rail_id, `revocation_${revocation.reason}`);
        return problem(409, "authority_revoked", {
          reason: revocation.reason,
          message: revocation.detail,
        });
      }

      // ── 6b. THE OTHER RACE: is the DESTINATION still attested? ───────────
      //
      // The revocation check above asks whether the recipient as a SUBJECT was
      // revoked. That is a different question from whether the specific address
      // this payment will pay is still attested, and only the second one catches
      // the sequence that matters here:
      //
      //     authorize  →  operator discovers the address is wrong / compromised
      //                   and revokes that attestation  →  execute
      //
      // Without this, the payment proceeds to an address the organization has
      // already said not to pay. The attestation is re-read rather than trusted
      // from the authorization row, because the row records what was true when
      // the decision was made — which is precisely what is being questioned.
      //
      // It also re-checks expiry: an attestation that lapsed between authorize
      // and execute is stale, and stale fails closed.
      const destinationStillGood = await checkRecipient({
        organizationId: org,
        recipientId: auth.recipient_id,
        destination: auth.recipient_destination ?? undefined,
        domain: auth.merchant_domain ?? undefined,
        networkId: auth.network_id,
        asset: auth.asset,
        amountAtomic: String(auth.amount_atomic),
        requireMainnet: tenant.tenant.environment === "live",
      });
      if (!destinationStillGood.ok) {
        await failAttempt(org, auth.id, auth.rail_id, `recipient_${destinationStillGood.reason}`);
        return problem(409, "recipient_no_longer_attested", {
          reason: destinationStillGood.reason,
          message:
            destinationStillGood.detail ??
            "the destination was attested when this payment was authorized and is not now",
        });
      }

      // ── 7. The lifecycle guard ──────────────────────────────────────────
      //
      // Enforces the invariant edges alone cannot: a payment that required
      // approval carries `approvalRequired` and refuses EXECUTE without a
      // recorded approver, even from a phase whose edge is legal.
      const record: LifecycleRecord = {
        phase: auth.phase as LifecycleRecord["phase"],
        approvalRequired: auth.approval_required,
        approvedAt: auth.phase === "APPROVED" ? new Date().toISOString() : undefined,
        history: [],
        updatedAt: new Date().toISOString(),
      };
      try {
        applyPhaseEvent({
          record,
          event: "EXECUTE",
          at: new Date().toISOString(),
          actor: tenant.tenant.userId,
        });
      } catch (e) {
        if (e instanceof LifecycleError) {
          return problem(409, e.code, { message: e.message });
        }
        throw e;
      }

      // Claim the transition atomically. Conditional on the current phase, so
      // two concurrent executions cannot both proceed — the loser sees the row
      // already moved and is told so rather than submitting a second payment.
      const claimed = await transitionAuthorization({
        organizationId: org,
        authorizationId: auth.id,
        from: auth.phase,
        to: "EXECUTING",
      });
      if (!claimed) {
        return problem(409, "already_executing", {
          message:
            "This payment is already being executed. Poll GET /api/v1/payments/:id rather than " +
            "submitting again.",
        });
      }

      // ── 8. Submission ───────────────────────────────────────────────────
      //
      // THE ADAPTER FOR THE AUTHORIZED RAIL, AND ONLY THAT RAIL. There is
      // deliberately no search for a healthy alternative: `authorizeFailover`
      // already refused a different rail at step 4, and looking one up here
      // would reintroduce exactly the widening that check exists to prevent.
      const adapter = railAdapterFor(auth.rail_id);

      if (!adapter) {
        // NOT CONNECTED. No rail in RAIL_MATRIX has `access: "live"` and nothing
        // registers an adapter in production. Submitting here would have to
        // fabricate a settlement reference, which is the single thing this audit
        // refuses to do.
        //
        // Left in EXECUTING with the attempt recorded INDETERMINATE —
        // deliberately, because that is the honest state: the system was asked
        // to move money and cannot. It is NOT moved to FAILED, because "failed"
        // would assert something we did not observe.
        await recordExecutionAttempt({
          organizationId: org,
          authorizationId: auth.id,
          attempt: 1,
          railId: auth.rail_id,
          state: "INDETERMINATE",
          failureReason: "no_connected_rail",
          railStatus: "rail adapter not connected to a provider",
        });

        log.warn("execution requested with no connected rail", {
          authorizationId: auth.id,
          organizationId: org,
          rail: auth.rail_id,
        });

        return problem(503, "rail_not_connected", {
          authorizationId: auth.id,
          rail: auth.rail_id,
          phase: "EXECUTING",
          state: "INDETERMINATE",
          message:
            "The authorization is valid and was claimed for execution, but no rail adapter is " +
            "connected to a provider. No value moved and no settlement reference was created. " +
            "This payment is visible in cp_indeterminate_executions and must be reconciled.",
        });
      }

      // The idempotency key is derived from the AUTHORIZATION, not from the
      // request, so every retry of this payment presents the same key to the
      // provider. A per-request key would make each retry a new payment at the
      // provider's end, which is how a timeout turns into a double spend.
      const outcome = await submitToRail(adapter, {
        organizationId: org,
        authorizationId: auth.id,
        railId: auth.rail_id,
        amountAtomic: String(auth.amount_atomic),
        asset: auth.asset,
        networkId: auth.network_id,
        destination: destinationStillGood.canonicalDestination ?? auth.recipient_destination ?? "",
        payloadHash: expected,
        idempotencyKey: `cpexec:${org}:${auth.id}`,
      });

      switch (outcome.kind) {
        case "SETTLED": {
          await recordExecutionAttempt({
            organizationId: org,
            authorizationId: auth.id,
            attempt: 1,
            railId: auth.rail_id,
            state: "SETTLED",
            settlementRef: outcome.settlementRef,
            feeAtomic: outcome.feeAtomic,
            confirmations: outcome.confirmations,
          });
          await transitionAuthorization({
            organizationId: org,
            authorizationId: auth.id,
            from: "EXECUTING",
            to: "SETTLED",
          });
          return ok({
            authorizationId: auth.id,
            phase: "SETTLED",
            state: "SETTLED",
            rail: auth.rail_id,
            settlementRef: outcome.settlementRef,
          });
        }

        case "PENDING": {
          // Accepted, not final. The phase stays EXECUTING: calling this SETTLED
          // because the provider accepted it is how a reversed payment gets
          // recorded as a completed one.
          await recordExecutionAttempt({
            organizationId: org,
            authorizationId: auth.id,
            attempt: 1,
            railId: auth.rail_id,
            state: "PENDING",
            railRef: outcome.railRef,
          });
          return ok({
            authorizationId: auth.id,
            phase: "EXECUTING",
            state: "PENDING",
            rail: auth.rail_id,
            railRef: outcome.railRef,
          });
        }

        case "REJECTED": {
          // AUTHORITATIVE. The provider says money did not move, so FAILED is a
          // claim we are entitled to make and the payment is safely retryable.
          await recordExecutionAttempt({
            organizationId: org,
            authorizationId: auth.id,
            attempt: 1,
            railId: auth.rail_id,
            state: "FAILED",
            failureReason: outcome.reason,
          });
          await transitionAuthorization({
            organizationId: org,
            authorizationId: auth.id,
            from: "EXECUTING",
            to: "FAILED",
          });
          return problem(502, "rail_rejected", {
            authorizationId: auth.id,
            rail: auth.rail_id,
            phase: "FAILED",
            state: "FAILED",
            reason: outcome.reason,
            message:
              "The rail rejected this payment. No value moved. This authorization is spent; " +
              "request a new one rather than retrying.",
          });
        }

        case "INDETERMINATE": {
          // WE DO NOT KNOW. The phase stays EXECUTING and is NOT moved to
          // FAILED: "failed" invites a retry, and if the submission actually
          // landed, that retry pays twice. It is also not moved to SETTLED.
          // It surfaces in cp_indeterminate_executions for reconciliation.
          //
          // There is deliberately no failover here. A rail we cannot get an
          // answer from may have taken the money; sending the same payment down
          // a second rail is the double-payment this whole design exists to
          // prevent.
          await recordExecutionAttempt({
            organizationId: org,
            authorizationId: auth.id,
            attempt: 1,
            railId: auth.rail_id,
            state: "INDETERMINATE",
            failureReason: outcome.reason,
            railRef: outcome.railRef,
          });
          log.error("rail returned an indeterminate result", {
            authorizationId: auth.id,
            organizationId: org,
            rail: auth.rail_id,
            reason: outcome.reason,
          });
          return problem(503, "rail_indeterminate", {
            authorizationId: auth.id,
            rail: auth.rail_id,
            phase: "EXECUTING",
            state: "INDETERMINATE",
            reason: outcome.reason,
            message:
              "The rail did not give a conclusive answer. This payment may or may not have " +
              "moved value. It has NOT been failed and MUST NOT be retried on another rail; " +
              "it is visible in cp_indeterminate_executions and must be reconciled.",
          });
        }
      }
    },
    { principal: tenant.tenant.organizationId, request: body }
  );
}

/** Record a refused attempt so the reason survives the request. */
async function failAttempt(
  organizationId: string,
  authorizationId: string,
  railId: string,
  reason: string
): Promise<void> {
  await recordExecutionAttempt({
    organizationId,
    authorizationId,
    attempt: 1,
    railId,
    state: "FAILED",
    failureReason: reason,
  }).catch(() => {});
}
