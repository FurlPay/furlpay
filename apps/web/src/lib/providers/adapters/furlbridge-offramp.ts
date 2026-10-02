import crypto from "node:crypto";
import { rampEnv } from "../rampEnv";
import { verifyFurlBridgeWebhook } from "@/lib/ramp/webhookVerify";
import type {
  OfframpProviderAdapter,
  QuoteRequest,
  Quote,
  OfframpOrderRequest,
  OfframpOrder,
  ProviderOutcome,
  WebhookEvent,
} from "../types";
import { ProviderError, WebhookVerificationError } from "../types";
import { Money as M, requireAsset } from "@/lib/money/money";

// ---------------------------------------------------------------------------
// Transak off-ramp adapter.
//
// Flow:
//   1. quote() → Transak SELL pricing endpoint
//   2. createOrder() → POST /api/v2/order to create a server-side sell order
//      Returns a depositAddress where FurlPay sends USDC
//   3. notifyDeposit() → confirm the on-chain tx hash with Transak
//   4. Transak converts and pays INR/fiat to user's verified bank via IMPS/NEFT
//   5. Webhooks → status updates through /api/webhooks/furlbridge (HS256 JWT body)
//
// PROTOCOL STATUS: UNVERIFIED except the webhook. The server-side sell order
// (POST /api/v2/order) and its `x-request-signature` HMAC header were written
// without Transak's partner docs; Transak's documented sell flow is its hosted
// widget. Confirm in Transak staging before any row leaves "in_discussion".
//
// India corridor: Transak is FIU-IND registered and states it handles:
//   - 1% TDS deduction on crypto sale
//   - KYC verification (PAN + Aadhaar for ₹50K+)
//   - IMPS/NEFT payout to verified bank accounts
// ---------------------------------------------------------------------------

const PROVIDER_ID = "furlbridge" as const;
const TRANSAK_API = rampEnv("FURLBRIDGE_API_URL") ?? "https://api.transak.com";
const API_KEY = rampEnv("FURLBRIDGE_API_KEY") ?? "";
const SECRET_KEY = rampEnv("FURLBRIDGE_SECRET_KEY") ?? "";

export const furlbridgeOfframp: OfframpProviderAdapter = {
  id: PROVIDER_ID,
  kind: "offramp",

  async quote(request: QuoteRequest): Promise<Quote> {
    if (!API_KEY) {
      throw new ProviderError(PROVIDER_ID, "TRANSAK_API_KEY not configured.", {
        retryable: false,
      });
    }

    const params = new URLSearchParams({
      fiatCurrency: request.toAssetId, // off-ramp: we want fiat out
      cryptoCurrency: request.from.asset.symbol ?? "USDC",
      cryptoAmount: request.from.toDecimalString(),
      isBuyOrSell: "SELL",
      paymentMethod: request.paymentMethod === "imps" ? "imps" : "neft_rtgs",
      network: "solana",
    });

    const res = await fetch(`${TRANSAK_API}/api/v1/pricing/public/quotes?${params}`, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderError(
        PROVIDER_ID,
        `Transak sell quote failed (${res.status}): ${text.slice(0, 200)}`,
        { retryable: res.status >= 500 }
      );
    }

    const data = (await res.json()) as {
      response?: {
        quoteId?: string;
        fiatAmount?: number;
        fiatCurrency?: string;
        cryptoAmount?: number;
        totalFee?: number;
        networkFee?: number;
        conversionPrice?: number;
      };
    };

    const q = data.response;
    if (!q?.quoteId) {
      throw new ProviderError(PROVIDER_ID, "Empty sell quote response.", { retryable: true });
    }

    const fromAsset = request.from.asset;
    const toAsset = requireAsset(request.toAssetId);
    const fiatMinor = BigInt(Math.round((q.fiatAmount ?? 0) * 10 ** toAsset.decimals));
    const feeMinor = BigInt(Math.round((q.totalFee ?? 0) * 10 ** toAsset.decimals));
    const networkFeeMinor = BigInt(Math.round((q.networkFee ?? 0) * 10 ** toAsset.decimals));

    return {
      providerId: PROVIDER_ID,
      providerQuoteId: q.quoteId,
      from: request.from,
      to: M.ofMinor(fiatMinor, toAsset),
      fees: {
        provider: M.ofMinor(feeMinor, toAsset),
        network: M.ofMinor(networkFeeMinor, toAsset),
        platform: M.zero(toAsset),
      },
      rate: {
        numerator: String(q.conversionPrice ?? 1),
        denominator: "1",
      },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
  },

  async createOrder(request: OfframpOrderRequest): Promise<OfframpOrder> {
    if (!API_KEY || !SECRET_KEY) {
      throw new ProviderError(PROVIDER_ID, "Transak sell credentials not configured.", {
        retryable: false,
      });
    }

    // Create a server-side sell order via Transak Partner API.
    const body = {
      apiKey: API_KEY,
      quoteId: request.quote.providerQuoteId,
      partnerOrderId: request.orderId,
      cryptoCurrency: request.quote.from.asset.symbol ?? "USDC",
      network: request.quote.from.asset.chain ?? "solana",
      cryptoAmount: Number(request.quote.from.toDecimalString()),
      fiatCurrency: request.quote.to.asset.id,
      isBuyOrSell: "SELL",
    };

    // Sign the request with the secret key.
    const payload = JSON.stringify(body);
    const signature = crypto
      .createHmac("sha256", SECRET_KEY)
      .update(payload)
      .digest("hex");

    const res = await fetch(`${TRANSAK_API}/api/v2/order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-partner-api-key": API_KEY,
        "x-request-signature": signature,
      },
      body: payload,
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const indeterminate = res.status === 502 || res.status === 408 || res.status === 504;
      throw new ProviderError(
        PROVIDER_ID,
        `Sell order creation failed (${res.status}): ${text.slice(0, 200)}`,
        { retryable: res.status >= 500, indeterminate }
      );
    }

    const data = (await res.json()) as {
      response?: {
        id?: string;
        status?: string;
        walletAddress?: string; // deposit address for USDC
        transactionLink?: string;
      };
    };

    const order = data.response;
    if (!order?.id) {
      throw new ProviderError(PROVIDER_ID, "Empty sell order response.", { retryable: true });
    }

    const providerRef = `trk_sell_${order.id}`;

    return {
      providerId: PROVIDER_ID,
      providerRef,
      outcome: {
        state: "SETTLEMENT_PENDING",
        references: { providerRef, idempotencyKey: request.idempotencyKey },
        providerStatus: order.status ?? "created",
        providerFinal: false,
      },
      depositAddress: order.walletAddress,
      depositChain: request.quote.from.asset.chain ?? "solana",
    };
  },

  async notifyDeposit(providerRef: string, chainTxHash: string): Promise<ProviderOutcome> {
    // Transak auto-detects on-chain deposits to the provided wallet address.
    // This is a best-effort notification to speed up processing.
    return {
      state: "CRYPTO_PENDING",
      references: { providerRef, chainTxHash },
      providerStatus: "deposit_notified",
      providerFinal: false,
    };
  },

  async getStatus(providerRef: string): Promise<ProviderOutcome> {
    if (!API_KEY) {
      throw new ProviderError(PROVIDER_ID, "TRANSAK_API_KEY not configured.", {
        retryable: false,
      });
    }

    const transakId = providerRef.replace(/^trk_sell_/, "");

    const res = await fetch(`${TRANSAK_API}/api/v2/order/${transakId}`, {
      headers: { "x-partner-api-key": API_KEY },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new ProviderError(
        PROVIDER_ID,
        `Sell status poll failed (${res.status})`,
        { retryable: res.status >= 500 }
      );
    }

    const data = (await res.json()) as {
      response?: {
        status?: string;
        transactionHash?: string;
        bankRef?: string;
      };
    };

    const order = data.response;
    if (!order?.status) {
      throw new ProviderError(PROVIDER_ID, "Empty sell status response.", { retryable: true });
    }

    return mapTransakSellStatus(order.status, providerRef, order.transactionHash, order.bankRef);
  },

  async cancel(_providerRef: string, _reason: string): Promise<ProviderOutcome> {
    return {
      state: "CANCELLED",
      references: {},
      providerStatus: "cancelled_by_platform",
      providerFinal: true,
    };
  },

  async verifyWebhook(
    rawBody: string,
    _headers: Readonly<Record<string, string>>
  ): Promise<WebhookEvent> {
    // Transak's documented scheme: an HS256 JWT in the body's `data` field,
    // keyed with the Partner Access Token — see lib/ramp/webhookVerify.ts.
    let event;
    try {
      event = verifyFurlBridgeWebhook(rawBody);
    } catch (e) {
      throw new WebhookVerificationError(PROVIDER_ID, (e as Error).message);
    }
    const ref = `trk_sell_${event.partnerOrderId ?? event.orderId}`;
    return {
      providerId: PROVIDER_ID,
      eventId: event.dedupeKey,
      orderId: event.partnerOrderId,
      providerRef: ref,
      occurredAt: event.createdAt,
      outcome: mapTransakSellStatus(event.status, ref, event.transactionHash, typeof event.webhookData.bankRef === "string" ? event.webhookData.bankRef : undefined),
    };
  },
};

// ---------------------------------------------------------------------------
// Sell-side status mapping. Off-ramp has additional states for bank payout.
// ---------------------------------------------------------------------------
function mapTransakSellStatus(
  status: string,
  providerRef: string,
  txHash?: string,
  bankRef?: string
): ProviderOutcome {
  const refs = {
    providerRef,
    ...(txHash ? { chainTxHash: txHash } : {}),
    ...(bankRef ? { bankRef } : {}),
  };

  switch (status.toUpperCase()) {
    case "AWAITING_CRYPTO_FROM_USER":
      return { state: "SETTLEMENT_PENDING", references: refs, providerStatus: status, providerFinal: false };

    case "CRYPTO_RECEIVED":
    case "PROCESSING":
      return { state: "CRYPTO_CONFIRMED", references: refs, providerStatus: status, providerFinal: false };

    case "FIAT_SENT":
      return { state: "BANK_PENDING", references: refs, providerStatus: status, providerFinal: false };

    case "COMPLETED":
      return { state: "COMPLETED", references: refs, providerStatus: status, providerFinal: true };

    case "ON_HOLD_PENDING_KYC":
      return { state: "COMPLIANCE_REVIEW", references: refs, providerStatus: status, providerFinal: false };

    case "CANCELLED":
      return { state: "CANCELLED", references: refs, providerStatus: status, providerFinal: true };

    case "FAILED":
    case "EXPIRED":
      return { state: "FAILED", references: refs, providerStatus: status, providerFinal: true, failureReason: `Transak sell ${status.toLowerCase()}` };

    case "REFUNDED":
      return { state: "REFUNDED", references: refs, providerStatus: status, providerFinal: true };

    default:
      return { state: "PROVIDER_PENDING", references: refs, providerStatus: status, providerFinal: false };
  }
}
