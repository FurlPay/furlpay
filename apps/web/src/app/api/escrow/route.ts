import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { captureHold, createHold, listHolds, releaseHold } from "@/lib/services/escrow";
import { getAccountDurable, newTx, recordTransaction, getDevelopmentDemoAccount } from "@/lib/store";
import { verifyAgentSignature } from "@/lib/agentTrustGate";
import { authorizeAgentSpend, getAgentKey } from "@/lib/agentPolicy";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

// GET /api/escrow — list all pre-auth holds.
export async function GET() {
  return NextResponse.json({ holds: listHolds() });
}

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    cardId: z.string().min(1).max(100),
    merchant: z.string().min(1).max(200),
    amount: z.number().positive().max(100_000),
  }),
  z.object({
    action: z.literal("capture"),
    id: z.string().min(1).max(100),
    finalAmount: z.number().positive().max(100_000),
  }),
  z.object({
    action: z.literal("release"),
    id: z.string().min(1).max(100),
  }),
]);

// POST /api/escrow — create / capture / release a hold.
// body: { action: "create"|"capture"|"release", ... }
// Agent-initiated calls sign with RFC 9421 headers (@furlpay/agent-trust
// signRequest, key registered via /api/agents/keys); a present-but-invalid
// signature or tampered body is rejected before any hold mutation. Keys
// registered under an account act ON that account and are policy-gated
// (per-tx limit, daily budget, category allowlist) via agentPolicy.
export async function POST(req: NextRequest) {
  const raw = await req.text();
  let agentKeyId: string | null;
  try {
    agentKeyId = await verifyAgentSignature(req, raw);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }

  // Attribution, in order: the signing key's OWNING account (the control
  // plane — the agent acts on the account that registered it), then the
  // session user. The demo account is a DEV-ONLY fallback for unsigned/
  // anonymous requests — NEVER in production, so an escrow hold can never be
  // silently attributed to the shared demo account in prod. In production a
  // request that resolves to neither an owned key nor a session is rejected.
  const ownedKey = agentKeyId ? await getAgentKey(agentKeyId) : null;
  const claims = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const account =
    (await getAccountDurable(ownedKey?.userId)) ??
    (await getAccountDurable(claims?.sub)) ??
    getDevelopmentDemoAccount();
  if (!account) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = account.user.id;

  let parsedJson: unknown;
  try {
    parsedJson = raw ? JSON.parse(raw) : {};
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = Body.safeParse(parsedJson);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;

  if (body.action === "create") {
    // Policy gate for owned agent keys: per-tx limit, daily budget (atomic
    // cross-instance counter), category allowlist — deny is audited.
    if (ownedKey) {
      const decision = await authorizeAgentSpend({
        keyId: ownedKey.keyId,
        amountUsd: body.amount,
        category: "escrow",
      });
      if (!decision.allowed) {
        return NextResponse.json(
          { error: "agent_spend_denied", reason: decision.reason, policy: ownedKey.policy },
          { status: 403 }
        );
      }
    }
    const hold = createHold(body.cardId, body.merchant, body.amount);
    recordTransaction(
      userId,
      newTx({
        category: "card",
        direction: "out",
        title: body.merchant,
        subtitle: agentKeyId ? `Pre-auth hold · escrow contract · agent ${agentKeyId}` : "Pre-auth hold · escrow contract",
        amountUsd: body.amount,
        cardId: body.cardId,
        status: "escrow",
      })
    );
    return NextResponse.json({ hold, agentKeyId });
  }

  if (body.action === "capture") {
    let hold;
    try {
      hold = captureHold(body.id, body.finalAmount);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 409 });
    }
    const refund = hold.authorizedAmount - (hold.capturedAmount ?? 0);
    recordTransaction(
      userId,
      newTx({
        category: "card",
        direction: "out",
        title: hold.merchant,
        subtitle: `Captured $${hold.capturedAmount?.toFixed(2)} · $${refund.toFixed(2)} returned to Safe`,
        amountUsd: hold.capturedAmount ?? 0,
        cardId: hold.cardId,
        status: "settled",
      })
    );
    return NextResponse.json({ hold, refundedToSafe: refund });
  }

  if (body.action === "release") {
    let hold;
    try {
      hold = releaseHold(body.id);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 409 });
    }
    return NextResponse.json({ hold, refundedToSafe: hold.authorizedAmount });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
