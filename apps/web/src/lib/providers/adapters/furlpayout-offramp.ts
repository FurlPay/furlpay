import crypto from "node:crypto";
import { rampEnv } from "../rampEnv";
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
// Echo Money off-ramp adapter (B2B payouts).
//
// Echo Money (Falcon Fintech Ltd, Canada) provides stablecoin-to-fiat B2B
// payout rails across 110+ countries with 215+ local payment methods.
//
// Primary use case: FurlPay travel product paying hotels, DMCs, and travel
// suppliers in local fiat (THB, EUR, INR, etc.) using USDC settlement.
//
// Flow:
//   1. quote() → Echo pricing API with corridor + amount
//   2. createOrder() → POST /payouts to create a payout order
//      Returns a depositAddress where FurlPay sends USDC
//   3. notifyDeposit() → confirm on-chain tx hash
//   4. Echo liquidates USDC → fiat and pays via local rail
//   5. Webhooks → not wired (scheme unverified; see verifyWebhook)
//
// PROTOCOL STATUS: UNVERIFIED. The endpoints, the HMAC-SHA512 request
// signing and the header names below were written without Echo's API
// documentation (docs.echo.money renders client-side; nothing retrievable
// states them), and https://api.echo.money/echo/api/v1 returned 404 on
// 2026-10-02. There is no default base URL: FURLPAYOUT_API_URL must be set
// from the contract docs. register.ts never registers this adapter, and every
// capability row for it is contractStatus "none".
// ---------------------------------------------------------------------------

const PROVIDER_ID = "furlpayout" as const;
const ECHO_API = rampEnv("FURLPAYOUT_API_URL") ?? "";
const API_KEY = rampEnv("FURLPAYOUT_API_KEY") ?? "";
const API_SECRET = rampEnv("FURLPAYOUT_API_SECRET") ?? "";

/**
 * Sign an Echo API request with HMAC-SHA512.
 * Signature = HMAC-SHA512(secret, `${timestamp}.${method}.${path}.${body}`)
 */
function signRequest(method: string, path: string, body: string): {
  signature: string;
  timestamp: string;
} {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const payload = `${timestamp}.${method}.${path}.${body}`;
  const signature = crypto
    .createHmac("sha512", API_SECRET)
    .update(payload)
    .digest("hex");
  return { signature, timestamp };
}

/** Common headers for authenticated Echo API calls. */
function echoHeaders(method: string, path: string, body: string): Record<string, string> {
  const { signature, timestamp } = signRequest(method, path, body);
  return {
    "Content-Type": "application/json",
    "x-echo-api-key": API_KEY,
    "x-echo-signature": signature,
    "x-echo-timestamp": timestamp,
  };
}

export const furlpayoutOfframp: OfframpProviderAdapter = {
  id: PROVIDER_ID,
  kind: "offramp",

  async quote(request: QuoteRequest): Promise<Quote> {
    if (!API_KEY || !API_SECRET) {
      throw new ProviderError(PROVIDER_ID, "Echo API credentials not configured.", {
        retryable: false,
      });
    }

    const path = "/quotes";
    const reqBody = JSON.stringify({
      sourceCurrency: request.from.asset.symbol ?? "USDC",
      sourceAmount: Number(request.from.toDecimalString()),
      destinationCurrency: request.toAssetId,
      paymentMethod: mapToEchoMethod(request.paymentMethod),
      destinationCountry: request.countryCode,
    });

    const res = await fetch(`${ECHO_API}${path}`, {
      method: "POST",
      headers: echoHeaders("POST", path, reqBody),
      body: reqBody,
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderError(
        PROVIDER_ID,
        `Echo quote failed (${res.status}): ${text.slice(0, 200)}`,
        { retryable: res.status >= 500 }
      );
    }

    const data = (await res.json()) as {
      quoteId?: string;
      sourceAmount?: number;
      destinationAmount?: number;
      destinationCurrency?: string;
      exchangeRate?: number;
      fee?: number;
      networkFee?: number;
      expiresAt?: string;
    };

    if (!data.quoteId) {
      throw new ProviderError(PROVIDER_ID, "Echo returned empty quote.", { retryable: true });
    }

    const fromAsset = request.from.asset;
    const toAsset = requireAsset(request.toAssetId);
    const destMinor = BigInt(
      Math.round((data.destinationAmount ?? 0) * 10 ** toAsset.decimals)
    );
    const feeMinor = BigInt(Math.round((data.fee ?? 0) * 10 ** fromAsset.decimals));
    const netFeeMinor = BigInt(Math.round((data.networkFee ?? 0) * 10 ** fromAsset.decimals));

    return {
      providerId: PROVIDER_ID,
      providerQuoteId: data.quoteId,
      from: request.from,
      to: M.ofMinor(destMinor, toAsset),
      fees: {
        provider: M.ofMinor(feeMinor, fromAsset),
        network: M.ofMinor(netFeeMinor, fromAsset),
        platform: M.zero(fromAsset),
      },
      rate: {
        numerator: String(data.exchangeRate ?? 1),
        denominator: "1",
      },
      expiresAt: data.expiresAt ?? new Date(Date.now() + 300_000).toISOString(),
    };
  },

  async createOrder(request: OfframpOrderRequest): Promise<OfframpOrder> {
    if (!API_KEY || !API_SECRET) {
      throw new ProviderError(PROVIDER_ID, "Echo API credentials not configured.", {
        retryable: false,
      });
    }

    const path = "/payouts";
    const reqBody = JSON.stringify({
      quoteId: request.quote.providerQuoteId,
      partnerRef: request.orderId,
      idempotencyKey: request.idempotencyKey,
      beneficiaryRef: request.beneficiaryRef,
      sourceAmount: Number(request.quote.from.toDecimalString()),
      sourceCurrency: request.quote.from.asset.symbol ?? "USDC",
      destinationCurrency: request.quote.to.asset.id,
      destinationCountry: request.countryCode,
    });

    const res = await fetch(`${ECHO_API}${path}`, {
      method: "POST",
      headers: echoHeaders("POST", path, reqBody),
      body: reqBody,
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const indeterminate = res.status === 502 || res.status === 408 || res.status === 504;
      throw new ProviderError(
        PROVIDER_ID,
        `Echo payout creation failed (${res.status}): ${text.slice(0, 200)}`,
        { retryable: res.status >= 500, indeterminate }
      );
    }

    const data = (await res.json()) as {
      payoutId?: string;
      status?: string;
      depositAddress?: string;
      depositChain?: string;
      depositMemo?: string;
    };

    if (!data.payoutId) {
      throw new ProviderError(PROVIDER_ID, "Echo returned empty payout.", { retryable: true });
    }

    const providerRef = `echo_${data.payoutId}`;

    return {
      providerId: PROVIDER_ID,
      providerRef,
      outcome: {
        state: "SETTLEMENT_PENDING",
        references: { providerRef, idempotencyKey: request.idempotencyKey },
        providerStatus: data.status ?? "created",
        providerFinal: false,
      },
      depositAddress: data.depositAddress,
      depositChain: data.depositChain ?? "solana",
      depositMemo: data.depositMemo,
    };
  },

  async notifyDeposit(providerRef: string, chainTxHash: string): Promise<ProviderOutcome> {
    if (!API_KEY || !API_SECRET) {
      throw new ProviderError(PROVIDER_ID, "Echo API credentials not configured.", {
        retryable: false,
      });
    }

    const echoPayoutId = providerRef.replace(/^echo_/, "");
    const path = `/payouts/${echoPayoutId}/deposit`;
    const reqBody = JSON.stringify({ transactionHash: chainTxHash });

    const res = await fetch(`${ECHO_API}${path}`, {
      method: "POST",
      headers: echoHeaders("POST", path, reqBody),
      body: reqBody,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderError(
        PROVIDER_ID,
        `Echo deposit notification failed (${res.status}): ${text.slice(0, 200)}`,
        { retryable: res.status >= 500, indeterminate: true }
      );
    }

    return {
      state: "CRYPTO_PENDING",
      references: { providerRef, chainTxHash },
      providerStatus: "deposit_notified",
      providerFinal: false,
    };
  },

  async getStatus(providerRef: string): Promise<ProviderOutcome> {
    if (!API_KEY || !API_SECRET) {
      throw new ProviderError(PROVIDER_ID, "Echo API credentials not configured.", {
        retryable: false,
      });
    }

    const echoPayoutId = providerRef.replace(/^echo_/, "");
    const path = `/payouts/${echoPayoutId}`;

    const res = await fetch(`${ECHO_API}${path}`, {
      method: "GET",
      headers: echoHeaders("GET", path, ""),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new ProviderError(
        PROVIDER_ID,
        `Echo status poll failed (${res.status})`,
        { retryable: res.status >= 500 }
      );
    }

    const data = (await res.json()) as {
      status?: string;
      transactionHash?: string;
      bankRef?: string;
      failureReason?: string;
    };

    if (!data.status) {
      throw new ProviderError(PROVIDER_ID, "Empty Echo status response.", { retryable: true });
    }

    return mapEchoStatus(data.status, providerRef, data.transactionHash, data.bankRef, data.failureReason);
  },

  async cancel(providerRef: string, reason: string): Promise<ProviderOutcome> {
    if (!API_KEY || !API_SECRET) {
      throw new ProviderError(PROVIDER_ID, "Echo API credentials not configured.", {
        retryable: false,
      });
    }

    const echoPayoutId = providerRef.replace(/^echo_/, "");
    const path = `/payouts/${echoPayoutId}/cancel`;
    const reqBody = JSON.stringify({ reason });

    const res = await fetch(`${ECHO_API}${path}`, {
      method: "POST",
      headers: echoHeaders("POST", path, reqBody),
      body: reqBody,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new ProviderError(
        PROVIDER_ID,
        `Echo cancellation failed (${res.status})`,
        { retryable: false, indeterminate: true }
      );
    }

    return {
      state: "CANCELLED",
      references: { providerRef },
      providerStatus: "cancelled",
      providerFinal: true,
    };
  },

  async verifyWebhook(
    _rawBody: string,
    _headers: Readonly<Record<string, string>>
  ): Promise<WebhookEvent> {
    // Refused, not guessed. Echo's webhook signing scheme is not stated in any
    // document we could retrieve; a verifier written against an assumed header
    // and algorithm either rejects every real event or accepts forged ones.
    throw new WebhookVerificationError(
      PROVIDER_ID,
      "Echo webhook signing scheme is unverified — obtain it from the Echo contract docs first."
    );
  },
};

// ---------------------------------------------------------------------------
// Map Echo payment method names to ours and back.
// ---------------------------------------------------------------------------
function mapToEchoMethod(method: string): string {
  const map: Record<string, string> = {
    upi: "UPI",
    imps: "IMPS",
    neft: "NEFT",
    rtgs: "RTGS",
    sepa: "SEPA",
    bank_transfer: "BANK_TRANSFER",
    faster_payments: "FASTER_PAYMENTS",
  };
  return map[method] ?? method.toUpperCase();
}

// ---------------------------------------------------------------------------
// Echo payout status → FurlPay TxState.
// ---------------------------------------------------------------------------
function mapEchoStatus(
  status: string,
  providerRef: string,
  txHash?: string,
  bankRef?: string,
  failureReason?: string
): ProviderOutcome {
  const refs = {
    providerRef,
    ...(txHash ? { chainTxHash: txHash } : {}),
    ...(bankRef ? { bankRef } : {}),
  };

  switch (status.toUpperCase()) {
    case "CREATED":
    case "PENDING_DEPOSIT":
      return { state: "SETTLEMENT_PENDING", references: refs, providerStatus: status, providerFinal: false };

    case "DEPOSIT_RECEIVED":
    case "CRYPTO_CONFIRMED":
      return { state: "CRYPTO_CONFIRMED", references: refs, providerStatus: status, providerFinal: false };

    case "PROCESSING":
    case "CONVERTING":
      return { state: "PROVIDER_PENDING", references: refs, providerStatus: status, providerFinal: false };

    case "FIAT_SENT":
    case "PAYOUT_INITIATED":
      return { state: "BANK_PENDING", references: refs, providerStatus: status, providerFinal: false };

    case "COMPLETED":
    case "DELIVERED":
      return { state: "COMPLETED", references: refs, providerStatus: status, providerFinal: true };

    case "CANCELLED":
      return { state: "CANCELLED", references: refs, providerStatus: status, providerFinal: true };

    case "FAILED":
    case "REJECTED":
      return { state: "FAILED", references: refs, providerStatus: status, providerFinal: true, failureReason: failureReason ?? `Echo payout ${status.toLowerCase()}` };

    case "REFUNDED":
    case "RETURNED":
      return { state: "REFUNDED", references: refs, providerStatus: status, providerFinal: true };

    case "ON_HOLD":
    case "COMPLIANCE_REVIEW":
      return { state: "COMPLIANCE_REVIEW", references: refs, providerStatus: status, providerFinal: false };

    default:
      return { state: "PROVIDER_PENDING", references: refs, providerStatus: status, providerFinal: false };
  }
}
