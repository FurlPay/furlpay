import type {
  OfframpProviderAdapter,
  QuoteRequest,
  Quote,
  OfframpOrderRequest,
  OfframpOrder,
  ProviderOutcome,
  WebhookEvent,
} from "../types";
import { ProviderError, ProviderUnsupported, WebhookVerificationError } from "../types";
import { Money as M, requireAsset } from "@/lib/money/money";
import { coinbaseOfframpUrl, isCoinbaseRampChain } from "@/lib/services/coinbaseRamp";

// ---------------------------------------------------------------------------
// Coinbase CDP off-ramp adapter.
//
// Wraps `coinbaseOfframpUrl()` as an OfframpProviderAdapter. The hosted sell
// checkout handles KYC, crypto collection, conversion, and bank payout.
//
// Flow:
//   1. User requests off-ramp quote → pass-through (hosted flow prices inline)
//   2. createOrder → generate hosted sell URL with session token
//   3. User opens checkout, connects wallet, sends crypto
//   4. Coinbase converts and pays to user's linked bank
//   5. Webhook / redirect confirms completion
//
// Unlike typical off-ramp adapters, Coinbase's hosted flow does NOT return a
// depositAddress for us to send crypto to — the user connects their own wallet
// inside the Coinbase widget. This means our orchestrator does NOT debit the
// user's FurlPay wallet; the user sends from their external wallet.
// ---------------------------------------------------------------------------

const PROVIDER_ID = "furlgateway" as const;

export const furlgatewayOfframpAdapter: OfframpProviderAdapter = {
  id: PROVIDER_ID,
  kind: "offramp",

  async quote(request: QuoteRequest): Promise<Quote> {
    // Same pass-through pattern as the on-ramp adapter: the real price is
    // shown inside the hosted checkout. This quote signals corridor availability.
    const toAsset = requireAsset(request.toAssetId);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60_000).toISOString();

    return {
      providerId: PROVIDER_ID,
      providerQuoteId: `cbs_${crypto.randomUUID()}`,
      from: request.from,
      to: M.zero(toAsset),
      fees: {
        provider: M.zero(request.from.asset),
        network: M.zero(request.from.asset),
        platform: M.zero(request.from.asset),
      },
      rate: { numerator: "1", denominator: "1" },
      expiresAt,
    };
  },

  async createOrder(request: OfframpOrderRequest): Promise<OfframpOrder> {
    // Resolve the chain from the quote's source asset.
    const chain = request.quote.from.asset.chain ?? "base";

    if (!isCoinbaseRampChain(chain)) {
      throw new ProviderError(
        PROVIDER_ID,
        `Coinbase CDP off-ramp does not support chain "${chain}".`
      );
    }

    // The hosted sell flow needs a wallet address for the session token.
    // In the Coinbase hosted flow the user provides this inside the widget,
    // so we use a placeholder — the session token is address-scoped but
    // the user can override inside the checkout.
    const result = await coinbaseOfframpUrl({
      address: "0x0000000000000000000000000000000000000000",
      chain,
      asset: request.quote.from.asset.symbol ?? "USDC",
      cryptoAmount: Number(request.quote.from.toDecimalString()),
      partnerUserRef: request.userRef,
    });

    if (!result) {
      throw new ProviderError(PROVIDER_ID, "Coinbase CDP credentials not configured.", {
        retryable: false,
      });
    }

    const providerRef = `cbs_${request.orderId}`;

    return {
      providerId: PROVIDER_ID,
      providerRef,
      outcome: {
        state: "PAYMENT_PENDING",
        references: { providerRef, idempotencyKey: request.idempotencyKey },
        providerStatus: "sell_checkout_created",
        providerFinal: false,
      },
      // No depositAddress — user connects wallet inside hosted checkout.
    };
  },

  async notifyDeposit(
    _providerRef: string,
    _chainTxHash: string
  ): Promise<ProviderOutcome> {
    // Coinbase hosted sell flow handles crypto collection internally.
    // The user sends crypto through the widget; we do not send on their behalf.
    throw new ProviderUnsupported(
      PROVIDER_ID,
      "notifyDeposit (hosted sell checkout collects crypto directly)"
    );
  },

  async getStatus(_providerRef: string): Promise<ProviderOutcome> {
    throw new ProviderUnsupported(
      PROVIDER_ID,
      "CDP sell status polling (requires Partner API credentials)"
    );
  },

  async cancel(_providerRef: string, _reason: string): Promise<ProviderOutcome> {
    throw new ProviderUnsupported(
      PROVIDER_ID,
      "cancel (hosted sell checkout sessions expire automatically)"
    );
  },

  async verifyWebhook(
    _rawBody: string,
    _headers: Readonly<Record<string, string>>
  ): Promise<WebhookEvent> {
    throw new WebhookVerificationError(
      PROVIDER_ID,
      "CDP sell webhook verification not yet implemented"
    );
  },
};
