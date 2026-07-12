import crypto from "crypto";
import { X402_VERSION, requiredConfirmations, type PaymentRequirements, type XPaymentPayload } from "@/lib/x402";
import { kvSetNx } from "@/lib/kv";
import { verifyAuthorizationSignature } from "@/lib/x402Signature";
import { defaultSettler, SettlementPendingError } from "@/lib/x402Settler";
import { getSettlement, recordSettlement, type SettlementRecord } from "@/lib/x402SettlementStore";

// Settlement log moved to x402SettlementStore (shared with lib/x402.ts without
// an import cycle); re-exported here for existing consumers.
export { getSettlement, recordSettlement, type SettlementRecord };

// Signature + real-settlement enforcement. Live mode requires BOTH a recovered
// EIP-3009 signature AND a real on-chain settler; mock/demo mode (the default,
// zero-credential path) keeps the structural checks and the deterministic mock
// settler so the whole stack still runs without keys.
function liveMode(): boolean {
  return process.env.INTEGRATION_MODE === "live" || process.env.X402_ENFORCE_SIGNATURE === "1";
}

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

// x402 v2 (Dec 2025) is not just a header rename — the payload shapes changed:
// `maxAmountRequired` became `amount`, resource metadata was hoisted out of each
// requirement into a top-level ResourceInfo, and the client now echoes the full
// `accepted` requirements instead of a bare `extra`. We accept BOTH dialects and
// normalize v2 down to the v1 shape below, so every security check in verify()
// and settle() is written once and cannot drift between versions.
export const X402_VERSION_V2 = 2;

const NETWORKS = ["arbitrum", "arbitrum-sepolia", "solana", "base"] as const;

export const SUPPORTED_KINDS = [
  ...NETWORKS.map((network) => ({ x402Version: X402_VERSION, scheme: "exact", network })),
  ...NETWORKS.map((network) => ({ x402Version: X402_VERSION_V2, scheme: "exact", network })),
] as const;

/** v2 requirements: `amount` replaces `maxAmountRequired`; no resource/description. */
interface PaymentRequirementsV2 {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

interface ResourceInfoV2 {
  url?: string;
  description?: string;
  mimeType?: string;
}

/** v2 payload: the client echoes the FULL requirements it is paying against. */
interface PaymentPayloadV2 {
  x402Version: number;
  resource?: ResourceInfoV2;
  accepted: PaymentRequirementsV2;
  payload: XPaymentPayload["payload"];
}

export interface FacilitatorRequestV2 {
  x402Version: number;
  paymentPayload: PaymentPayloadV2;
  paymentRequirements: PaymentRequirementsV2;
}

/** Anything a caller may POST to /verify or /settle. */
export type AnyFacilitatorRequest = FacilitatorRequest | FacilitatorRequestV2;

/**
 * Collapse a v2 request onto the canonical v1 shape.
 *
 * The mapping is meaning-preserving, not merely structural: the client's echo
 * (`paymentPayload.accepted`) stays on the payload side and the resource
 * server's terms (`paymentRequirements`) stay on the requirements side, so
 * verify()'s scheme/network/recipient/amount comparisons still pit one against
 * the other. Flattening those two into one object would silently delete every
 * check that matters.
 */
export function normalizeFacilitatorRequest(req: AnyFacilitatorRequest): FacilitatorRequest | null {
  if (req?.x402Version === X402_VERSION) return req as FacilitatorRequest;
  if (req?.x402Version !== X402_VERSION_V2) return null;

  const { paymentPayload: p, paymentRequirements: r } = req as FacilitatorRequestV2;
  if (!p?.accepted || !p?.payload || !r) return null;

  return {
    x402Version: X402_VERSION,
    paymentPayload: {
      x402Version: X402_VERSION,
      scheme: p.accepted.scheme,
      network: p.accepted.network,
      payload: p.payload,
      extra: p.accepted.extra as XPaymentPayload["extra"],
    },
    paymentRequirements: {
      scheme: r.scheme as "exact",
      network: r.network,
      maxAmountRequired: r.amount,
      resource: p.resource?.url ?? "",
      description: p.resource?.description ?? "",
      mimeType: p.resource?.mimeType ?? "application/json",
      payTo: r.payTo,
      maxTimeoutSeconds: r.maxTimeoutSeconds,
      asset: r.asset,
      extra: r.extra as PaymentRequirements["extra"],
    },
  };
}

// Durable nonce claim. Backed by Redis (lib/kv.ts) so a nonce burned on one
// serverless instance is seen by every other (Attack II — the same replay hole
// the resource-server middleware closes in lib/x402.ts). The in-memory KV
// fallback is single-instance only.
const NONCE_TTL_SECONDS = 86_400; // outlive any EIP-3009 validBefore window

function nonceKey(nonce: string): string {
  return `x402fac:nonce:${nonce}`;
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

/** Validate a payment payload against the requirements the resource server set.
 *  Async because live mode cryptographically recovers the EIP-3009 signer. */
export async function verify(request: AnyFacilitatorRequest): Promise<VerifyResult> {
  // Accept v1 or v2 on the wire; everything below reasons about one shape.
  const req = normalizeFacilitatorRequest(request);
  if (!req) return fail("unsupported_version");

  const { paymentPayload: p, paymentRequirements: r } = req;
  const auth = p?.payload?.authorization;

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

  // Cryptographic authorization: recover the EIP-3009 signer and require it to
  // equal `from`. Without this the structural checks above pass for a payment
  // "from" an address the caller does not control. Enforced in live mode; mock
  // mode keeps structural-only so the zero-credential demo still runs.
  if (liveMode()) {
    const verdict = await verifyAuthorizationSignature(auth, p.payload.signature, {
      network: p.network,
      asset: r.asset,
      domainName: r.extra?.name ?? "USD Coin",
      domainVersion: r.extra?.version ?? "2",
    });
    if (!verdict.verified) return fail(`invalid_signature:${verdict.reason}`);
  }

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
// for so dev/demo flows pass the gate. Used only in mock mode; live mode
// requires a real settler (createEvmSettler) or settle() fails closed.
function mockSettler(req: FacilitatorRequest, _payer: string, minConfirmations: number): SettleSubmission {
  const bytes = crypto.randomBytes(32);
  // Solana tx signatures are base58; EVM hashes are 0x-hex.
  const transaction =
    req.paymentRequirements.network === "solana"
      ? bytes.toString("base64url").slice(0, 44)
      : "0x" + bytes.toString("hex");
  return { transaction, confirmations: minConfirmations };
}

/**
 * Choose the settler when the caller doesn't inject one. In live mode ONLY a
 * real on-chain settler is acceptable — if none is configured we return null so
 * settle() fails closed rather than "settling" against a mock (which would
 * credit balances off a fake transaction). In mock/demo mode the mock settler
 * is used so the zero-credential stack still runs end-to-end.
 */
function resolveSettler(): Settler | null {
  const real = defaultSettler();
  if (real) return real;
  return liveMode() ? null : mockSettler;
}

/** Verify, then settle. Nonces are single-use (atomic across instances), and
 *  the resource is only released once the settlement reaches the confirmation
 *  depth the amount requires (Attack I-A). Pass an explicit settler to override
 *  the default (real-when-configured, else mock in demo mode only). */
export async function settle(request: AnyFacilitatorRequest, settler?: Settler): Promise<SettleResult> {
  const req = normalizeFacilitatorRequest(request);
  if (!req) return { success: false, network: "unknown", errorReason: "unsupported_version" };

  const network = req.paymentRequirements?.network ?? "unknown";
  const v = await verify(req);
  if (!v.isValid) return { success: false, network, errorReason: v.invalidReason };

  const chosen = settler ?? resolveSettler();
  if (!chosen) {
    // Live mode with no on-chain settler configured — refuse rather than mint
    // a fake settlement. Set FACILITATOR_EVM_PRIVATE_KEY to enable real settling.
    return { success: false, network, payer: v.payer, errorReason: "settler_unavailable" };
  }

  const nonce = req.paymentPayload.payload.authorization.nonce;
  const amountAtomic = req.paymentPayload.payload.authorization.value;
  const required = requiredConfirmations(amountAtomic);

  // Atomic claim across all instances — a replayed nonce loses the SET NX and
  // is rejected before any on-chain submission (Attack II duplicate-settlement).
  if (!(await kvSetNx(nonceKey(nonce), Math.floor(Date.now() / 1000), NONCE_TTL_SECONDS))) {
    return { success: false, network, payer: v.payer, errorReason: "nonce_already_used" };
  }

  try {
    const submission = await chosen(req, v.payer!, required);
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
    await recordSettlement({
      transaction: submission.transaction,
      network,
      payer: v.payer!,
      payTo: req.paymentRequirements.payTo,
      amountAtomic,
      resource: req.paymentRequirements.resource,
      settledAt: new Date().toISOString(),
      status: "confirmed",
    });
    return {
      success: true,
      transaction: submission.transaction,
      network,
      payer: v.payer,
      confirmations: submission.confirmations,
      requiredConfirmations: required,
    };
  } catch (e) {
    // Submitted-but-unconfirmed is its own class: the tx is on-chain and may
    // still settle (payer debited), so log it as pending and hand the client
    // the tx hash to poll GET /api/x402/settlement/[tx] with.
    if (e instanceof SettlementPendingError) {
      await recordSettlement({
        transaction: e.transaction,
        network,
        payer: v.payer!,
        payTo: req.paymentRequirements.payTo,
        amountAtomic,
        resource: req.paymentRequirements.resource,
        settledAt: new Date().toISOString(),
        status: "pending",
      });
      return {
        success: false,
        network,
        payer: v.payer,
        transaction: e.transaction,
        requiredConfirmations: required,
        errorReason: "settlement_pending",
      };
    }
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
