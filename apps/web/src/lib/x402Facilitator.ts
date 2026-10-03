import crypto from "crypto";
import {
  X402_VERSION,
  requiredConfirmations,
  type PaymentRequirements,
  type XPaymentPayload,
} from "@/lib/x402";
import { kvGet, kvSetNx } from "@/lib/kv";
import { signatureEnforced } from "@/lib/x402Enforcement";
import { log } from "@/lib/log";
import {
  canonicalResource,
  checkClaimConsistency,
  verifyResourceBinding,
  type NonceClaim,
} from "@/lib/x402ResourceBinding";
import { parseAtomicAmount, resolveSettlementAsset } from "@/lib/x402Assets";
import { verifyAuthorizationSignature } from "@/lib/x402Signature";
import { defaultSettler, SettlementPendingError } from "@/lib/x402Settler";
import { SettlementHaltedError } from "@/lib/settlementSafety";
import { getSettlement, recordSettlement, type SettlementRecord } from "@/lib/x402SettlementStore";

// Settlement log moved to x402SettlementStore (shared with lib/x402.ts without
// an import cycle); re-exported here for existing consumers.
export { getSettlement, recordSettlement, type SettlementRecord };

// Signature enforcement is resolved by lib/x402Enforcement.ts — the SINGLE
// authority. This file used to carry its own copy of the rule, as did x402.ts and
// mpp.ts; three identical copies that all failed OPEN when neither environment
// variable was set. Production now always enforces and cannot be configured out
// of it (SR2).
const liveMode = signatureEnforced;

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

// The networks this facilitator will actually verify AND settle — not the
// networks we would like to serve. `/supported` is the document an agent reads
// to CHOOSE a facilitator, so a network listed here is a promise.
//
// Solana is deliberately absent. The x402 exact scheme on SVM needs a
// different signature scheme (EVM_CHAIN_IDS has no entry, so
// verifyAuthorizationSignature returns `svm_verification_unavailable`) and a
// different settler (defaultSettler builds an EVM settler only). Listing it
// cost nothing to us and guaranteed a rejection for every agent that picked us
// for Solana on the strength of this list. Re-add it in the same commit that
// lands an SVM verifier and settler, never before.
const NETWORKS = ["arbitrum", "arbitrum-sepolia", "base"] as const;

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

  // ── SR8: semantic execution binding ─────────────────────────────────────
  //
  // THE HOLE THIS CLOSES, PRECISELY. `paymentRequirements.asset` arrives in the
  // REQUEST BODY, and settle() passes it straight to writeContract() as the
  // contract address, with the fee-payer paying gas. It was never checked
  // against anything. The chain of consequences:
  //
  //   1. An attacker deploys a contract M exposing a function with the
  //      `transferWithAuthorization(...)` selector.
  //   2. They POST asset = M. verifyAuthorizationSignature builds its EIP-712
  //      domain with `verifyingContract: ctx.asset`, i.e. M — and `extra.name`
  //      and `extra.version` are attacker-supplied too, so the ENTIRE domain is
  //      theirs. They sign a valid authorization over it with their own key,
  //      from their own address.
  //   3. verify() passes: scheme and network are supported, `auth.to` equals the
  //      `payTo` they also supplied, the amount covers the `maxAmountRequired`
  //      they also supplied, the window is theirs, and the signature recovers to
  //      `from` correctly, because it is genuinely their signature.
  //   4. settle() calls M with OUR fee-payer as msg.sender and no gas ceiling.
  //
  // That is arXiv:2607.19545's SR8 violated, which is what makes its SR6 (Gas
  // Abuse) unbounded: M can burn the block gas limit per call, and the route
  // allows 30 requests per minute per IP with no authentication at all.
  //
  // THE FIX IS THE ALLOWLIST THE CODEBASE ALREADY DEFINES. NETWORK_USDC and
  // NETWORK_XSGD name the canonical, on-chain-verified contract per network.
  // `/supported` already promises callers which (scheme, network) pairs we
  // settle; this makes the asset half of that promise enforced rather than
  // implied. An unrecognised asset is refused here, before any signature work.
  //
  // THE DOMAIN IS DERIVED, NOT ACCEPTED. `extra.name`/`extra.version` are no
  // longer trusted. Once the asset is pinned, a wrong name would still let
  // verify() pass and then revert on-chain — we would pay gas for a guaranteed
  // failure — so the domain is taken from our own registry for the pinned asset.
  const assetCheck = resolveSettlementAsset(p.network, r.asset);
  if (!assetCheck.ok) return fail(assetCheck.reason);

  // Recipient must be exactly who the resource server asked to be paid.
  if ((auth.to || "").toLowerCase() !== (r.payTo || "").toLowerCase()) return fail("recipient_mismatch");

  // Amount must cover the required amount (atomic units).
  //
  // SR5 (fail-fast validation) requires refusing economically meaningless
  // payments, and the comparison alone does not. Confirmed by a live request:
  // `maxAmountRequired: "-1"` made `BigInt(value) < BigInt(-1)` false, so a
  // NEGATIVE requirement was trivially satisfied by any amount and verify()
  // answered isValid. A zero requirement is the same defect one step milder.
  // Neither is a theft path — the transferred amount is the payer's own signed
  // `auth.value` — but a facilitator that certifies a nonsensical requirement is
  // certifying something, and a resource server is entitled to rely on it.
  //
  // Both sides are bounded: the requirement must be positive to mean anything,
  // and the authorization must move a positive amount to be worth settling.
  //
  // PARSED STRICTLY, NOT COERCED. `BigInt()` is a lenient coercion that accepts
  // "0x10" as 16, " 1 " as 1 and "" as 0 — see parseAtomicAmount for the measured
  // list and for why the danger is representation disagreement between components
  // rather than arithmetic. This is the gate: once a non-canonical amount is
  // refused here, none reaches the signature verifier, the settler, or the
  // settlement store, so the whole path downstream sees one representation.
  const required = parseAtomicAmount(r.maxAmountRequired);
  const offered = parseAtomicAmount(auth.value);
  if (offered === null) return fail("invalid_amount");
  if (required === null) return fail("invalid_required_amount");
  if (required <= 0n) return fail("invalid_required_amount");
  if (offered <= 0n) return fail("invalid_amount");
  if (offered < required) return fail("insufficient_amount");

  // Authorization validity window.
  const now = Math.floor(Date.now() / 1000);
  const vAfter = Number(auth.validAfter);
  const vBefore = Number(auth.validBefore);
  if (Number.isFinite(vAfter) && now < vAfter) return fail("not_yet_valid");
  if (Number.isFinite(vBefore) && now > vBefore) return fail("authorization_expired");

  // ── SR1: the payment must be for the resource the requirements name ──────
  //
  // Previously unchecked, which is the paper's F1. The leak is not double
  // settlement — the single-use nonce closes that — it is DOUBLE DELIVERY:
  // `/verify` burns nothing, so one authorization presented to two resource
  // servers with the same price and payee made both of them serve.
  //
  // lib/x402.ts already mints `extra.binding` = HMAC(method, resource, amount,
  // quoteId, expiresAt) on every quote it issues; this verifies the same
  // commitment with the same function, so the two cannot drift.
  const bindingCheck = verifyResourceBinding({
    resource: r.resource,
    method: r.extra?.method,
    amountAtomic: r.maxAmountRequired,
    extra: r.extra,
    nowSeconds: now,
  });
  if (!bindingCheck.ok) return fail(bindingCheck.reason);

  // Cryptographic authorization: recover the EIP-3009 signer and require it to
  // equal `from`. Without this the structural checks above pass for a payment
  // "from" an address the caller does not control. Enforced in live mode; mock
  // mode keeps structural-only so the zero-credential demo still runs.
  if (liveMode()) {
    const verdict = await verifyAuthorizationSignature(auth, p.payload.signature, {
      network: p.network,
      // The PINNED address, not the requested one. They are equal whenever the
      // check above passed, and using the resolved value means a future edit to
      // that check cannot accidentally leave an unpinned asset in the domain.
      asset: assetCheck.address,
      domainName: assetCheck.domainName,
      domainVersion: assetCheck.domainVersion,
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
  //
  // THE CLAIM NOW RECORDS WHAT IT WAS CLAIMED FOR (SR1, verify/settle
  // divergence). `/verify` and `/settle` are separate calls with separate
  // bodies, so without this an authorization could be verified for resource A
  // and settled for resource B: the nonce still admits only one settlement, but
  // the settlement record and the evidence would name a resource the payer never
  // authorized. Storing the tuple makes that divergence detectable instead of
  // silent.
  const claim: NonceClaim = {
    resource: canonicalResource(req.paymentRequirements.resource ?? "") ?? "",
    amountAtomic,
    payTo: req.paymentRequirements.payTo ?? "",
    claimedAtSeconds: Math.floor(Date.now() / 1000),
  };
  if (!(await kvSetNx(nonceKey(nonce), claim, NONCE_TTL_SECONDS))) {
    // The nonce is taken. Read what it was taken FOR: a replay of the same
    // payment is `nonce_already_used`, but a replay against a DIFFERENT resource
    // is a substitution attempt and deserves its own reason so an operator can
    // tell the two apart in the logs.
    const previous = await kvGet<NonceClaim>(nonceKey(nonce)).catch(() => null);
    if (previous && typeof previous === "object" && "resource" in previous) {
      const consistency = checkClaimConsistency(previous, claim);
      if (!consistency.ok) {
        log.warn("x402 nonce presented against a different context", {
          network,
          reason: consistency.reason,
          detail: consistency.detail,
        });
        return { success: false, network, payer: v.payer, errorReason: consistency.reason };
      }
    }
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
    // The settlement safety controller refused BEFORE broadcast
    // (lib/settlementSafety.ts): nothing was sent. A refusal after broadcast
    // (receipt mismatch) arrives as SettlementPendingError above instead. The
    // nonce stays burned, as below.
    if (e instanceof SettlementHaltedError) {
      return { success: false, network, payer: v.payer, errorReason: "settlement_halted" };
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
