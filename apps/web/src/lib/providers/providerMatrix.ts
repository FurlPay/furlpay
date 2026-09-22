import type { ProviderCapability } from "./capability";

// ---------------------------------------------------------------------------
// Provider capability matrix — what each payment provider can do.
//
// PROVIDER_CAPABILITIES in capability.ts is deliberately empty. This module
// defines the INTENDED capability matrix for when providers are contracted.
// It serves as both documentation and the configuration that the provider
// router (router.ts) will use to select the right provider for each
// payment type, corridor, and amount.
// ---------------------------------------------------------------------------

export const PROVIDER_MATRIX: readonly ProviderCapability[] = [
  // Circle - USDC mint/burn, CCTP
  {
    providerId: "circle",
    kind: "onramp",
    direction: "onramp",
    country: "US",
    fiatCurrency: "USD",
    assets: ["usdc"],
    paymentMethods: ["bank_transfer", "ach", "card"],
    contractStatus: "in_discussion",
    vdaMerchantAccepted: true,
    minMinor: 100n, // $1.00
    maxMinor: 10000000n, // $100,000.00
    settlementWindow: "T+1",
    requiredCredentials: ["CIRCLE_API_KEY"],
  },
  
  // Stripe - Card processing, Tempo settlement
  {
    providerId: "stripe",
    kind: "onramp",
    direction: "onramp",
    country: "US",
    fiatCurrency: "USD",
    assets: ["usdc"],
    paymentMethods: ["card", "apple_pay", "google_pay"],
    contractStatus: "signed_pending_credentials",
    vdaMerchantAccepted: false,
    minMinor: 50n, // $0.50
    maxMinor: 200000n, // $2,000.00
    settlementWindow: "T+2",
    requiredCredentials: ["STRIPE_SECRET_KEY"],
  },

  // Ramp Network - Crypto on-ramp
  {
    providerId: "ramp_network",
    kind: "onramp",
    direction: "onramp",
    country: "GB",
    fiatCurrency: "GBP",
    assets: ["usdc", "eth", "btc"],
    paymentMethods: ["faster_payments", "card", "apple_pay"],
    contractStatus: "none",
    vdaMerchantAccepted: true,
    minMinor: 500n, // £5.00
    maxMinor: 1000000n, // £10,000.00
    settlementWindow: "instant",
    requiredCredentials: ["RAMP_CLIENT_ID", "RAMP_SECRET"],
  },

  // Transak - On/off-ramp India
  {
    providerId: "transak",
    kind: "onramp",
    direction: "onramp",
    country: "IN",
    fiatCurrency: "INR",
    assets: ["usdt", "usdc"],
    paymentMethods: ["upi", "imps"],
    contractStatus: "in_discussion",
    vdaMerchantAccepted: true,
    minMinor: 50000n, // ₹500.00
    maxMinor: 50000000n, // ₹5,00,000.00
    settlementWindow: "instant",
    requiredCredentials: ["TRANSAK_API_KEY"],
  },
  {
    providerId: "transak",
    kind: "offramp",
    direction: "offramp",
    country: "IN",
    fiatCurrency: "INR",
    assets: ["usdt", "usdc"],
    paymentMethods: ["imps", "neft"],
    contractStatus: "in_discussion",
    vdaMerchantAccepted: true,
    minMinor: 100000n, // ₹1000.00
    maxMinor: 20000000n, // ₹2,00,000.00
    settlementWindow: "T+0",
    requiredCredentials: ["TRANSAK_API_KEY", "TRANSAK_SECRET_KEY"],
  },

  // Wise/Nium - Cross-border fiat
  {
    providerId: "wise",
    kind: "banking",
    direction: "payout",
    country: "EU",
    fiatCurrency: "EUR",
    assets: ["fiat_eur"], // Assuming fiat representation
    paymentMethods: ["sepa"],
    contractStatus: "none",
    vdaMerchantAccepted: false,
    minMinor: 100n, // €1.00
    maxMinor: 5000000n, // €50,000.00
    settlementWindow: "T+1",
    requiredCredentials: ["WISE_API_TOKEN"],
  },
  {
    providerId: "nium",
    kind: "banking",
    direction: "payout",
    country: "AU",
    fiatCurrency: "AUD",
    assets: ["fiat_aud"],
    paymentMethods: ["bank_transfer"],
    contractStatus: "none",
    vdaMerchantAccepted: false,
    minMinor: 100n, // A$1.00
    maxMinor: 1000000n, // A$10,000.00
    settlementWindow: "T+0",
    requiredCredentials: ["NIUM_CLIENT_ID", "NIUM_X_SECRET"],
  }
];
