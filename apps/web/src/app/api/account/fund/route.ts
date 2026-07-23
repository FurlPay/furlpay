import { NextRequest, NextResponse } from "next/server";
import { settle, type FacilitatorRequest } from "@/lib/x402Facilitator";
import { PAY_TO } from "@/lib/x402";
import { creditAccount } from "@/lib/services/account";
import { optionalUser } from "@/lib/authz";
import { getAccountDurable, getDevelopmentDemoAccount } from "@/lib/store";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

// This endpoint is UNAUTHENTICATED by design ("auth IS the x402 payment"), so a
// credit must never be mintable from an attacker-supplied payload. Two guards:
//  1. The payment must be addressed to OUR treasury (PAY_TO) — the generic
//     facilitator verify() trusts the caller's paymentRequirements.payTo, so
//     without this an attacker sets payTo = their own address and self-credits.
//  2. In production the default settler is a deterministic mock that "settles"
//     any well-formed (unsigned) authorization; crediting spendable balance off
//     a mock settlement is a free-mint. Require a real on-chain settler
//     (INTEGRATION_MODE=live) before crediting in production — mirrors the
//     prod guards in lib/session.ts, lib/auth/otp.ts and lib/auth/google.ts.
const FUNDING_IS_LIVE = process.env.INTEGRATION_MODE === "live";

// POST /api/account/fund — fund a FurlPay account balance via x402. Auth IS the
// x402 payment: an agent (or app) signs a USDC authorization, we settle it
// through the facilitator, and on success credit the spendable balance. This is
// the funding half of the loop — money in via x402, then spend on travel/cards/
// payouts. Body: an x402 FacilitatorRequest { paymentPayload, paymentRequirements },
// plus optional destinationUserId when there is no session (agent funding a
// known account, like a bank deposit by account number).
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production" && !FUNDING_IS_LIVE) {
    // No real settler wired → a mock "settlement" would credit real balance for
    // free. Refuse rather than fail open.
    return NextResponse.json(
      { funded: false, error: "funding_unavailable" },
      { status: 503 }
    );
  }

  const limited = await rateLimitOr429(req, "account.fund", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  let body: FacilitatorRequest & { destinationUserId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ funded: false, error: "invalid_json" }, { status: 400 });
  }
  if (!body?.paymentPayload || !body?.paymentRequirements) {
    return NextResponse.json({ funded: false, error: "missing_fields" }, { status: 400 });
  }

  // The payment must be addressed to Furlpay's treasury, not a caller-chosen
  // address. The generic facilitator does not bind payTo server-side, so this
  // check is what makes "money in" actually mean money into our account.
  if ((body.paymentRequirements.payTo || "").toLowerCase() !== PAY_TO.toLowerCase()) {
    return NextResponse.json({ funded: false, error: "wrong_recipient" }, { status: 400 });
  }

  // Resolve WHO gets credited before settling, so we never take funds we can't
  // credit: the session user, else an explicitly named existing account (a
  // deposit by account number — worst case a payer donates to someone else),
  // else the demo account in dev only.
  // optionalUser, not a bare verifySession: this route accepts anonymous
  // deposits by account number, but a session that IS presented must be live —
  // revoked, deleted, locked and out-of-scope connector tokens are refused
  // rather than silently treated as an anonymous deposit.
  const auth = await optionalUser(req);
  if (auth.kind === "rejected") return auth.res;
  const target =
    (auth.kind === "user" ? auth.account : null) ??
    (await getAccountDurable(typeof body.destinationUserId === "string" ? body.destinationUserId : undefined)) ??
    getDevelopmentDemoAccount();
  if (!target) {
    return NextResponse.json({ funded: false, error: "unknown_destination" }, { status: 400 });
  }

  const result = await settle(body);
  if (!result.success) {
    return NextResponse.json({ funded: false, error: result.errorReason }, { status: 402 });
  }

  // The settled authorization value is atomic USDC (6 decimals).
  const atomic = body.paymentPayload.payload.authorization.value;
  const amountUsd = Number(BigInt(atomic)) / 1e6;
  const credit = creditAccount(
    target.user.id,
    amountUsd,
    `Account funded — $${amountUsd.toFixed(2)} USDC`,
    `x402 · ${result.network} · payer ${short(result.payer)}`
  );
  if (!credit.ok) {
    // Settlement succeeded but the credit failed — surface loudly; this is the
    // one path where money moved without a matching balance change.
    log.error("x402 funding settled but credit failed", { userId: target.user.id, error: credit.error, tx: result.transaction });
    return NextResponse.json({ funded: false, error: credit.error }, { status: 500 });
  }

  audit("account.funded", target.user.id, {
    amountUsd,
    network: result.network,
    payer: result.payer,
    tx: result.transaction,
  });

  return NextResponse.json({
    funded: true,
    amountUsd: amountUsd.toFixed(2),
    transaction: result.transaction,
    network: result.network,
    payer: result.payer,
    balanceUsd: credit.balanceUsd.toFixed(2),
  });
}

function short(a?: string): string {
  return a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a ?? "unknown";
}
