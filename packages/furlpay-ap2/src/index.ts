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

export interface NonceStore {
  has(nonce: string): boolean;
  add(nonce: string): void;
}

/** A default in-memory single-use nonce store (swap for Redis in production). */
export function memoryNonceStore(): NonceStore {
  const seen = new Set<string>();
  return { has: (n) => seen.has(n), add: (n) => void seen.add(n) };
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
  if (intent.constraints.expiresAt <= now) {
    throw new Ap2Error("expired", "intent mandate has expired");
  }

  // Integrity: cart total must equal the sum of line items.
  const lineSum = round(cart.items.reduce((s, i) => s + i.amount, 0));
  if (Math.abs(lineSum - cart.total) > 0.01) {
    throw new Ap2Error("total_mismatch", `cart total ${cart.total} != line sum ${lineSum}`);
  }

  // Currency.
  if (cart.currency.toUpperCase() !== intent.constraints.currency.toUpperCase()) {
    throw new Ap2Error("currency_mismatch", "cart currency not authorized by intent");
  }

  // Amount ceiling.
  if (cart.total > intent.constraints.maxAmount + 1e-9) {
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

  // Replay guard (single-use nonces on both mandates).
  if (p.nonceStore) {
    if (p.nonceStore.has(cart.nonce)) throw new Ap2Error("replayed", "cart nonce already used");
    if (intent.constraints.singleUse && p.nonceStore.has(intent.nonce)) {
      throw new Ap2Error("replayed", "single-use intent mandate already consumed");
    }
    p.nonceStore.add(cart.nonce);
    if (intent.constraints.singleUse) p.nonceStore.add(intent.nonce);
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
  const atomic = BigInt(Math.round(authorized.amount * 10 ** decimals)).toString();
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

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
