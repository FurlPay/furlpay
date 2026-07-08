import crypto from "crypto";
import { X402_VERSION, requiredConfirmations, type PaymentRequirements, type XPaymentPayload } from "@/lib/x402";
import { kvSetNx, kvGet, kvSet } from "@/lib/kv";

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

// Durable nonce claim + settlement log. Backed by Redis (lib/kv.ts) so a nonce
// burned on one serverless instance is seen by every other (Attack II — the
// same replay hole the resource-server middleware closes in lib/x402.ts). The
// in-memory KV fallback is single-instance only.
const NONCE_TTL_SECONDS = 86_400; // outlive any EIP-3009 validBefore window
const SETTLEMENT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30d settlement receipt retention

function nonceKey(nonce: string): string {
  return `x402fac:nonce:${nonce}`;
}
function settlementKey(tx: string): string {
  return `x402fac:settlement:${tx}`;
}

export async function getSettlement(tx: string): Promise<SettlementRecord | undefined> {
  return (await kvGet<SettlementRecord>(settlementKey(tx))) ?? undefined;
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
  /** Confirmation depth the settler observed, and the depth required for this
   *  amount (Attack I-A). Present on both success and insufficient-depth. */
  confirmations?: number;
  requiredConfirmations?: number;
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

/** What a settler reports after submitting a verified authorization on-chain.
 *  `confirmations` is the depth it observed before returning — a real settler
 *  must wait for at least `minConfirmations` before reporting `confirmed`. */
export interface SettleSubmission {
  transaction: string;
  confirmations: number;
}

/** A settler submits a verified authorization on-chain. It is handed the
 *  `minConfirmations` this amount requires (Attack I-A) and must not report a
 *  higher depth than it has actually observed. */
export type Settler = (
  req: FacilitatorRequest,
  payer: string,
  minConfirmations: number
) => Promise<SettleSubmission> | SettleSubmission;

// Default mock settler — deterministic, no RPC. Reports exactly the depth asked
// for so dev/demo flows pass the gate. Replace via settle(req, realSettler) with
// a settler that waits for real confirmations on-chain.
function mockSettler(req: FacilitatorRequest, _payer: string, minConfirmations: number): SettleSubmission {
  const bytes = crypto.randomBytes(32);
  // Solana tx signatures are base58; EVM hashes are 0x-hex.
  const transaction =
    req.paymentRequirements.network === "solana"
      ? bytes.toString("base64url").slice(0, 44)
      : "0x" + bytes.toString("hex");
  return { transaction, confirmations: minConfirmations };
}

/** Verify, then settle. Nonces are single-use (atomic across instances), and
 *  the resource is only released once the settlement reaches the confirmation
 *  depth the amount requires (Attack I-A). */
export async function settle(req: FacilitatorRequest, settler: Settler = mockSettler): Promise<SettleResult> {
  const network = req.paymentRequirements?.network ?? "unknown";
  const v = verify(req);
  if (!v.isValid) return { success: false, network, errorReason: v.invalidReason };

  const nonce = req.paymentPayload.payload.authorization.nonce;
  const amountAtomic = req.paymentPayload.payload.authorization.value;
  const required = requiredConfirmations(amountAtomic);

  // Atomic claim across all instances — a replayed nonce loses the SET NX and
  // is rejected before any on-chain submission (Attack II duplicate-settlement).
  if (!(await kvSetNx(nonceKey(nonce), Math.floor(Date.now() / 1000), NONCE_TTL_SECONDS))) {
    return { success: false, network, payer: v.payer, errorReason: "nonce_already_used" };
  }

  try {
    const submission = await settler(req, v.payer!, required);
    // Attack I-A gate: never release on a settlement shallower than required.
    // Fail closed and KEEP the nonce burned — the tx may still confirm, so
    // freeing it would reopen the replay window. Legitimate retries use a
    // fresh EIP-3009 nonce, so this never blocks an honest re-attempt.
    if (submission.confirmations < required) {
      return {
        success: false,
        network,
        payer: v.payer,
        transaction: submission.transaction,
        confirmations: submission.confirmations,
        requiredConfirmations: required,
        errorReason: "insufficient_confirmations",
      };
    }
    const record: SettlementRecord = {
      transaction: submission.transaction,
      network,
      payer: v.payer!,
      payTo: req.paymentRequirements.payTo,
      amountAtomic,
      resource: req.paymentRequirements.resource,
      settledAt: new Date().toISOString(),
    };
    await kvSet(settlementKey(submission.transaction), record, SETTLEMENT_TTL_SECONDS);
    return {
      success: true,
      transaction: submission.transaction,
      network,
      payer: v.payer,
      confirmations: submission.confirmations,
      requiredConfirmations: required,
    };
  } catch (e) {
    // Fail closed: a settler error/timeout is NOT proof the on-chain settlement
    // did not land, so we keep the nonce burned rather than freeing it. Freeing
    // it would reopen the authorization for replay against a settlement that may
    // yet confirm (the duplicate-settlement class). EIP-3009 retries use a
    // fresh nonce, so a burned nonce never blocks a legitimate re-attempt.
    return { success: false, network, payer: v.payer, errorReason: (e as Error).message || "settlement_failed" };
  }
}

function fail(reason: string): VerifyResult {
  return { isValid: false, invalidReason: reason };
}
