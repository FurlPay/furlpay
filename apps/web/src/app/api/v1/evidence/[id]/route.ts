import { NextRequest } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { requireTenant, ok, notFound } from "@/lib/controlPlane/tenancy";
import { findEvidence, loadEvidenceChain } from "@/lib/controlPlane/store";
import { evidenceLeafHash, verifyEvidenceChain, type EvidenceBundle } from "@furlpay/control-plane";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET /api/v1/evidence/:id — why was this payment allowed?
//
// THE RESPONSE IS VERIFIABLE BY THE READER, not merely asserted by us. It
// carries the bundle, the stored leaf hash, and the hash RECOMPUTED from that
// bundle right now. A reader compares the two themselves; if they differ the
// record was altered after it was written, and they learn that from arithmetic
// rather than from our say-so.
//
// The chain verdict is included for the same reason: a single intact record
// proves nothing if the record before it was deleted, so the response reports
// whether this organization's chain is contiguous and correctly linked.
//
// NO KEY MATERIAL, BY CONSTRUCTION. The bundle stores hashes and identifiers —
// `payloadHash`, `signingKeyId`, `hardwareBacked` — never a key, a signature or
// a provider secret. Evidence is meant to be handed to an auditor.
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const limited = await rateLimitOr429(req, "v1.evidence.read", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const tenant = await requireTenant(req, "ledger:read");
  if (!tenant.ok) return tenant.res;

  const { id } = await ctx.params;
  const record = await findEvidence(tenant.tenant.organizationId, id);
  if (!record) return notFound("evidence record");

  const bundle = record.bundle as EvidenceBundle;

  // Recomputed HERE, from the stored bundle. If somebody edited the bundle the
  // recomputation no longer matches the hash that was written alongside it.
  let recomputed: string | null = null;
  try {
    recomputed = evidenceLeafHash(bundle);
  } catch {
    // A bundle that cannot even be hashed is itself a tampering signal, and
    // saying so is more useful than a 500.
    recomputed = null;
  }
  const intact = recomputed !== null && recomputed === record.leaf_hash;

  const links = await loadEvidenceChain(tenant.tenant.organizationId);
  const chain = links ? verifyEvidenceChain(links) : null;

  return ok({
    id: record.id,
    authorizationId: record.authorization_id,
    sequence: Number(record.sequence),
    createdAt: record.created_at,

    // The tamper check, stated as three separate facts so a reader can see
    // which one failed rather than being handed a boolean.
    integrity: {
      storedLeafHash: record.leaf_hash,
      recomputedLeafHash: recomputed,
      intact,
      previousLeafHash: record.previous_leaf_hash,
      ...(record.merkle_root ? { merkleRoot: record.merkle_root } : {}),
    },

    // Whether the chain around this record is whole. A single intact record
    // proves nothing if its predecessor was removed.
    chain: chain
      ? chain.ok
        ? { verified: true, length: chain.length }
        : { verified: false, reason: chain.reason, atSequence: chain.atSequence, detail: chain.detail }
      : { verified: false, reason: "chain_unavailable" },

    // The answer to the question. Every input the decision relied on.
    why: {
      verdict: bundle.policy?.verdict,
      checks: bundle.policy?.checks,
      evaluatedPolicies: bundle.policy?.evaluatedPolicies,
      driftScore: bundle.policy?.driftScore,
      driftSignals: bundle.policy?.driftSignals,
      requiresApproval: bundle.policy?.requiresApproval,
      mandate: bundle.intent,
      delegationChain: bundle.delegation,
      revocationState: bundle.revocation,
      recipient: bundle.recipient,
      approval: bundle.approval,
      route: bundle.route,
      settlement: bundle.settlement,
      ledger: bundle.ledger,
      amount: bundle.amountAtomic,
      asset: bundle.asset,
      decidedAt: bundle.decidedAt,
    },
  });
}
