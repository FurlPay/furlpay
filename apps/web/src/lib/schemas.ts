import { z } from "zod";
import { NextResponse } from "next/server";

// Shared zod schemas + a parse helper for route handlers. Malformed input is
// provably rejected with a 400 before any business logic runs.

export const TransferSchema = z.object({
  safeAddress: z.string().optional(),
  destination: z.string().min(4),
  amount: z.number().positive(),
  token: z.enum(["USDC", "USDT", "EURC", "PYUSD", "DAI", "XSGD", "XUSD"]),
  chain: z.enum(["ethereum", "polygon", "base", "arbitrum", "solana", "gnosis", "arc", "tempo"]),
  signature: z.string().min(1),
  mfaCode: z.string().optional(),
  biometricProof: z.string().optional(),
  deviceSignals: z.record(z.any()).optional(),
});

export const OrderSchema = z.object({
  symbol: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  notional: z.number().positive().optional(),
  qty: z.number().positive().optional(),
  type: z.enum(["market", "limit", "stop", "stop_limit", "trailing_stop"]).optional(),
  time_in_force: z.enum(["day", "gtc", "ioc", "fok", "opg", "cls"]).optional(),
  limit_price: z.number().positive().optional(),
  stop_price: z.number().positive().optional(),
  // Trailing stop: exactly one of these, enforced in lib/brokerage/alpaca.ts
  // where the arithmetic and the time-in-force interaction are also checked.
  // Bounded here so an absurd value is rejected before it reaches the provider.
  trail_percent: z.number().positive().max(99.99).optional(),
  trail_price: z.number().positive().optional(),
});

export const IntentSchema = z.object({
  fromToken: z.enum(["USDC", "USDT", "EURC", "PYUSD", "DAI", "XSGD", "XUSD"]),
  toToken: z.enum(["USDC", "USDT", "EURC", "PYUSD", "DAI", "XSGD", "XUSD"]),
  fromChain: z.enum(["ethereum", "polygon", "base", "arbitrum", "solana", "gnosis"]),
  toChain: z.enum(["ethereum", "polygon", "base", "arbitrum", "solana", "gnosis"]),
  amount: z.number().positive(),
  settleWithinSec: z.number().positive().optional(),
  fallbackToken: z.enum(["USDC", "USDT", "EURC", "PYUSD", "DAI", "XSGD", "XUSD"]).optional(),
  execute: z.boolean().optional(),
});

// Full trading token/chain unions (superset of the stablecoin-only enums
// above — swaps also route natives and the newer chains).
const SwapToken = z.enum(["USDC", "USDT", "EURC", "PYUSD", "DAI", "XSGD", "XUSD", "SOL", "ETH"]);
const SwapChain = z.enum([
  "ethereum",
  "polygon",
  "base",
  "arbitrum",
  "solana",
  "gnosis",
  "robinhood",
  "bsc",
]);

/** Quote phase: price a route. Issues a quoteId the client executes against. */
export const SwapQuoteSchema = z.object({
  fromToken: SwapToken,
  toToken: SwapToken,
  fromChain: SwapChain,
  toChain: SwapChain.optional(),
  amountIn: z.coerce.number().positive().max(10_000_000),
  execute: z.literal(false).optional(),
});

/**
 * Execute phase: settle a quote the server already issued and is holding.
 *
 * Deliberately carries NO price or pair fields. The amount, route and rate all
 * come from the stored quote, so there is nothing here for a client to restate
 * differently from what it was shown — and nothing for the server to re-price.
 * The pair fields are still accepted and ignored, because clients naturally
 * echo their form state and rejecting that would be noise, not safety.
 */
export const SwapExecuteSchema = z.object({
  execute: z.literal(true),
  quoteId: z.string().uuid(),
  fromToken: SwapToken.optional(),
  toToken: SwapToken.optional(),
  fromChain: SwapChain.optional(),
  toChain: SwapChain.optional(),
  amountIn: z.coerce.number().positive().max(10_000_000).optional(),
});

export const SwapSchema = z.union([SwapExecuteSchema, SwapQuoteSchema]);



export const OfframpSchema = z.object({
  fromCurrency: z.string().min(2).max(10),
  toCurrency: z.string().min(2).max(10),
  amount: z
    .number()
    .positive("Amount must be positive")
    .max(50_000, "Maximum off-ramp: $50,000")
    .refine((n) => Number.isFinite(n), "Must be a finite number"),
  execute: z.boolean().optional(),
  // Required to execute once a payout path exists: the user's VERIFIED
  // beneficiary (lib/ramp/beneficiary.ts). There is no "default" account.
  beneficiaryId: z.string().regex(/^ben_[a-f0-9]{20}$/).optional(),
});

// --- On-ramp / off-ramp schemas (Rule 1: Zod on every POST body) -----------

const RampToken = z.enum(["USDC", "USDT", "EURC"]);
const RampChain = z.enum(["solana", "base", "ethereum", "arbitrum", "polygon"]);
const FiatCurrency = z.enum([
  "USD", "EUR", "GBP", "INR", "BRL", "JPY", "AED", "SGD", "THB", "MXN",
]);
const PaymentMethod = z.enum([
  "card", "apple_pay", "google_pay", "bank_transfer",
  "upi", "imps", "sepa", "ach", "faster_payments", "on_chain",
]);

export const OnrampQuoteSchema = z.object({
  fiatAmount: z
    .number()
    .positive("Amount must be positive")
    .max(50_000, "Maximum on-ramp: $50,000")
    .refine((n) => Number.isFinite(n), "Must be a finite number"),
  fiatCurrency: FiatCurrency,
  token: RampToken,
  chain: RampChain,
  paymentMethod: PaymentMethod.optional(),
});

export const OnrampSessionSchema = z.object({
  fiatAmount: z
    .number()
    .positive("Amount must be positive")
    .min(1, "Minimum on-ramp: $1.00")
    .max(50_000, "Maximum on-ramp: $50,000")
    .refine((n) => Number.isFinite(n), "Must be a finite number"),
  fiatCurrency: FiatCurrency,
  token: RampToken,
  chain: RampChain,
  paymentMethod: PaymentMethod.optional(),
  // Rule 9: address validated via addressCheck.ts after parsing.
  destinationAddress: z.string().min(20).max(128),
  externalId: z.string().max(128).optional(),
  idempotencyKey: z.string().uuid().optional(),
});

export const OfframpSessionSchema = z.object({
  address: z.string().min(20).max(128),
  chain: RampChain,
  token: RampToken,
  cryptoAmount: z
    .number()
    .positive("Amount must be positive")
    .max(50_000, "Maximum off-ramp: $50,000")
    .refine((n) => Number.isFinite(n), "Must be a finite number"),
  // https only: the provider sends the user here after checkout.
  redirectUrl: z.string().url().startsWith("https://").max(500).optional(),
});

export const BeneficiarySchema = z.object({
  accountHolderName: z.string().min(2).max(200),
  // Whitelist exactly the fields needed — AGENTS.md Rule 4.
  accountNumber: z.string().min(5).max(34),     // IBAN can be up to 34 chars
  bankCode: z.string().min(4).max(15).optional(), // IFSC (11), SWIFT (8-11), ABA (9)
  bankName: z.string().max(200).optional(),
  country: z.string().length(2),                  // ISO 3166-1 alpha-2
  currency: FiatCurrency,
});

export const CheckoutSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().optional(),
  token: z.string().optional(),
  wallet: z.string().optional(),
});

export const BankingSchema = z.object({
  currency: z.enum(["USD", "EUR", "GBP", "INR"]),
});

// --- Unified USDC payments (settle on Arbitrum One) -------------------------

const EvmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Expected a 0x EVM address");
const SourceChain = z.enum(["ethereum", "polygon", "base", "arbitrum", "solana", "gnosis"]);

export const PaymentCreateSchema = z.object({
  amount: z.number().positive().max(1_000_000),
  sourceChain: SourceChain.optional(), // defaults to arbitrum in the route
  recipient: EvmAddress,
  metadata: z.record(z.string()).optional(),
});

export const PaymentExecuteSchema = z.object({
  paymentId: z.string().startsWith("pay_"),
  payer: EvmAddress,
  signature: z.string().min(1),
});

export const PaymentBatchSchema = z.object({
  sourceChain: SourceChain.optional(),
  payments: z
    .array(
      z.object({
        recipient: EvmAddress,
        amount: z.number().positive().max(1_000_000),
        metadata: z.record(z.string()).optional(),
      })
    )
    .min(1)
    .max(100),
});

export type Parsed<T> = { ok: true; data: T } | { ok: false; res: NextResponse };

/** Parse an unknown body against a schema; on failure return a 400 response. */
export function parse<T>(schema: z.ZodType<T>, body: unknown): Parsed<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "Invalid request", issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
        { status: 400 }
      ),
    };
  }
  return { ok: true, data: result.data };
}

// ── Travel-document wallet ─────────────────────────────────────────────────
//
// Note what these schemas do NOT accept: no MRZ, no chip data, no images, no
// document number. The client never handles those — the verification provider
// does, in its own hosted flow — so there is no field here for them to arrive
// in. A schema that cannot express sensitive data cannot be tricked into
// storing it.

const DocumentTypeEnum = z.enum(["passport", "passport_card", "national_id", "residence_permit"]);

export const DocumentScanInitSchema = z.object({
  /** ISO 3166-1 alpha-3. Membership is checked against COUNTRIES in the route. */
  issuingCountry: z.string().trim().toUpperCase().length(3).regex(/^[A-Z]{3}$/),
  documentType: DocumentTypeEnum,
});

export const DocumentVerifySchema = z.object({
  sessionId: z.string().min(1).max(256),
});

export const DocumentUpdateSchema = z.object({
  label: z.string().trim().min(1).max(100).optional(),
  isPrimary: z.boolean().optional(),
});

/** Deleting a travel document is irreversible — re-verification means going
 *  through the provider again — so it takes an explicit typed confirmation. */
export const DocumentDeleteSchema = z.object({
  confirmation: z.literal("DELETE"),
});

// ── Newsletter ─────────────────────────────────────────────────────────────
//
// Both endpoints are public, so the schema is the only thing standing between
// an anonymous caller and the subscriber store: the address is length-capped
// (254 is the RFC 5321 maximum), categories are a closed enum, and the array
// is bounded so a caller cannot post a million-element list.

const NewsletterCategoryEnum = z.enum([
  "product-updates",
  "engineering",
  "policy-changes",
  "security-bulletins",
  "weekly-digest",
]);

const SubscriberEmail = z.string().trim().toLowerCase().min(3).max(254).email();

/** Duplicates in the request must not produce duplicates in the record. */
const dedupe = (cats: string[]) => Array.from(new Set(cats));

export const NewsletterSubscribeSchema = z.object({
  email: SubscriberEmail,
  categories: z.array(NewsletterCategoryEnum).min(1).max(5).transform(dedupe),
});

/** Omitted / empty `categories` means a full unsubscribe. */
export const NewsletterUnsubscribeSchema = z.object({
  email: SubscriberEmail,
  categories: z.array(NewsletterCategoryEnum).max(5).transform(dedupe).optional(),
});

// ── Apple Pay top-up ───────────────────────────────────────────────────────
//
// The wire shape is dictated by the iOS client, not chosen here: see
// `ApplePayTopUpRequest` in ios/FurlPayGuardian/Shared/Network/DTOs.swift.
// Keys are camelCase because the client's JSONEncoder uses default keys.
//
// `paymentData` is the base64 of PKPaymentToken.paymentData — opaque
// ciphertext that only the merchant private key held by the processor can
// open. The server never decrypts it here and must never log or echo it.
// The 64KB cap is well above a real token (~2-4KB) and well below the 100KB
// body cap, so a padded blob is rejected by the schema rather than by memory
// pressure.
//
// `amountUsd` is advisory only. It is what the sheet displayed, and it is
// checked against the amount the processor actually captured — the captured
// figure is what gets credited. A client cannot inflate a credit by lying here.

export const ApplePayTopUpSchema = z.object({
  paymentData: z.string().min(1).max(65_536),
  network: z.string().min(1).max(32).nullish(),
  displayName: z.string().min(1).max(64).nullish(),
  amountUsd: z.number().positive().max(10_000),
  idempotencyKey: z.string().uuid(),
});

// ── Notifications ──────────────────────────────────────────────────────────
//
// The list endpoint takes its parameters from the query string, so the schema
// coerces: everything arrives as a string. `before` is a keyset cursor the
// client echoes back from a previous page, and it is validated as a real
// datetime rather than trusted — it is interpolated into a PostgREST filter.

export const NotificationListSchema = z.object({
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  unreadOnly: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

/** Mark-one-read carries no body fields worth setting — the id is in the path
 *  and the only transition is unread → read. An explicit literal keeps the
 *  contract closed rather than accepting an arbitrary object. */
export const NotificationPatchSchema = z.object({
  read: z.literal(true),
});
