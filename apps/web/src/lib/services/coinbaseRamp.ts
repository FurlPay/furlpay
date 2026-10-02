import { rampEnv } from "@/lib/providers/rampEnv";
import { createPrivateKey, randomBytes, sign } from "crypto";

// ---------------------------------------------------------------------------
// Coinbase CDP Onramp/Offramp adapter — the licensed-provider leg behind the
// headless on-ramp (lib/services/onramp.ts mints the demo/session shape; this
// module mints the REAL hosted checkout URL when CDP credentials are set).
//
// Why Coinbase: 0% provider fees on USDC on/offramps — the cheapest fiat leg
// available to FurlPay users. Flow (docs.cdp.coinbase.com, Onramp APIs):
//   1. Server generates a CDP JWT (Bearer) and calls the Session Token API:
//      POST https://api.developer.coinbase.com/onramp/v1/token
//      body { addresses: [{ address, blockchains }], assets }
//      → single-use, short-lived sessionToken ("secure init" — required).
//   2. Client opens https://pay.coinbase.com/buy/select-asset?sessionToken=…
//      (onramp) or https://pay.coinbase.com/v3/sell/input?sessionToken=…
//      (offramp). Coinbase handles KYC, card/bank acquiring and settles
//      on-chain to the address; offramp pays out to bank/card/PayPal.
//
// Same conventions as kv.ts/supabase.ts: plain fetch, no SDK dependency.
// JWT is signed locally with Node crypto — EdDSA for current CDP keys
// (base64 Ed25519 secret) or ES256 for legacy PEM EC keys.
// ---------------------------------------------------------------------------

// FURLGATEWAY_* is the internal name; CDP_* remains the fallback (lib/providers/rampEnv.ts).
const CDP_KEY_ID = rampEnv("FURLGATEWAY_API_KEY_ID");
const CDP_SECRET = rampEnv("FURLGATEWAY_API_KEY_SECRET");
const HOST = "api.developer.coinbase.com";
const TOKEN_PATH = "/onramp/v1/token";

/** "coinbase" when CDP credentials are present, else "none" (demo sessions only). */
export const coinbaseRampBackend: "coinbase" | "none" = CDP_KEY_ID && CDP_SECRET ? "coinbase" : "none";

const b64url = (buf: Buffer): string =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** CDP Bearer JWT: header {alg, kid, nonce}, claims {iss:"cdp", sub:key,
 *  aud:["cdp_service"], uris:["METHOD host+path"]}, 120s expiry. */
function cdpJwt(method: string, path: string): string {
  const now = Math.floor(Date.now() / 1000);
  const isPem = CDP_SECRET!.includes("BEGIN");
  const header = {
    alg: isPem ? "ES256" : "EdDSA",
    typ: "JWT",
    kid: CDP_KEY_ID,
    nonce: randomBytes(16).toString("hex"),
  };
  const claims = {
    iss: "cdp",
    sub: CDP_KEY_ID,
    aud: ["cdp_service"],
    nbf: now,
    exp: now + 120,
    uris: [`${method} ${HOST}${path}`],
  };
  const input = `${b64url(Buffer.from(JSON.stringify(header)))}.${b64url(Buffer.from(JSON.stringify(claims)))}`;

  let signature: Buffer;
  if (isPem) {
    // Legacy EC key (PEM, possibly with literal \n from env storage). JWT
    // ES256 needs raw r||s — Node emits that directly with ieee-p1363.
    const key = createPrivateKey(CDP_SECRET!.replace(/\\n/g, "\n"));
    signature = sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
  } else {
    // Current CDP key: base64 of 64 bytes (32-byte Ed25519 seed || 32-byte
    // public key). Wrap the seed in a PKCS8 envelope to build a KeyObject.
    const raw = Buffer.from(CDP_SECRET!, "base64");
    const seed = raw.subarray(0, 32);
    const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
    const key = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
    signature = sign(null, Buffer.from(input), key);
  }
  return `${input}.${b64url(signature)}`;
}

/** Chains FurlPay exposes that Coinbase Onramp settles natively. */
const RAMP_CHAINS = new Set(["solana", "base", "ethereum", "arbitrum", "polygon"]);
export const isCoinbaseRampChain = (chain: string): boolean => RAMP_CHAINS.has(chain);

/** Mint a single-use session token for the given wallet + chain + assets. */
async function sessionToken(address: string, blockchains: string[], assets: string[]): Promise<string> {
  const res = await fetch(`https://${HOST}${TOKEN_PATH}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cdpJwt("POST", TOKEN_PATH)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ addresses: [{ address, blockchains }], assets }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`cdp session token ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { token?: string; data?: { token?: string } };
  const token = json.token ?? json.data?.token;
  if (!token) throw new Error("cdp session token: empty response");
  return token;
}

export interface HostedRamp {
  provider: "coinbase";
  url: string;
  feeNote: string;
  expiresNote: string;
}

/** Hosted BUY (fiat → crypto) URL. Returns null when unconfigured. */
export async function coinbaseOnrampUrl(input: {
  address: string;
  chain: string;
  asset: string; // "USDC"
  fiatAmount?: number;
  fiatCurrency?: string;
  partnerUserRef?: string;
  redirectUrl?: string;
}): Promise<HostedRamp | null> {
  if (coinbaseRampBackend === "none" || !isCoinbaseRampChain(input.chain)) return null;
  const token = await sessionToken(input.address, [input.chain], [input.asset]);
  const url = new URL("https://pay.coinbase.com/buy/select-asset");
  url.searchParams.set("sessionToken", token);
  url.searchParams.set("defaultNetwork", input.chain);
  url.searchParams.set("defaultAsset", input.asset);
  if (input.fiatAmount) url.searchParams.set("presetFiatAmount", String(input.fiatAmount));
  if (input.fiatCurrency) url.searchParams.set("fiatCurrency", input.fiatCurrency);
  if (input.partnerUserRef) url.searchParams.set("partnerUserRef", input.partnerUserRef);
  if (input.redirectUrl) url.searchParams.set("redirectUrl", input.redirectUrl);
  return {
    provider: "coinbase",
    url: url.toString(),
    feeNote: "Coinbase shows its fees before you pay.",
    expiresNote: "Session token is single-use and expires in minutes — open promptly.",
  };
}

/** Hosted SELL (crypto → fiat/bank) URL. Returns null when unconfigured. */
export async function coinbaseOfframpUrl(input: {
  address: string;
  chain: string;
  asset: string;
  cryptoAmount?: number;
  partnerUserRef?: string;
  redirectUrl?: string;
}): Promise<HostedRamp | null> {
  if (coinbaseRampBackend === "none" || !isCoinbaseRampChain(input.chain)) return null;
  const token = await sessionToken(input.address, [input.chain], [input.asset]);
  const url = new URL("https://pay.coinbase.com/v3/sell/input");
  url.searchParams.set("sessionToken", token);
  url.searchParams.set("defaultNetwork", input.chain);
  url.searchParams.set("defaultAsset", input.asset);
  if (input.cryptoAmount) url.searchParams.set("presetCryptoAmount", String(input.cryptoAmount));
  if (input.partnerUserRef) url.searchParams.set("partnerUserRef", input.partnerUserRef);
  if (input.redirectUrl) url.searchParams.set("redirectUrl", input.redirectUrl);
  return {
    provider: "coinbase",
    url: url.toString(),
    feeNote: "Coinbase shows its fees before you pay.",
    expiresNote: "Session token is single-use and expires in minutes — open promptly.",
  };
}

// ---------------------------------------------------------------------------
// Buy quote — the real price, from Coinbase.
// POST /onramp/v1/buy/quote (docs.cdp.coinbase.com, "Create Buy Quote",
// checked 2026-10-02). Amount fields are { value, currency } objects. Returns
// null when FurlGateway (CDP) credentials are unset; throws on a CDP error so
// the caller can say "unavailable" instead of inventing a number.
// ---------------------------------------------------------------------------

const QUOTE_PATH = "/onramp/v1/buy/quote";

const CDP_PAYMENT_METHOD: Record<string, string> = {
  card: "CARD",
  apple_pay: "APPLE_PAY",
  ach: "ACH_BANK_ACCOUNT",
  bank_transfer: "ACH_BANK_ACCOUNT",
};

export interface CoinbaseBuyQuote {
  provider: "coinbase";
  quoteId: string;
  purchaseAmount: { value: string; currency: string };
  paymentTotal: { value: string; currency: string };
  paymentSubtotal: { value: string; currency: string };
  coinbaseFee: { value: string; currency: string };
  networkFee: { value: string; currency: string };
}

type Amount = { value?: unknown; currency?: unknown };
const amount = (a: Amount | undefined) =>
  a && typeof a.value === "string" && typeof a.currency === "string" ? { value: a.value, currency: a.currency } : null;

export async function coinbaseBuyQuote(input: {
  asset: string;
  chain: string;
  fiatAmount: number;
  fiatCurrency: string;
  paymentMethod: string;
  country: string;
  subdivision?: string;
}): Promise<CoinbaseBuyQuote | null> {
  if (coinbaseRampBackend === "none" || !isCoinbaseRampChain(input.chain)) return null;
  const method = CDP_PAYMENT_METHOD[input.paymentMethod];
  if (!method) return null;
  const res = await fetch(`https://${HOST}${QUOTE_PATH}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cdpJwt("POST", QUOTE_PATH)}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      purchaseCurrency: input.asset,
      purchaseNetwork: input.chain,
      paymentAmount: input.fiatAmount.toFixed(2),
      paymentCurrency: input.fiatCurrency,
      paymentMethod: method,
      country: input.country,
      ...(input.subdivision ? { subdivision: input.subdivision } : {}),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`cdp buy quote ${res.status}`);
  const j = (await res.json()) as Record<string, unknown>;
  const q = {
    quoteId: typeof j.quote_id === "string" ? j.quote_id : null,
    purchaseAmount: amount(j.purchase_amount as Amount),
    paymentTotal: amount(j.payment_total as Amount),
    paymentSubtotal: amount(j.payment_subtotal as Amount),
    coinbaseFee: amount(j.coinbase_fee as Amount),
    networkFee: amount(j.network_fee as Amount),
  };
  if (!q.quoteId || !q.purchaseAmount || !q.paymentTotal || !q.paymentSubtotal || !q.coinbaseFee || !q.networkFee) {
    throw new Error("cdp buy quote: response missing fields");
  }
  return { provider: "coinbase", ...(q as Omit<CoinbaseBuyQuote, "provider">) };
}
