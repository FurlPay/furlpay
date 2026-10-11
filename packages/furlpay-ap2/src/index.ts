// ---------------------------------------------------------------------------
// @furlpay/ap2 — an adapter for AP2 (Agent Payments Protocol), the open
// protocol backed by Google, Mastercard, PayPal, American Express and others
// for agent-to-agent and agent-to-merchant payments.
//
// AP2 is mandate-based. Two verifiable, user-signed objects anchor trust:
//   • IntentMandate — the user authorizes an agent to transact within limits
//     (max amount, currency, allowed merchants/categories, expiry).
//   • CartMandate   — a specific cart the user (or the agent under a valid
//     IntentMandate) approves for payment.
// AP2 keeps the *payment rail* pluggable. FurlPay is the first adapter to settle
// an approved AP2 cart over x402 / stablecoins: this module verifies the
// mandates and produces the settlement request FurlPay executes.
//
// Zero runtime deps: Ed25519 signing/verification uses Node's built-in crypto,
// loaded lazily so type-only consumers stay isomorphic.
// ---------------------------------------------------------------------------

// ---- mandate types ---------------------------------------------------------

export interface IntentConstraints {
  maxAmount: number;
  currency: string; // ISO 4217 or token symbol (e.g. "USD", "USDC")
  /** Allowlisted merchant ids; empty/undefined = any merchant. */
  merchants?: string[];
  /** Allowlisted categories (MCC or free-form); empty = any. */
  categories?: string[];
  /** Unix ms after which the mandate is void. */
  expiresAt: number;
  /** If true, the mandate authorizes exactly one CartMandate. */
  singleUse?: boolean;
}

export interface IntentMandate {
  type: "IntentMandate";
  id: string;
  /** Stable user identifier (DID, account id). */
  user: string;
  /** The agent authorized to act. */
  agent: string;
  constraints: IntentConstraints;
  issuedAt: number;
  nonce: string;
}

export interface CartItem {
  name: string;
  amount: number; // line total in `currency`
  quantity: number;
  sku?: string;
}

export interface CartMandate {
  type: "CartMandate";
  id: string;
  intentMandateId: string;
  merchant: string;
  category?: string;
  items: CartItem[];
  total: number;
  currency: string;
  createdAt: number;
  nonce: string;
}

export interface Signed<T> {
  payload: T;
  /** base64url Ed25519 signature over canonical JSON of `payload`. */
  signature: string;
  /** Signer key id (the public key, or a reference to it). */
  keyId: string;
  alg: "ed25519";
}

// ---- canonicalization + crypto --------------------------------------------

/** Deterministic JSON: object keys sorted recursively. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.keys(v as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortKeys((v as Record<string, unknown>)[k]);
        return acc;
      }, {});
  }
  return v;
}

async function nodeCrypto() {
  const mod = await import("node:crypto");
  return mod;
}

/** Generate an Ed25519 keypair (PEM). Useful for tests + issuing mandates. */
export async function generateKeypair(): Promise<{ publicKey: string; privateKey: string }> {
  const crypto = await nodeCrypto();
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey: publicKey.toString(), privateKey: privateKey.toString() };
}

async function signBytes(data: string, privateKeyPem: string): Promise<string> {
  const crypto = await nodeCrypto();
  const sig = crypto.sign(null, Buffer.from(data), privateKeyPem);
  return sig.toString("base64url");
}

async function verifyBytes(data: string, signatureB64: string, publicKeyPem: string): Promise<boolean> {
  const crypto = await nodeCrypto();
  try {
    return crypto.verify(null, Buffer.from(data), publicKeyPem, Buffer.from(signatureB64, "base64url"));
  } catch {
    return false;
  }
}

/** Sign any mandate payload, returning the AP2 Signed<T> envelope. */
export async function signMandate<T extends IntentMandate | CartMandate>(
  payload: T,
  privateKeyPem: string,
  keyId: string,
): Promise<Signed<T>> {
  const signature = await signBytes(canonicalize(payload), privateKeyPem);
  return { payload, signature, keyId, alg: "ed25519" };
}

// ---- verification ----------------------------------------------------------

export class Ap2Error extends Error {
  constructor(
    public readonly code:
      | "bad_signature"
      | "expired"
      | "over_limit"
      | "currency_mismatch"
      | "merchant_not_allowed"
      | "category_not_allowed"
      | "cart_intent_mismatch"
      | "total_mismatch"
      | "invalid_amount"
      | "invalid_nonce"
      | "validity_too_long"
      | "replayed",
    message: string,
  ) {
    super(message);
    this.name = "Ap2Error";
  }
}

/** Verify a signed mandate's Ed25519 signature against a public key. */
export async function verifySignature<T extends IntentMandate | CartMandate>(
  signed: Signed<T>,
  publicKeyPem: string,
): Promise<T> {
  if (signed.alg !== "ed25519") throw new Ap2Error("bad_signature", `unsupported alg ${signed.alg}`);
  const ok = await verifyBytes(canonicalize(signed.payload), signed.signature, publicKeyPem);
  if (!ok) throw new Ap2Error("bad_signature", "mandate signature does not verify");
  return signed.payload;
}

export type NonceKind = "cart" | "intent";

/**
 * Single-use nonce guard.
 *
 * `claim` is the one that matters: an atomic set-if-absent that returns true
 * only for the first caller, across every process that shares the store.
 * `has` followed by `add` is two steps — correct inside one process, a replay
 * window across serverless instances, where each has its own memory. A store
 * that offers `claim` is always used through it; `has`/`add` remain for
 * single-process callers.
 */
export interface NonceStore {
  has(nonce: string): boolean | Promise<boolean>;
  add(nonce: string): void | Promise<void>;
  /** Atomically consume `nonce`; true iff this caller is first. `expiresAt`
   *  (unix ms) is the earliest moment the record may be forgotten. */
  claim?(kind: NonceKind, nonce: string, expiresAt: number): Promise<boolean>;
}

/**
 * In-memory single-use nonce store. Correct in ONE process only: on serverless
 * every instance has its own Set, so a mandate replayed against a different
 * instance is accepted again. Production callers must pass a durable store
 * that implements `claim`.
 */
export function memoryNonceStore(): NonceStore {
  const seen = new Set<string>();
  return {
    has: (n) => seen.has(n),
    add: (n) => void seen.add(n),
    claim: async (kind, n) => {
      const key = `${kind}:${n}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
  };
}

// ---- exact amounts -----------------------------------------------------------

/** Precision every amount is compared at. Six places covers the stablecoins
 *  (USDC/USDT/EURC) and every ISO 4217 fiat currency. */
export const AMOUNT_DECIMALS = 6;
/** Largest amount accepted anywhere in a mandate (in currency units). */
export const MAX_MANDATE_AMOUNT = 1_000_000_000;

/**
 * Convert a JSON number to integer atomic units, exactly, or refuse.
 *
 * Mandate amounts arrive as JSON numbers. Comparing them as floats is how
 * 0.1 + 0.2 ends up "greater than" 0.3, and how an epsilon of 1e-9 lets a cart
 * exceed the limit it was signed under. Here a value must be finite, within
 * range, and carry no more than `decimals` places — `toFixed` with two guard
 * digits exposes anything finer, which is refused rather than rounded, so
 * rounding can never be the step that authorizes more than was signed for.
 */
export function toAtomicUnits(value: unknown, decimals: number = AMOUNT_DECIMALS, field = "amount"): bigint {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Ap2Error("invalid_amount", `${field} must be a finite number`);
  }
  if (value < 0 || value > MAX_MANDATE_AMOUNT) {
    throw new Ap2Error("invalid_amount", `${field} out of range`);
  }
  const fixed = value.toFixed(decimals + 2);
  const [whole, frac = ""] = fixed.split(".");
  if (frac.slice(decimals) !== "00") {
    throw new Ap2Error("invalid_amount", `${field} has more than ${decimals} decimal places`);
  }
  return BigInt(whole + frac.slice(0, decimals));
}

const NONCE = /^[A-Za-z0-9._:-]{8,200}$/;
function requireNonce(nonce: unknown, which: string): string {
  if (typeof nonce !== "string" || !NONCE.test(nonce)) {
    throw new Ap2Error("invalid_nonce", `${which} nonce must be 8-200 characters of [A-Za-z0-9._:-]`);
  }
  return nonce;
}

export interface AuthorizeParams {
  /** The signed cart the agent wants paid. */
  cart: Signed<CartMandate>;
  /** The signed intent that authorizes the cart. */
  intent: Signed<IntentMandate>;
  /** User public key that signed the IntentMandate. */
  userPublicKey: string;
  /** Merchant/agent public key that signed the CartMandate. */
  cartSignerPublicKey: string;
  /** Optional replay guard over cart + intent nonces. */
  nonceStore?: NonceStore;
  /**
   * Refuse intents valid for longer than this (ms from now). A durable nonce
   * store forgets a record at the mandate's expiry; a caller whose store has a
   * retention ceiling sets this to that ceiling so no mandate can outlive the
   * record that makes it single-use.
   */
  maxValidityMs?: number;
  now?: number;
}

export interface AuthorizedCart {
  cart: CartMandate;
  intent: IntentMandate;
  amount: number;
  currency: string;
  merchant: string;
}

/**
 * Full AP2 authorization: verify both signatures and enforce every constraint
 * the IntentMandate places on the CartMandate. Throws Ap2Error on any failure.
 */
export async function authorizeCart(p: AuthorizeParams): Promise<AuthorizedCart> {
  const now = p.now ?? Date.now();
  const intent = await verifySignature(p.intent, p.userPublicKey);
  const cart = await verifySignature(p.cart, p.cartSignerPublicKey);

  // Binding: the cart must reference this intent.
  if (cart.intentMandateId !== intent.id) {
    throw new Ap2Error("cart_intent_mismatch", "cart does not reference the supplied intent mandate");
  }

  // Expiry.
  const expiresAt = intent.constraints.expiresAt;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || expiresAt <= now) {
    throw new Ap2Error("expired", "intent mandate has expired");
  }
  if (p.maxValidityMs !== undefined && expiresAt - now > p.maxValidityMs) {
    throw new Ap2Error("validity_too_long", "intent mandate is valid for longer than this verifier accepts");
  }

  const cartNonce = requireNonce(cart.nonce, "cart");
  const intentNonce = requireNonce(intent.nonce, "intent");

  // Integrity: cart total must equal the sum of line items — exactly, in
  // integer atomic units. The old check rounded the float sum to cents and
  // then allowed a further 0.01 of slack, so a total could exceed its own lines.
  if (!Array.isArray(cart.items) || cart.items.length === 0) {
    throw new Ap2Error("total_mismatch", "cart has no line items");
  }
  const total = toAtomicUnits(cart.total, AMOUNT_DECIMALS, "cart total");
  if (total === 0n) throw new Ap2Error("invalid_amount", "cart total must be positive");
  let lineSum = 0n;
  for (const [i, item] of cart.items.entries()) {
    lineSum += toAtomicUnits(item?.amount, AMOUNT_DECIMALS, `line ${i} amount`);
    if (!Number.isInteger(item?.quantity) || item.quantity < 1) {
      throw new Ap2Error("invalid_amount", `line ${i} quantity must be a positive integer`);
    }
  }
  if (lineSum !== total) {
    throw new Ap2Error("total_mismatch", `cart total ${cart.total} != line sum`);
  }

  // Currency.
  if (cart.currency.toUpperCase() !== intent.constraints.currency.toUpperCase()) {
    throw new Ap2Error("currency_mismatch", "cart currency not authorized by intent");
  }

  // Amount ceiling, compared exactly. No epsilon: an epsilon is an amount the
  // user did not sign for.
  if (total > toAtomicUnits(intent.constraints.maxAmount, AMOUNT_DECIMALS, "intent maxAmount")) {
    throw new Ap2Error("over_limit", `cart total ${cart.total} exceeds max ${intent.constraints.maxAmount}`);
  }

  // Merchant allowlist.
  const merchants = intent.constraints.merchants;
  if (merchants && merchants.length > 0 && !merchants.includes(cart.merchant)) {
    throw new Ap2Error("merchant_not_allowed", `merchant ${cart.merchant} not in allowlist`);
  }

  // Category allowlist.
  const categories = intent.constraints.categories;
  if (categories && categories.length > 0 && cart.category && !categories.includes(cart.category)) {
    throw new Ap2Error("category_not_allowed", `category ${cart.category} not in allowlist`);
  }

  // Replay guard (single-use nonces on both mandates). Runs LAST, after every
  // check that can reject, so a refused cart never consumes a nonce.
  const store = p.nonceStore;
  if (store?.claim) {
    // Atomic claims. The cart is claimed first: if the intent claim then
    // fails, the cart nonce stays burned — a refusal, never a second payment.
    if (!(await store.claim("cart", cartNonce, expiresAt))) {
      throw new Ap2Error("replayed", "cart nonce already used");
    }
    if (intent.constraints.singleUse && !(await store.claim("intent", intentNonce, expiresAt))) {
      throw new Ap2Error("replayed", "single-use intent mandate already consumed");
    }
  } else if (store) {
    if (await store.has(cartNonce)) throw new Ap2Error("replayed", "cart nonce already used");
    if (intent.constraints.singleUse && (await store.has(intentNonce))) {
      throw new Ap2Error("replayed", "single-use intent mandate already consumed");
    }
    await store.add(cartNonce);
    if (intent.constraints.singleUse) await store.add(intentNonce);
  }

  return { cart, intent, amount: cart.total, currency: cart.currency, merchant: cart.merchant };
}

// ---- settlement bridge -----------------------------------------------------

export interface X402Settlement {
  scheme: "exact";
  network: string;
  /** Atomic units (USDC = 6 decimals). */
  maxAmountRequired: string;
  payTo: string;
  asset: string;
  description: string;
  /** Echoed AP2 references so settlement is auditable back to the mandate. */
  extra: { ap2CartId: string; ap2IntentId: string; merchant: string };
}

export interface BridgeOptions {
  payTo: string;
  network?: string; // default "arbitrum"
  asset?: string; // USDC contract; defaults to network USDC
  /** Token decimals (USDC/USDT/EURC = 6). */
  decimals?: number;
}

/**
 * Convert an authorized AP2 cart into an x402 settlement request FurlPay can
 * execute. Only stablecoin currencies are settleable on-chain.
 */
export function toX402Settlement(authorized: AuthorizedCart, opts: BridgeOptions): X402Settlement {
  const decimals = opts.decimals ?? 6;
  // Exact conversion; an amount finer than the token's precision is refused,
  // not rounded (Math.round(x * 10**d) could round a signed amount upward).
  const atomic = toAtomicUnits(authorized.amount, decimals, "amount").toString();
  return {
    scheme: "exact",
    network: opts.network ?? "arbitrum",
    maxAmountRequired: atomic,
    payTo: opts.payTo,
    asset: opts.asset ?? "USDC",
    description: `AP2 cart ${authorized.cart.id} @ ${authorized.merchant}`,
    extra: {
      ap2CartId: authorized.cart.id,
      ap2IntentId: authorized.intent.id,
      merchant: authorized.merchant,
    },
  };
}

/** Convert an authorized AP2 cart into a FurlPay payment-intent request. */
export function toFurlPayPayment(authorized: AuthorizedCart, opts: { recipient: string; sourceChain?: string }) {
  return {
    amount: authorized.amount,
    recipient: opts.recipient,
    sourceChain: opts.sourceChain ?? "arbitrum",
    metadata: {
      protocol: "ap2",
      ap2CartId: authorized.cart.id,
      ap2IntentId: authorized.intent.id,
      merchant: authorized.merchant,
    },
  };
}
