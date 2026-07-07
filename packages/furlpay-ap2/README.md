# @furlpay/ap2

An **AP2 (Agent Payments Protocol)** adapter for FurlPay. AP2 is the open,
mandate-based protocol backed by Google, Mastercard, PayPal and American Express
for agent-to-merchant and agent-to-agent payments. This package verifies AP2
mandates and **bridges an approved cart to x402 / stablecoin settlement** — so
FurlPay is the first AP2 adapter that settles on-chain.

## Concepts

- **IntentMandate** — the user authorizes an agent to transact within limits
  (max amount, currency, allowed merchants/categories, expiry, single-use).
- **CartMandate** — a specific cart approved for payment, bound to an intent.

Both are Ed25519-signed. `authorizeCart()` verifies both signatures and enforces
every constraint (amount ceiling, currency, merchant/category allowlist, expiry,
line-item integrity, replay). It throws a typed `Ap2Error` on any violation.

## Usage

```ts
import {
  authorizeCart,
  toX402Settlement,
  memoryNonceStore,
} from "@furlpay/ap2";

const authorized = await authorizeCart({
  cart: signedCart,          // Signed<CartMandate>
  intent: signedIntent,      // Signed<IntentMandate>
  userPublicKey,             // signed the intent
  cartSignerPublicKey,       // signed the cart
  nonceStore: memoryNonceStore(),
});

// Bridge to FurlPay's x402 settlement rail (USDC on Arbitrum by default):
const settlement = toX402Settlement(authorized, { payTo: TREASURY_ADDRESS });
```

Or produce a FurlPay payment intent with `toFurlPayPayment(authorized, { recipient })`.

## Design

Zero runtime dependencies — Ed25519 uses Node's built-in `crypto`. Payloads are
canonicalized (recursively sorted keys) before signing so signatures are stable
across serializers. Nonces are single-use to defeat replay; swap `memoryNonceStore`
for Redis in production.
