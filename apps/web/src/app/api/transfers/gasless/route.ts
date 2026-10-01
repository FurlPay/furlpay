import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { requireMobileAttestation } from "@/lib/attestation";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { assertRailActive } from "@/lib/ops/controls";
import { recordTxEvent, recordSecurityEvent } from "@/lib/ops/events";
import { recordRailHealth } from "@/lib/ops/overview";
import { kvSetNx } from "@/lib/kv";
import { mockAllowed } from "@/lib/integrations";
import { NETWORK, USDC_ASSET, X402_VERSION, requiredConfirmations } from "@/lib/x402";
import { verifyAuthorizationSignature } from "@/lib/x402Signature";
import { defaultSettler, SettlementPendingError } from "@/lib/x402Settler";
import type { FacilitatorRequest } from "@/lib/x402Facilitator";
import { maxTransferUsd } from "@/lib/moneyLimits";

// ---------------------------------------------------------------------------
// Gasless USDC transfers ("Smart Gas").
//
// The user signs an EIP-3009 transferWithAuthorization off-chain for ANY
// recipient; Furlpay's fee-payer relays it on-chain and pays the gas. The user
// never needs ETH, and fees are quoted in USDC — the native token is never
// surfaced. Reuses the hardened x402 settlement machinery:
//   - signature: EIP-712 ecrecover (+ ERC-1271), fail closed in live mode
//   - replay: the EIP-3009 nonce is claimed atomically in the SAME namespace
//     as x402 payments, so one authorization can never ride both routes
//   - finality: amount-scaled confirmation depth before reporting success
//   - recovery: submitted-but-unconfirmed surfaces 202 + a status path,
//     never a false "failed"
//
// v1 fee model: the relay is sponsored (fee 0.00 USDC, ~$0.01 L2 gas absorbed).
// Charging a USDC fee requires an ERC-2771 forwarder contract that deducts it
// atomically — tracked for the contracts roadmap; do NOT bolt a second
// authorization onto this route (two txs = two failure domains).
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

const GASLESS_FEE_USD = 0;

// GET /api/transfers/gasless — Smart Gas quote. Everything the client needs
// to render a send screen with no native-token mention.
export async function GET() {
  // `live` answers "will a POST to this route actually move USDC?", and it has
  // to answer it the way the POST path does. It used to read
  // INTEGRATION_MODE === "live", which is set in production — so the quote
  // advertised `live: true` while /api/rails reported this same rail
  // NOT_CONFIGURED and the POST below returned 503 "no on-chain relayer
  // configured". Two public endpoints contradicting each other about the same
  // rail is worse than either answer alone: an integrator reads the optimistic
  // one and ships against it.
  //
  // INTEGRATION_MODE only says mocks are forbidden. The relayer is what
  // actually submits, so ask for the relayer.
  const relayerReady = defaultSettler() !== null;
  return NextResponse.json(
    {
      network: NETWORK,
      asset: { symbol: "USDC", address: USDC_ASSET, decimals: 6 },
      fee: { usd: GASLESS_FEE_USD, sponsored: true, detail: "Gas is paid by Furlpay's relayer. You only sign — no ETH needed." },
      maxPerTransferUsd: maxTransferUsd(),
      scheme: "eip3009-transfer-with-authorization",
      live: relayerReady,
      ...(relayerReady
        ? {}
        : {
            status: "not_configured",
            detail:
              "The relayer is not configured in this environment, so signed authorizations cannot be submitted. The quote shape above is stable and safe to integrate against.",
          }),
    },
    { headers: { "cache-control": "no-store" } }
  );
}

const HexAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const GaslessTransfer = z
  .object({
    signature: z.string().regex(/^0x[0-9a-fA-F]{128,130}$/),
    authorization: z
      .object({
        from: HexAddress,
        to: HexAddress,
        value: z.string().regex(/^[0-9]{1,15}$/), // atomic USDC (6dp)
        validAfter: z.string().regex(/^[0-9]{1,12}$/),
        validBefore: z.string().regex(/^[0-9]{1,12}$/),
        nonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
      })
      .strict(),
  })
  .strict();

// POST /api/transfers/gasless — relay a signed authorization on-chain.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  // Mobile clients must present a platform attestation over a fresh single-use
  // nonce when FURLPAY_ATTESTATION_MODE=enforce (lib/attestation, P1-9).
  const unattested = await requireMobileAttestation(req, auth.account.user.id, "transfer.gasless");
  if (unattested) return unattested;

  const limited = await rateLimitOr429(req, "transfers-gasless", { limit: 12, windowMs: 60_000 });
  if (limited) return limited;

  const body = await validateBody(req, GaslessTransfer);
  if (body instanceof NextResponse) return body;

  const paused = await assertRailActive("transfers");
  if (paused) return paused;

  const a = body.authorization;
  const amountUsd = Number(BigInt(a.value)) / 1e6;
  const cap = maxTransferUsd();
  if (amountUsd > cap) {
    await recordSecurityEvent({ rail: "transfers", kind: "amount_over_limit", severity: "low", detail: `gasless $${amountUsd} > $${cap}`, actor: auth.account.user.id });
    return NextResponse.json({ error: "amount_over_limit", detail: `amount exceeds the per-transfer limit ($${cap})` }, { status: 403 });
  }
  if (amountUsd <= 0) {
    return NextResponse.json({ error: "invalid_amount" }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  if (Number(a.validAfter) > now) return NextResponse.json({ error: "authorization_not_yet_valid" }, { status: 400 });
  if (Number(a.validBefore) < now) return NextResponse.json({ error: "authorization_expired" }, { status: 400 });

  // Atomic single-use claim — same namespace as x402 payments, so this nonce
  // is burned across BOTH relay routes and every serverless instance.
  const claimed = await kvSetNx(`x402:nonce:${a.nonce}`, now, 86_400);
  if (!claimed) {
    await recordSecurityEvent({ rail: "transfers", kind: "replay_rejected", severity: "medium", detail: "gasless nonce already used", actor: auth.account.user.id });
    return NextResponse.json({ error: "replay_rejected", detail: "authorization nonce already used" }, { status: 409 });
  }

  const live = process.env.INTEGRATION_MODE === "live";
  if (live) {
    const verdict = await verifyAuthorizationSignature(a, body.signature, {
      network: NETWORK,
      asset: USDC_ASSET,
      domainName: "USD Coin",
      domainVersion: "2",
    });
    if (!verdict.verified) {
      await recordSecurityEvent({ rail: "transfers", kind: "bad_signature", severity: "high", detail: `gasless ${verdict.reason}`, actor: auth.account.user.id });
      return NextResponse.json({ error: "invalid_signature", detail: verdict.reason }, { status: 400 });
    }

    const settler = defaultSettler();
    if (!settler) {
      return NextResponse.json({ error: "service_unavailable", detail: "no on-chain relayer configured" }, { status: 503 });
    }
    const facReq: FacilitatorRequest = {
      x402Version: X402_VERSION,
      paymentPayload: {
        x402Version: X402_VERSION,
        scheme: "exact",
        network: NETWORK,
        payload: { signature: body.signature, authorization: a },
      },
      paymentRequirements: {
        scheme: "exact",
        network: NETWORK,
        maxAmountRequired: a.value,
        resource: "furlpay:transfers:gasless",
        description: "gasless USDC transfer",
        mimeType: "application/json",
        payTo: a.to, // destination is inside the signed authorization
        maxTimeoutSeconds: 300,
        asset: USDC_ASSET,
        // The settler only reads network/asset; quote-binding fields are
        // meaningless for a direct transfer, so they carry inert sentinels.
        extra: { name: "USD Coin", version: "2", quoteId: `gasless_${a.nonce}`, expiresAt: Number(a.validBefore), binding: "gasless" },
      },
    };

    const required = requiredConfirmations(a.value);
    const started = Date.now();
    try {
      const submission = await settler(facReq, a.from, required);
      await recordTxEvent({ rail: "transfers", state: "settled", substate: "GASLESS_SETTLED", amountUsd, feeUsd: GASLESS_FEE_USD, token: "USDC", payer: a.from, recipient: a.to, txHash: submission.transaction, userId: auth.account.user.id });
      await recordRailHealth("transfers", "HEALTHY", undefined, Date.now() - started);
      return NextResponse.json({
        ok: true,
        transaction: submission.transaction,
        confirmations: submission.confirmations,
        network: NETWORK,
        fee: { usd: GASLESS_FEE_USD, sponsored: true },
      });
    } catch (e) {
      if (e instanceof SettlementPendingError) {
        await recordTxEvent({ rail: "transfers", state: "pending", substate: "GASLESS_PENDING", amountUsd, token: "USDC", payer: a.from, recipient: a.to, txHash: e.transaction, userId: auth.account.user.id });
        return NextResponse.json(
          { ok: false, pending: { transaction: e.transaction, statusPath: `/api/x402/settlement/${e.transaction}` } },
          { status: 202 }
        );
      }
      await recordTxEvent({ rail: "transfers", state: "failed", substate: "GASLESS_FAILED", amountUsd, token: "USDC", payer: a.from, recipient: a.to, userId: auth.account.user.id });
      await recordRailHealth("transfers", "DEGRADED", (e as Error).message);
      return NextResponse.json({ error: "relay_failed", detail: (e as Error).message }, { status: 502 });
    }
  }

  // Mock mode: full flow with a simulated receipt — but NEVER in production,
  // where a fabricated "settled" transfer would be an incident.
  if (!mockAllowed()) {
    return NextResponse.json({ error: "service_unavailable", detail: "gasless transfers are not configured on this deployment" }, { status: 503 });
  }
  const simulated = `0xsim${a.nonce.slice(2, 62)}`;
  await recordTxEvent({ rail: "transfers", state: "prepared", substate: "GASLESS_SIMULATED", amountUsd, token: "USDC", payer: a.from, recipient: a.to, userId: auth.account.user.id });
  return NextResponse.json({ ok: true, simulated: true, transaction: simulated, network: NETWORK, fee: { usd: GASLESS_FEE_USD, sponsored: true } });
}
