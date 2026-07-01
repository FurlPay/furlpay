import Stripe from "stripe";

// Server-side Stripe client for Furlpay Connect (Stripe Crypto, powered by the
// Bridge stablecoin orchestration infrastructure). Instantiated lazily with a
// placeholder key so builds succeed without secrets; the real key is set in the
// production environment.
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_placeholder");
  }
  return _stripe;
}

// Create a PaymentIntent that accepts stablecoins (settling as fiat USD).
// Crypto/stablecoin is enabled via dynamic payment methods in the Stripe
// Dashboard, so we let Stripe select networks (Base, Solana, Ethereum, Polygon)
// and assets (USDC, USDP) at checkout time.
export async function createCryptoPaymentIntent(amountInCents: number, currency = "usd") {
  const paymentIntent = await getStripe().paymentIntents.create({
    amount: amountInCents,
    currency,
    automatic_payment_methods: { enabled: true },
    metadata: { integration: "furlpay_connect_stablecoin" },
  });
  return { clientSecret: paymentIntent.client_secret, id: paymentIntent.id };
}

// B2B payout: send a merchant's settled balance to their connected account /
// on-chain destination via Stripe/Bridge rails.
export async function transferToMerchantWallet(
  destination: string,
  amountInCents: number,
  currency = "usd"
) {
  return getStripe().transfers.create({
    amount: amountInCents,
    currency,
    destination,
    description: "Furlpay stablecoin settlement payout via Bridge rails",
  });
}
