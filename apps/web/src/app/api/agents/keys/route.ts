import { NextRequest, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/validate";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { listAgentKeyIds, registerAgentKey } from "@/lib/agentTrustGate";
import {
  AGENT_SPEND_CATEGORIES,
  listAgentKeys,
  redactAgentKey,
  registerOwnedAgentKey,
  revokeAgentKey,
} from "@/lib/agentPolicy";
import { optionalUser, requireUser } from "@/lib/authz";

export const dynamic = "force-dynamic";

const Policy = z.object({
  perTxLimitUsd: z.number().positive().max(10_000),
  dailyBudgetUsd: z.number().positive().max(100_000),
  allowedCategories: z.array(z.enum(AGENT_SPEND_CATEGORIES)).max(AGENT_SPEND_CATEGORIES.length),
  expiresAt: z.string().datetime().optional(),
});

const RegisterBody = z.object({
  publicKeyPem: z.string().min(1).max(4_000),
  name: z.string().min(1).max(64).optional(),
  policy: Policy.optional(),
});

/** Conservative defaults: a freshly registered agent can hold small escrows
 *  and nothing else until its owner widens the policy explicitly. */
const DEFAULT_POLICY = {
  perTxLimitUsd: 50,
  dailyBudgetUsd: 200,
  allowedCategories: ["escrow"] as ("escrow")[],
};

// POST /api/agents/keys — register an agent's Ed25519 public key (SPKI PEM).
// With a session, the key is BOUND to the calling account and carries a spend
// policy (per-tx limit, daily budget, category allowlist) enforced at every
// money move. Without a session it falls back to the legacy anonymous
// registration: in-memory, this instance only, demo-account scope.
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "agents.keys", { limit: 10, windowMs: 600_000 });
  if (limited) return limited;

  const parsed = RegisterBody.safeParse(await readJsonBody(req).catch(() => null));
  if (!parsed.success || !parsed.data.publicKeyPem.includes("BEGIN PUBLIC KEY")) {
    return NextResponse.json({ error: "publicKeyPem (SPKI PEM) required" }, { status: 400 });
  }
  const { publicKeyPem, name, policy } = parsed.data;

  // A presented session must be live before it can OWN a key with a spend
  // policy; only the total absence of a credential falls through to the
  // anonymous demo path below.
  const auth = await optionalUser(req);
  if (auth.kind === "rejected") return auth.res;
  const account = auth.kind === "user" ? auth.account : null;

  try {
    if (account) {
      const record = await registerOwnedAgentKey({
        userId: account.user.id,
        name: name ?? "agent",
        publicKeyPem,
        policy: policy ?? { ...DEFAULT_POLICY },
      });
      return NextResponse.json({ keyId: record.keyId, owned: true, key: redactAgentKey(record) });
    }
    // Legacy anonymous path — kept for the public docs demo. No policy, no
    // owner: signed requests resolve to the demo account in non-prod only.
    return NextResponse.json({
      keyId: registerAgentKey(publicKeyPem),
      owned: false,
      note: "Anonymous demo key. Sign in when registering to bind the key to your account with a spend policy.",
    });
  } catch (e) {
    const message = (e as Error).message;
    const status = message.includes("another account") ? 409 : 400;
    return NextResponse.json(
      { error: status === 409 ? message : "invalid public key" },
      { status }
    );
  }
}

// GET /api/agents/keys — with a session: your keys with policies and status.
// Without: the legacy anonymous key-id list (unchanged demo behavior).
export async function GET(req: NextRequest) {
  // A reader on a route with an anonymous path gets no middleware backstop
  // (the baseline only covers mutating methods), so it carries its own budget.
  const limited = await rateLimitOr429(req, "agents.keys.read", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const auth = await optionalUser(req);
  if (auth.kind === "rejected") return auth.res;
  const account = auth.kind === "user" ? auth.account : null;
  if (account) {
    const keys = await listAgentKeys(account.user.id);
    return NextResponse.json({ keys: keys.map(redactAgentKey) });
  }
  return NextResponse.json({ keyIds: listAgentKeyIds() });
}

const RevokeBody = z.object({ keyId: z.string().min(1).max(200) });

// DELETE /api/agents/keys — revoke one of your keys. Immediate on every
// instance: verification and spend authorization both read the durable record.
export async function DELETE(req: NextRequest) {
  // Revocation has no anonymous path, so this is a plain requireUser: it also
  // gives a revoked or locked session the 401/423 it deserves instead of
  // letting it manage keys.
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const parsed = RevokeBody.safeParse(await readJsonBody(req).catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "keyId required" }, { status: 400 });

  const revoked = await revokeAgentKey(account.user.id, parsed.data.keyId);
  if (!revoked) return NextResponse.json({ error: "key not found" }, { status: 404 });
  return NextResponse.json({ revoked: true, keyId: parsed.data.keyId });
}
