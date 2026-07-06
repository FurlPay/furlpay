import crypto from "crypto";
import { X402_VERSION, type PaymentRequirements, type XPaymentPayload } from "@/lib/x402";

// ---------------------------------------------------------------------------
// x402 Facilitator — the verify + settle service that sits between AI agents
// and the chain (the "Stripe for agent payments" middleware). Any x402 server
// can point its middleware at this facilitator instead of running wallet/gas
// infrastructure itself.
//
// Standard facilitator API surface:
//   GET  /supported  → the (scheme, network) kinds this facilitator can settle
//   POST /verify     → validate a payment payload against payment requirements
//   POST /settle     → verify, then submit settlement on-chain (single-use)
//
// This is Furlpay's wedge: x402 has reference facilitators on Base and Solana,
// but none on Arbitrum — despite Arbitrum One holding the deepest stablecoin
// liquidity of any L2. This facilitator settles on Arbitrum One (native USDC),
// Arbitrum Sepolia (testnet), Base and Solana. Settlement is pluggable: the
// default is a deterministic mock (runs with zero credentials); a live
// deployment injects a real on-chain settler (RPC + sponsored fee payer).
// ---------------------------------------------------------------------------

export const SUPPORTED_KINDS = [
  { x402Version: X402_VERSION, scheme: "exact", network: "arbitrum" },
  { x402Version: X402_VERSION, scheme: "exact", network: "arbitrum-sepolia" },
  { x402Version: X402_VERSION, scheme: "exact", network: "solana" },
  { x402Version: X402_VERSION, scheme: "exact", network: "base" },
] as const;

export interface SettlementRecord {
  transaction: string;
  network: string;
  payer: string;
  payTo: string;
  amountAtomic: string;
  resource: string;
  settledAt: string;
}

// Single-use nonce store + settlement log (production: Redis / Postgres).
const g = globalThis as unknown as {
  __x402fac?: { usedNonces: Set<string>; settlements: Map<string, SettlementRecord> };
};
const store =
  g.__x402fac ?? (g.__x402fac = { usedNonces: new Set(), settlements: new Map() });

export function getSettlement(tx: string): SettlementRecord | undefined {
  return store.settlements.get(tx);
}

export interface FacilitatorRequest {
  x402Version: number;
  paymentPayload: XPaymentPayload;
  paymentRequirements: PaymentRequirements;
}

export interface VerifyResult {
  isValid: boolean;
  payer?: string;
  invalidReason?: string;
}

export interface SettleResult {
  success: boolean;
  transaction?: string;
  network: string;
  payer?: string;
  errorReason?: string;
}

function supports(scheme: string, network: string): boolean {
  return SUPPORTED_KINDS.some((k) => k.scheme === scheme && k.network === network);
}

/** Validate a payment payload against the requirements the resource server set. */
export function verify(req: FacilitatorRequest): VerifyResult {
  const { paymentPayload: p, paymentRequirements: r } = req;
  const auth = p?.payload?.authorization;

  if (req.x402Version !== X402_VERSION) return fail("unsupported_version");
  if (!auth || typeof p?.payload?.signature !== "string") return fail("malformed_payload");
  if (p.scheme !== r.scheme) return fail("scheme_mismatch");
  if (p.network !== r.network) return fail("network_mismatch");
  if (!supports(p.scheme, p.network)) return fail("unsupported_kind");

  // Recipient must be exactly who the resource server asked to be paid.
  if ((auth.to || "").toLowerCase() !== (r.payTo || "").toLowerCase()) return fail("recipient_mismatch");

  // Amount must cover the required amount (atomic units).
  try {
    if (BigInt(auth.value) < BigInt(r.maxAmountRequired)) return fail("insufficient_amount");
  } catch {
    return fail("invalid_amount");
  }

  // Authorization validity window.
  const now = Math.floor(Date.now() / 1000);
  const vAfter = Number(auth.validAfter);
  const vBefore = Number(auth.validBefore);
  if (Number.isFinite(vAfter) && now < vAfter) return fail("not_yet_valid");
  if (Number.isFinite(vBefore) && now > vBefore) return fail("authorization_expired");

  return { isValid: true, payer: auth.from };
}

/** A settler submits a verified authorization on-chain and returns a tx id. */
export type Settler = (req: FacilitatorRequest, payer: string) => Promise<string> | string;

// Default mock settler — deterministic, no RPC. Replace via settle(req, realSettler).
function mockSettler(req: FacilitatorRequest): string {
  const bytes = crypto.randomBytes(32);
  // Solana tx signatures are base58; EVM hashes are 0x-hex.
  return req.paymentRequirements.network === "solana"
    ? bytes.toString("base64url").slice(0, 44)
    : "0x" + bytes.toString("hex");
}

/** Verify, then settle. Nonces are single-use, so replays are rejected. */
export async function settle(req: FacilitatorRequest, settler: Settler = mockSettler): Promise<SettleResult> {
  const network = req.paymentRequirements?.network ?? "unknown";
  const v = verify(req);
  if (!v.isValid) return { success: false, network, errorReason: v.invalidReason };

  const nonce = req.paymentPayload.payload.authorization.nonce;
  if (store.usedNonces.has(nonce)) {
    return { success: false, network, payer: v.payer, errorReason: "nonce_already_used" };
  }
  store.usedNonces.add(nonce);

  try {
    const transaction = await settler(req, v.payer!);
    store.settlements.set(transaction, {
      transaction,
      network,
      payer: v.payer!,
      payTo: req.paymentRequirements.payTo,
      amountAtomic: req.paymentPayload.payload.authorization.value,
      resource: req.paymentRequirements.resource,
      settledAt: new Date().toISOString(),
    });
    return { success: true, transaction, network, payer: v.payer };
  } catch (e) {
    // Fail closed: a settler error/timeout is NOT proof the on-chain settlement
    // did not land, so we keep the nonce burned rather than freeing it. Freeing
    // it would reopen the authorization for replay against a settlement that may
    // yet confirm (the F2/duplicate-settlement class). EIP-3009 retries use a
    // fresh nonce, so a burned nonce never blocks a legitimate re-attempt.
    return { success: false, network, payer: v.payer, errorReason: (e as Error).message || "settlement_failed" };
  }
}

function fail(reason: string): VerifyResult {
  return { isValid: false, invalidReason: reason };
}
