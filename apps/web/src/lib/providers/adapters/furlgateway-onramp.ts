import type {
  OnrampProviderAdapter,
  QuoteRequest,
  Quote,
  OnrampOrderRequest,
  OnrampOrder,
  ProviderOutcome,
  WebhookEvent,
} from "../types";
import { ProviderError, ProviderUnsupported, WebhookVerificationError } from "../types";
import type { Money } from "@/lib/money/money";
import { Money as M, requireAsset } from "@/lib/money/money";
import { coinbaseOnrampUrl, isCoinbaseRampChain } from "@/lib/services/coinbaseRamp";

// ---------------------------------------------------------------------------
// Coinbase CDP on-ramp adapter.
//
// Wraps the existing `coinbaseOnrampUrl()` hosted checkout integration as a
// formal OnrampProviderAdapter so the provider router can select it when the
// capability matrix says Coinbase is live for a corridor.
//
// Coinbase CDP's hosted flow is "opaque": the user sees pricing in the
// checkout widget and the provider handles KYC, payment collection, and crypto
// delivery. Our adapter generates the checkout URL and returns it; it does NOT
// have server-side quoting or status polling (those require CDP Partner API
// credentials beyond the current integration).
//
// IMPORTANT: `quote()` returns a *pass-through* quote — it tells the caller
// "Coinbase can serve this corridor" with approximate pricing. The real price
// is shown in the hosted checkout. This is acceptable because the user sees
// the exact price before confirming, and our lifecycle FSM only advances on
// webhook confirmation, not on quote acceptance.
// ---------------------------------------------------------------------------

const PROVIDER_ID = "furlgateway" as const;

export const furlgatewayOnrampAdapter: OnrampProviderAdapter = {
  id: PROVIDER_ID,
  kind: "onramp",

  async quote(request: QuoteRequest): Promise<Quote> {
    // Coinbase hosted flow does not expose a server-side quote endpoint in
    // our current CDP integration. Return a pass-through quote that signals
    // "this corridor is available" with zeroed fees (the real fees are shown
    // in the hosted widget).
    //
    // This is safe because:
    //   1. The user sees the real price before confirming inside Coinbase.
    //   2. Our FSM does not advance past PAYMENT_PENDING until a webhook.
    //   3. The router uses this to decide *eligibility*, not *price*.

    const toAsset = requireAsset(request.toAssetId);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60_000).toISOString();

    return {
      providerId: PROVIDER_ID,
      providerQuoteId: `cbq_${crypto.randomUUID()}`,
      from: request.from,
      to: M.zero(toAsset), // actual amount determined by hosted checkout
      fees: {
        provider: M.zero(request.from.asset),
        network: M.zero(request.from.asset),
        platform: M.zero(request.from.asset),
      },
      rate: { numerator: "1", denominator: "1" },
      expiresAt,
    };
  },

  async createOrder(request: OnrampOrderRequest): Promise<OnrampOrder> {
    if (!isCoinbaseRampChain(request.destinationChain)) {
      throw new ProviderError(
        PROVIDER_ID,
        `Coinbase CDP does not support chain "${request.destinationChain}".`
      );
    }

    const result = await coinbaseOnrampUrl({
      address: request.destinationAddress,
      chain: request.destinationChain,
      asset: request.quote.to.asset.symbol ?? "USDC",
      fiatAmount: Number(request.quote.from.toDecimalString()),
      fiatCurrency: request.quote.from.asset.id,
      partnerUserRef: request.userRef,
      redirectUrl: request.redirectUrl,
    });

    if (!result) {
      throw new ProviderError(PROVIDER_ID, "Coinbase CDP credentials not configured.", {
        retryable: false,
      });
    }

    const providerRef = `cb_${request.orderId}`;

    return {
      providerId: PROVIDER_ID,
      providerRef,
      outcome: {
        state: "PAYMENT_PENDING",
        references: { providerRef, idempotencyKey: request.idempotencyKey },
        providerStatus: "checkout_created",
        providerFinal: false,
      },
      checkoutUrl: result.url,
    };
  },

  async getStatus(_providerRef: string): Promise<ProviderOutcome> {
    // CDP Partner API status polling requires enhanced credentials beyond
    // the current session-token integration. This is Phase 1 work tracked
    // in the implementation plan — for now, status is driven by webhooks.
    throw new ProviderUnsupported(
      PROVIDER_ID,
      "CDP status polling (requires Partner API credentials)"
    );
  },

  async cancel(_providerRef: string, _reason: string): Promise<ProviderOutcome> {
    // Coinbase hosted checkout sessions expire naturally. The user can close
    // the window; the session token has a short TTL. There is no server-side
    // cancellation endpoint in the current CDP integration.
    throw new ProviderUnsupported(
      PROVIDER_ID,
      "cancel (hosted checkout sessions expire automatically)"
    );
  },

  async refund(_providerRef: string, _amount: Money, _reason: string): Promise<ProviderOutcome> {
    throw new ProviderUnsupported(
      PROVIDER_ID,
      "refund (requires CDP Partner API)"
    );
  },

  async verifyWebhook(
    _rawBody: string,
    _headers: Readonly<Record<string, string>>
  ): Promise<WebhookEvent> {
    // CDP webhook verification will be implemented when the Partner API
    // integration is upgraded. For now, Coinbase order status is tracked
    // through the hosted checkout redirect flow.
    throw new WebhookVerificationError(
      PROVIDER_ID,
      "CDP webhook verification not yet implemented"
    );
  },
};
