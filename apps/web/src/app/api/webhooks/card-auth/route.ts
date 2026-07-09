import { NextRequest, NextResponse } from "next/server";
import { constructEvent } from "@furlpay/compliance";
import { findAccountByCard, newTx, recordTransaction } from "@/lib/store";
import { evaluateSpend } from "@/lib/services/policyEngine";
import { getUsdcBalanceWithBudget } from "@/lib/services/chainBalance";
import { createChallenge } from "@/lib/services/cardAuthChallenges";
import { sendPushToUser } from "@/lib/push";
import { kvDel, kvSet, kvSetNx } from "@/lib/kv";
import { endpointSecret } from "@/lib/webhookGuard";
import { log } from "@/lib/log";

// ---------------------------------------------------------------------------
// POST /api/webhooks/card-auth — synchronous card authorization (JIT funding
// + 3DS2 delegated decisioning). The issuer (Stripe Issuing / Marqeta) POSTs
// when a card is swiped and we must answer IN THE RESPONSE within ~2s:
// approve/decline endpoints are deprecated at Stripe, and Marqeta treats a
// slow gateway as a timeout and applies its default action.
//
// Decision pipeline (fail closed, zero decline fees ever charged to the user):
//   1. HMAC signature + timestamp verification (constructEvent)
//   2. Cross-instance idempotency via the kv layer (redelivery-safe)
//   3. Card credential checks (CVC / expiry mismatches → decline)
//   4. Off-chain policy engine: frozen / limits / velocity / MCC / sanctions
//   5. LIVE USDC balance on Arbitrum (time-budgeted; ledger fallback) — the
//      "smart balance check" that declines before the network ever charges a
//      decline fee, instead of RedotPay's $0.50-after-3 model
//   6. Risk step-up: high-value or risky-MCC spend → 3DS2 OOB challenge:
//      register challenge, push "Approve $X at MERCHANT?" to the user's
//      devices, answer challenge_required — the app resolves it with a
//      passkey (biometric) assertion at /api/cards/challenges/verify.
//   7. Otherwise approve and record the transaction.
// ---------------------------------------------------------------------------

/** Step-up threshold — frictionless below, biometric OOB challenge at/above. */
const CHALLENGE_THRESHOLD_USD = Number(process.env.FURLPAY_3DS_CHALLENGE_USD || 50);
/** MCCs that always step-up regardless of amount (money transfer, securities,
 *  direct marketing, dating — common first-fraud categories). Hard-blocked
 *  MCCs (gambling 7995, quasi-cash 6051) are rejected by the policy engine. */
const CHALLENGE_MCCS = new Set(["4829", "6211", "5967", "7273"]);

const EVENT_TTL_SECONDS = 24 * 3600;

interface InboundAuthorization {
  id: string;
  amountUsd: number;
  currency: string;
  cardId: string;
  merchant: { name: string; city?: string; country?: string; mcc?: string };
  verification: {
    cvcCheck?: string;
    expiryCheck?: string;
    addressLine1Check?: string;
    addressZipCheck?: string;
  };
}

/** Normalize either a Furlpay envelope ({type:"authorization.request", data})
 *  or a raw Stripe-Issuing-shaped `issuing.authorization` object. */
function normalize(payload: any): InboundAuthorization | null {
  if (payload?.object === "issuing.authorization") {
    if (typeof payload.amount !== "number" || !payload.card?.id) return null;
    return {
      id: String(payload.id),
      amountUsd: payload.amount / 100, // issuer amounts are in minor units
      currency: String(payload.currency || "usd").toUpperCase(),
      cardId: String(payload.card.id),
      merchant: {
        name: String(payload.merchant_data?.name || "Unknown merchant"),
        city: payload.merchant_data?.city,
        country: payload.merchant_data?.country,
        mcc: payload.merchant_data?.mcc,
      },
      verification: {
        cvcCheck: payload.verification_data?.cvc_check,
        expiryCheck: payload.verification_data?.expiry_check,
        addressLine1Check: payload.verification_data?.address_line1_check,
        addressZipCheck: payload.verification_data?.address_zip_check,
      },
    };
  }
  if (payload?.type === "authorization.request" && payload.data) {
    const d = payload.data;
    if (typeof d.amountUsd !== "number" || !d.cardId) return null;
    return {
      id: String(payload.id),
      amountUsd: d.amountUsd,
      currency: String(d.currency || "USD").toUpperCase(),
      cardId: String(d.cardId),
      merchant: { name: String(d.merchant || "Unknown merchant"), mcc: d.mcc, city: d.city, country: d.country },
      verification: d.verification ?? {},
    };
  }
  return null;
}

function decline(auth: InboundAuthorization, reason: string) {
  // decline_fee is part of the contract: FurlPay absorbs network decline
  // costs — the cardholder is never charged, at any decline count.
  return NextResponse.json({
    approved: false,
    decline_reason: reason,
    decline_fee: 0,
    jit_funding: { token: auth.id, method: "pgfs.authorization", approved: false, amount: auth.amountUsd },
  });
}

export async function POST(req: NextRequest) {
  const started = Date.now();
  const body = await req.text();

  const secret = endpointSecret(process.env.FURLPAY_CARDAUTH_ENDPOINT_SECRET, "whsec_sandbox_cardauth");
  if (!secret) {
    return NextResponse.json({ error: "webhook_secret_unconfigured" }, { status: 503 });
  }

  let payload: any;
  try {
    payload = constructEvent<any>(body, req.headers.get("furlpay-signature"), secret);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  const auth = normalize(payload);
  if (!auth) {
    return NextResponse.json({ error: "unsupported_payload" }, { status: 400 });
  }

  // Idempotency across serverless instances: first delivery wins; concurrent
  // or repeated deliveries ack as duplicates without re-running side effects.
  const evtKey = `cardauth:evt:${auth.id}`;
  if (!(await kvSetNx(evtKey, "processing", EVENT_TTL_SECONDS))) {
    return NextResponse.json({ received: true, deduped: true });
  }

  try {
    // Durable owner lookup — the swiping user's account may live on another
    // instance; the cards.user_id index resolves it cross-instance.
    const owned = await findAccountByCard(auth.cardId);
    if (!owned) {
      await kvSet(evtKey, "processed", EVENT_TTL_SECONDS);
      return decline(auth, "unknown_card");
    }
    const { account, card } = owned;
    const user = account.user;

    // 3. Credential verification — a wrong CVC or expiry is either a typo or
    // an enumeration attack; never fund it.
    if (auth.verification.cvcCheck === "mismatch" || auth.verification.expiryCheck === "mismatch") {
      await kvSet(evtKey, "processed", EVENT_TTL_SECONDS);
      return decline(auth, "suspected_fraud_cvc_expiry_mismatch");
    }

    // 4. Off-chain policy engine (frozen / per-purchase / daily / velocity /
    // MCC blocklist / sanctions).
    const policy = evaluateSpend({
      card,
      amountUsd: auth.amountUsd,
      mcc: auth.merchant.mcc,
      transactions: account.transactions,
    });
    if (!policy.approved) {
      await kvSet(evtKey, "processed", EVENT_TTL_SECONDS);
      recordTransaction(
        user.id,
        newTx({
          category: "card",
          direction: "out",
          title: auth.merchant.name,
          subtitle: `${card.label} · ${card.network}`,
          amountUsd: auth.amountUsd,
          cardId: card.id,
          status: "declined",
        })
      );
      return decline(auth, policy.reasons[0] ?? "policy_declined");
    }

    // 5. Live balance check, inside the issuer's 2s budget. A card purchase
    // can settle from the user's stablecoin (verified LIVE on Arbitrum — the
    // internal ledger is only the fallback when the RPC is down/slow) plus
    // their fiat balances. Declining HERE (before the card network settles
    // anything) is what makes the zero-decline-fee guarantee affordable.
    const stableLedgerUsd = account.tokenBalances.reduce((sum, b) => sum + b.usdValue, 0);
    const fiatUsd = account.fiatBalances.reduce((sum, b) => sum + b.usdValue, 0);
    const chainBalance = await getUsdcBalanceWithBudget(user.safeAddress, stableLedgerUsd, 1200);
    // The live chain number is authoritative for the stablecoin leg — a demo
    // ledger can claim $4k, but if the Safe holds $0 the card can only lean
    // on fiat. (Demo accounts have undeployed Safes, so fiat carries them.)
    const spendableUsd = chainBalance.balanceUsd + fiatUsd;
    if (spendableUsd < auth.amountUsd) {
      await kvSet(evtKey, "processed", EVENT_TTL_SECONDS);
      return decline(auth, "insufficient_funds_on_chain");
    }

    // 6. Risk step-up → 3DS2 out-of-band biometric challenge.
    const stepUp =
      auth.amountUsd >= CHALLENGE_THRESHOLD_USD ||
      (auth.merchant.mcc ? CHALLENGE_MCCS.has(auth.merchant.mcc) : false);

    if (stepUp) {
      const challenge = await createChallenge({
        authorizationId: auth.id,
        userId: user.id,
        cardId: card.id,
        amountUsd: auth.amountUsd,
        currency: auth.currency,
        merchant: auth.merchant,
      });

      const devices = await sendPushToUser(user.id, {
        title: "Approve card transaction",
        body: `Approve payment of $${auth.amountUsd.toFixed(2)} to ${auth.merchant.name}?`,
        url: `/cards/approve?challenge=${challenge.id}`,
        tag: challenge.id,
        data: { challengeId: challenge.id, kind: "card-auth-challenge" },
      });

      log.info("3DS2 OOB challenge dispatched", {
        challengeId: challenge.id,
        authorizationId: auth.id,
        devices,
        elapsedMs: Date.now() - started,
      });

      await kvSet(evtKey, "processed", EVENT_TTL_SECONDS);
      return NextResponse.json({
        approved: false,
        challenge_required: true,
        challenge_method: "app_push_biometric",
        challenge_id: challenge.id,
        challenge_expires_at: challenge.expiresAt,
        three_ds_authentication: {
          result: "challenge",
          acs_rendering: "oob",
          oob_app_url: `/cards/approve?challenge=${challenge.id}`,
        },
      });
    }

    // 7. Frictionless approval.
    card.limits.dailySpent += auth.amountUsd;
    recordTransaction(
      user.id,
      newTx({
        category: "card",
        direction: "out",
        title: auth.merchant.name,
        subtitle: `${card.label} · ${card.network}`,
        amountUsd: auth.amountUsd,
        cardId: card.id,
        status: "settled",
      })
    );

    await kvSet(evtKey, "processed", EVENT_TTL_SECONDS);
    log.info("card authorization approved", {
      authorizationId: auth.id,
      amountUsd: auth.amountUsd,
      balanceSource: chainBalance.source,
      elapsedMs: Date.now() - started,
    });
    return NextResponse.json({
      approved: true,
      jit_funding: {
        token: auth.id,
        method: "pgfs.authorization",
        user_token: user.id,
        approved: true,
        amount: auth.amountUsd,
      },
    });
  } catch (e) {
    // Release the event id so the issuer's redelivery is re-processed, and
    // 500 so it actually redelivers.
    await kvDel(evtKey);
    log.error("card-auth webhook failed", { error: (e as Error).message });
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }
}
