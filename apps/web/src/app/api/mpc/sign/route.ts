import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { authorizeAgentSpend, type AgentSpendCategory } from "@/lib/agentPolicy";
import { signDigest, turnkeyConfigured, TurnkeyError } from "@/lib/services/turnkey";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /api/mpc/sign — co-sign a digest with the server-held MPC share.
//
// THIS IS THE MONEY BOUNDARY. Everything upstream of it is a request; the
// signature it returns is spendable. So policy is enforced HERE, at the point
// of signing, and not only where the agent first asked.
//
// The distinction matters. An agent that calls /api/payments/create has its
// spend authorised at that route. But an agent holding an MPC-backed wallet can
// try to sign anything at all — a transfer the payments route never saw, on a
// chain nobody approved. Gating only the semantic endpoints leaves the raw
// signing capability ungated, which is the whole capability.
//
// THREE INDEPENDENT GATES, deliberately redundant:
//   1. The client refuses to request an out-of-policy signature (MpcSigner).
//   2. This route refuses to forward one (authorizeAgentSpend, below).
//   3. Turnkey's own enclave policy refuses to produce one.
// Any single one failing open still leaves two.
// ---------------------------------------------------------------------------

const SignSchema = z.object({
  /** Wallet account address Turnkey should sign with. */
  signWith: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  /** The FINAL 32-byte digest. The client computed it; we do not re-derive it. */
  digest: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  /**
   * What is being signed, for policy and for the audit trail.
   *
   * Advisory to THIS route — the digest is authoritative and we cannot verify
   * that these fields describe it. They exist so a spend can be priced and so a
   * support ticket can be answered, never as a substitute for the client's own
   * verification that the signature recovers to its address.
   */
  context: z.object({
    chainId: z.number().int().positive(),
    to: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    amountUsd: z.number().nonnegative().max(1_000_000),
    category: z.enum(["escrow", "travel", "transfer", "x402", "commerce"]),
  }),
  /** Set when an agent key is driving this, rather than the account owner. */
  agentKeyId: z.string().min(1).max(128).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  // Tighter than the mutating baseline: this mints signatures.
  const limited = await rateLimitOr429(req, "mpc.sign", { limit: 30, windowMs: 60_000 }, userId);
  if (limited) return limited;

  if (!turnkeyConfigured()) {
    return NextResponse.json(
      { error: "mpc_unavailable", detail: "MPC signing is not enabled on this deployment." },
      { status: 503 }
    );
  }

  const body = await validateBody(req, SignSchema);
  if (body instanceof NextResponse) return body;

  // Agent-driven signatures are subject to the agent's spend policy: per-tx
  // limit, daily budget, category allowlist, expiry, revocation. The budget
  // counter fails CLOSED, so a Redis outage stops agent spending rather than
  // silently uncapping it.
  if (body.agentKeyId) {
    const decision = await authorizeAgentSpend({
      keyId: body.agentKeyId,
      amountUsd: body.context.amountUsd,
      category: body.context.category as AgentSpendCategory,
    });
    if (!decision.allowed) {
      audit("mpc.sign_denied", userId, {
        keyId: body.agentKeyId,
        reason: decision.reason,
        chainId: body.context.chainId,
      });
      return NextResponse.json(
        { error: "policy_denied", detail: decision.reason },
        { status: 403 }
      );
    }
    // The key must belong to the caller. Without this, any signed-in user could
    // spend against another account's agent budget by naming its key id.
    if (decision.record && decision.record.userId !== userId) {
      audit("mpc.sign_denied", userId, {
        keyId: body.agentKeyId,
        reason: "key_not_owned",
      });
      return NextResponse.json({ error: "policy_denied", detail: "key_not_owned" }, { status: 403 });
    }
  }

  try {
    const signature = await signDigest({ signWith: body.signWith, digestHex: body.digest });

    audit("mpc.signed", userId, {
      keyId: body.agentKeyId ?? null,
      chainId: body.context.chainId,
      to: body.context.to,
      amountUsd: body.context.amountUsd,
      // The digest identifies the signature without revealing anything secret —
      // it is already public the moment the transaction is broadcast.
      digest: body.digest,
    });

    // Returned as-is. The client normalises v and verifies the signature
    // recovers to the address it expects; doing either here would move a check
    // to the side of the boundary it is meant to be checking.
    return NextResponse.json(
      { r: signature.r, s: signature.s, v: signature.v },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    if (e instanceof TurnkeyError) {
      // 202 means Turnkey wants another approver — a real state the UI should
      // explain, not a failure to retry.
      const status = e.status === 202 ? 202 : e.status >= 500 ? 502 : 400;
      return NextResponse.json({ error: "signing_failed", detail: e.message }, { status });
    }
    return NextResponse.json({ error: "signing_failed" }, { status: 500 });
  }
}
