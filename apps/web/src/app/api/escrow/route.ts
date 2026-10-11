import { NextRequest, NextResponse } from "next/server";
import { readTextBody } from "@/lib/validate";
import { z } from "zod";
import { captureHold, createHold, listHolds, releaseHold } from "@/lib/services/escrow";
import { getAccountDurable, newTx, recordTransaction, getDevelopmentDemoAccount } from "@/lib/store";
import { verifyAgentSignature } from "@/lib/agentTrustGate";
import { authorizeAgentSpend, getAgentKey } from "@/lib/agentPolicy";
import { optionalUser } from "@/lib/authz";

// GET /api/escrow — list the CALLER's pre-auth holds. Session-attributed;
// dev-only demo fallback mirrors POST (never in production, so one user can
// never see another account's holds).
//
// WHY optionalUser AND NOT verifySession. This route used to resolve the caller
// with a bare `verifySession(req.cookies.get(SESSION_COOKIE)?.value)`, which is
// the pattern lib/authz.ts documents as silently skipping every protection
// requireUser applies. Four things were missing, and they are not cosmetic:
//
//   * the DURABLE revocation denylist — a logged-out token kept working on any
//     instance that had not processed the logout itself;
//   * the deleted-account tombstone — a deleted user's live token still acted;
//   * the account LOCK — the sharpest one, because locking is a fraud control
//     and escrow capture moves money. A locked account could still capture;
//   * `tokenFromRequest`, so the native app's `Authorization: Bearer` was not
//     read at all — a mobile caller was treated as anonymous and, outside
//     production, silently attributed to the shared demo account.
//
// optionalUser is the right primitive rather than requireUser because this route
// has a legitimate anonymous path (an agent-signed POST, and the dev demo
// fallback). It draws the distinction that matters: NO credential is anonymous,
// but a credential that is present and revoked/expired/locked/deleted is
// REJECTED rather than quietly downgraded to anonymous.
export async function GET(req: NextRequest) {
  const caller = await optionalUser(req);
  if (caller.kind === "rejected") return caller.res;
  const account =
    caller.kind === "user" ? caller.account : getDevelopmentDemoAccount();
  if (!account) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ holds: listHolds(account.user.id) });
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
  const raw = await readTextBody(req);
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
  const agentAccount = await getAccountDurable(ownedKey?.userId);

  // The agent key still takes precedence — it identifies the account that
  // registered it. The SESSION path now goes through optionalUser, so a
  // presented-but-dead credential is refused instead of falling through to the
  // demo account. See the note on GET for the four checks this restores.
  let account = agentAccount;
  if (!account) {
    const caller = await optionalUser(req);
    if (caller.kind === "rejected") return caller.res;
    account = caller.kind === "user" ? caller.account : getDevelopmentDemoAccount();
  }
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
    let hold;
    try {
      hold = createHold(userId, body.cardId, body.merchant, body.amount);
    } catch (e) {
      // 503, not 500: the hold store has no durable backend on this deployment,
      // which is a configuration state rather than a bug in the request. Reported
      // explicitly so a caller sees "not available here" instead of a hold id
      // that would silently stop existing. See EscrowDurabilityError.
      if ((e as Error).name === "EscrowDurabilityError") {
        return NextResponse.json(
          { error: "service_unavailable", detail: (e as Error).message },
          { status: 503 }
        );
      }
      throw e;
    }
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
      hold = captureHold(body.id, body.finalAmount, userId);
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
      hold = releaseHold(body.id, userId);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 409 });
    }
    return NextResponse.json({ hold, refundedToSafe: hold.authorizedAmount });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
