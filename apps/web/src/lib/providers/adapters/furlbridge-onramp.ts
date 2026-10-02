import crypto from "node:crypto";
import { rampEnv } from "../rampEnv";
import { verifyFurlBridgeWebhook } from "@/lib/ramp/webhookVerify";
import type {
  OnrampProviderAdapter,
  QuoteRequest,
  Quote,
  OnrampOrderRequest,
  OnrampOrder,
  ProviderOutcome,
  WebhookEvent,
} from "../types";
import { ProviderError, WebhookVerificationError } from "../types";
import type { Money } from "@/lib/money/money";
import { Money as M, requireAsset, ASSETS } from "@/lib/money/money";

// ---------------------------------------------------------------------------
// Transak on-ramp adapter.
//
// Integrates with Transak's Partner API for server-side order creation and
// their hosted widget for customer-facing payment collection + KYC.
//
// Flow:
//   1. quote() → Transak /api/v1/pricing/public/quotes for server-side pricing
//   2. createOrder() → generate widget URL with our parameters (no server-side
//      order creation needed — Transak widget creates the order on submission)
//   3. Webhooks → Transak POSTs order status updates to /api/webhooks/furlbridge (HS256 JWT body)
//   4. getStatus() → poll GET /api/v2/order/{orderId} as webhook backup
//
// Transak docs: https://docs.transak.com
//
// Transak is FIU-IND registered. FurlPay has NO contract with it: every
// capability row is "in_discussion", so the router never selects this adapter.
//
// PROTOCOL STATUS: the webhook scheme is verified against Transak's docs
// (2026-10-02). The widget parameters, the pricing-quote call and the order
// status call are NOT verified against a partner account — confirm them in
// Transak's staging environment before a row leaves "in_discussion".
// ---------------------------------------------------------------------------

const PROVIDER_ID = "furlbridge" as const;
const TRANSAK_API = rampEnv("FURLBRIDGE_API_URL") ?? "https://api.transak.com";
const API_KEY = rampEnv("FURLBRIDGE_API_KEY") ?? "";

/**
 * Build the Transak widget URL with all parameters. Transak's widget handles
 * KYC, payment collection, and crypto delivery in one hosted flow.
 */
function buildWidgetUrl(params: {
  apiKey: string;
  network: string;
  cryptoCurrencyCode: string;
  walletAddress: string;
  fiatAmount: string;
  fiatCurrency: string;
  partnerOrderId: string;
  paymentMethod?: string;
  redirectUrl?: string;
}): string {
  const base = "https://global.transak.com";
  const qs = new URLSearchParams({
    apiKey: params.apiKey,
    network: params.network,
    cryptoCurrencyCode: params.cryptoCurrencyCode,
    walletAddress: params.walletAddress,
    fiatAmount: params.fiatAmount,
    fiatCurrency: params.fiatCurrency,
    partnerOrderId: params.partnerOrderId,
    disableWalletAddressForm: "true",
    hideMenu: "true",
    themeColor: "7c3aed", // FurlPay purple
  });
  if (params.paymentMethod) qs.set("paymentMethod", params.paymentMethod);
  if (params.redirectUrl) qs.set("redirectURL", params.redirectUrl);
  return `${base}?${qs.toString()}`;
}

/** Map Transak chain names to our chain IDs. */
function toTransakNetwork(chain: string): string {
  const map: Record<string, string> = {
    solana: "solana",
    base: "base",
    ethereum: "mainnet",
    arbitrum: "arbitrum",
    polygon: "polygon",
  };
  return map[chain] ?? chain;
}

/** Map Transak payment method names to ours. */
function fromTransakPaymentMethod(method: string): string {
  const map: Record<string, string> = {
    upi: "upi",
    neft_rtgs: "neft",
    credit_debit_card: "card",
    apple_pay: "apple_pay",
    google_pay: "google_pay",
    sepa_bank_transfer: "sepa",
    gbp_bank_transfer: "faster_payments",
  };
  return map[method] ?? method;
}

export const furlbridgeOnramp: OnrampProviderAdapter = {
  id: PROVIDER_ID,
  kind: "onramp",

  async quote(request: QuoteRequest): Promise<Quote> {
    if (!API_KEY) {
      throw new ProviderError(PROVIDER_ID, "TRANSAK_API_KEY not configured.", {
        retryable: false,
      });
    }

    // Transak pricing endpoint — public, no auth required.
    const params = new URLSearchParams({
      fiatCurrency: request.from.asset.id,
      cryptoCurrency: request.toAssetId.split(".")[0].toUpperCase(),
      fiatAmount: request.from.toDecimalString(),
      paymentMethod: request.paymentMethod === "upi" ? "upi" : "credit_debit_card",
      isBuyOrSell: "BUY",
      network: "solana", // default; refined at order time
    });

    const res = await fetch(`${TRANSAK_API}/api/v1/pricing/public/quotes?${params}`, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderError(
        PROVIDER_ID,
        `Transak quote failed (${res.status}): ${text.slice(0, 200)}`,
        { retryable: res.status >= 500, indeterminate: false }
      );
    }

    const data = (await res.json()) as {
      response?: {
        quoteId?: string;
        fiatAmount?: number;
        fiatCurrency?: string;
        cryptoAmount?: number;
        cryptoCurrency?: string;
        totalFee?: number;
        networkFee?: number;
        conversionPrice?: number;
      };
    };

    const q = data.response;
    if (!q || !q.quoteId) {
      throw new ProviderError(PROVIDER_ID, "Transak returned empty quote.", {
        retryable: true,
      });
    }

    const fromAsset = request.from.asset;
    const toAsset = requireAsset(request.toAssetId);
    const feeAmount = BigInt(Math.round((q.totalFee ?? 0) * 10 ** fromAsset.decimals));
    const networkFeeAmount = BigInt(Math.round((q.networkFee ?? 0) * 10 ** fromAsset.decimals));
    const cryptoMinor = BigInt(
      Math.round((q.cryptoAmount ?? 0) * 10 ** toAsset.decimals)
    );

    return {
      providerId: PROVIDER_ID,
      providerQuoteId: q.quoteId,
      from: request.from,
      to: M.ofMinor(cryptoMinor, toAsset),
      fees: {
        provider: M.ofMinor(feeAmount, fromAsset),
        network: M.ofMinor(networkFeeAmount, fromAsset),
        platform: M.zero(fromAsset),
      },
      rate: {
        numerator: String(q.conversionPrice ?? 1),
        denominator: "1",
      },
      expiresAt: new Date(Date.now() + 60_000).toISOString(), // Transak quotes valid ~60s
    };
  },

  async createOrder(request: OnrampOrderRequest): Promise<OnrampOrder> {
    if (!API_KEY) {
      throw new ProviderError(PROVIDER_ID, "TRANSAK_API_KEY not configured.", {
        retryable: false,
      });
    }

    const network = toTransakNetwork(request.destinationChain);
    const cryptoCode = request.quote.to.asset.symbol ?? "USDC";

    const widgetUrl = buildWidgetUrl({
      apiKey: API_KEY,
      network,
      cryptoCurrencyCode: cryptoCode,
      walletAddress: request.destinationAddress,
      fiatAmount: request.quote.from.toDecimalString(),
      fiatCurrency: request.quote.from.asset.id,
      partnerOrderId: request.orderId,
      paymentMethod: request.quote.from.asset.id === "INR" ? "upi" : undefined,
      redirectUrl: request.redirectUrl,
    });

    const providerRef = `trk_${request.orderId}`;

    return {
      providerId: PROVIDER_ID,
      providerRef,
      outcome: {
        state: "PAYMENT_PENDING",
        references: { providerRef, idempotencyKey: request.idempotencyKey },
        providerStatus: "widget_created",
        providerFinal: false,
      },
      checkoutUrl: widgetUrl,
    };
  },

  async getStatus(providerRef: string): Promise<ProviderOutcome> {
    if (!API_KEY) {
      throw new ProviderError(PROVIDER_ID, "TRANSAK_API_KEY not configured.", {
        retryable: false,
      });
    }

    // Strip our prefix to get the Transak order ID.
    const transakOrderId = providerRef.replace(/^trk_/, "");

    const res = await fetch(`${TRANSAK_API}/api/v2/order/${transakOrderId}`, {
      headers: { "x-partner-api-key": API_KEY },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new ProviderError(
        PROVIDER_ID,
        `Status poll failed (${res.status})`,
        { retryable: res.status >= 500, indeterminate: res.status === 408 || res.status === 502 }
      );
    }

    const data = (await res.json()) as {
      response?: { status?: string; transactionHash?: string; id?: string };
    };

    const order = data.response;
    if (!order?.status) {
      throw new ProviderError(PROVIDER_ID, "Empty status response.", { retryable: true });
    }

    return mapTransakStatus(order.status, providerRef, order.transactionHash);
  },

  async cancel(_providerRef: string, _reason: string): Promise<ProviderOutcome> {
    // Transak widget sessions expire naturally. Server-side cancellation
    // requires Partner API access which is configured per-account.
    return {
      state: "CANCELLED",
      references: {},
      providerStatus: "cancelled_by_platform",
      providerFinal: true,
    };
  },

  async refund(_providerRef: string, _amount: Money, _reason: string): Promise<ProviderOutcome> {
    // Transak handles refunds through their support dashboard.
    // Server-side refund API is not yet integrated.
    throw new ProviderError(PROVIDER_ID, "Refund requires Transak support dashboard.", {
      retryable: false,
    });
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
    const ref = `trk_${event.partnerOrderId ?? event.orderId}`;
    return {
      providerId: PROVIDER_ID,
      eventId: event.dedupeKey,
      orderId: event.partnerOrderId,
      providerRef: ref,
      occurredAt: event.createdAt,
      outcome: mapTransakStatus(event.status, ref, event.transactionHash),
    };
  },
};

// ---------------------------------------------------------------------------
// Status mapping: Transak order statuses → our TxState.
// Transak statuses: https://docs.transak.com/docs/tracking-an-order-status
// ---------------------------------------------------------------------------
function mapTransakStatus(
  status: string,
  providerRef: string,
  transactionHash?: string
): ProviderOutcome {
  const refs = { providerRef, ...(transactionHash ? { chainTxHash: transactionHash } : {}) };

  switch (status.toUpperCase()) {
    case "AWAITING_PAYMENT_FROM_USER":
      return { state: "PAYMENT_PENDING", references: refs, providerStatus: status, providerFinal: false };

    case "PAYMENT_DONE_MARKED_BY_USER":
    case "PROCESSING":
      return { state: "PAYMENT_CONFIRMED", references: refs, providerStatus: status, providerFinal: false };

    case "PENDING_DELIVERY_FROM_TRANSAK":
      return { state: "CRYPTO_PENDING", references: refs, providerStatus: status, providerFinal: false };

    case "ON_HOLD_PENDING_DELIVERY_FROM_TRANSAK":
      return { state: "COMPLIANCE_REVIEW", references: refs, providerStatus: status, providerFinal: false };

    case "COMPLETED":
      return { state: "CRYPTO_CONFIRMED", references: refs, providerStatus: status, providerFinal: true };

    case "CANCELLED":
      return { state: "CANCELLED", references: refs, providerStatus: status, providerFinal: true };

    case "FAILED":
    case "EXPIRED":
      return { state: "FAILED", references: refs, providerStatus: status, providerFinal: true, failureReason: `Transak order ${status.toLowerCase()}` };

    case "REFUNDED":
      return { state: "REFUNDED", references: refs, providerStatus: status, providerFinal: true };

    default:
      return { state: "PROVIDER_PENDING", references: refs, providerStatus: status, providerFinal: false };
  }
}
