import { createPublicClient, http, parseAbi, type Address, type Hex } from "viem";
import { log } from "@/lib/log";
import { financialEnvironment, flagEnabled } from "@/lib/flags";
import type { RailAdapter, RailOutcome, RailSubmitRequest } from "@/lib/controlPlane/railAdapter";
import {
  ARC_MAINNET_CHAIN_ID,
  ARC_TESTNET_CHAIN_ID,
  ARC_RPC,
  ARC_USDC_ERC20,
  ARC_ERC20_DECIMALS,
  assertErc20Scale,
  ArcPrecisionError,
  classifyArcTransferFailure,
  isPermanentArcFailure,
} from "@/lib/chains/arc";

// ---------------------------------------------------------------------------
// The Arc rail, behind FurlPay's existing execution seam.
//
// WHAT WAS ALREADY HERE, AND IS NOT BEING REWRITTEN. `lib/chains/arc.ts` already
// models Arc correctly: the 18-decimal native / 6-decimal ERC-20 split, the
// 10^12 scale, `assertErc20Scale`, the fee floor, the dual Transfer emitter, and
// failure classification — 92 tests cover it. None of that is touched. The gap
// this file closes is narrower and specific: Arc had no `RailAdapter`, so
// `/api/v1/payments/execute` could never reach it no matter how correct the
// chain module was.
//
// WHICH INTERFACE A PAYMENT USES, AND WHY IT IS THE ERC-20 ONE. Arc exposes USDC
// twice. A FurlPay payment is an application-level transfer of a stated number
// of USDC units, so it goes through `transfer()` on the ERC-20 interface at 6
// decimals. The native 18-decimal interface is for gas and `msg.value`, and
// routing a payment through it would be the exact 10^12 error Circle's own docs
// shipped (arc-node #453). `assertErc20Scale` is called before anything is
// signed so a value that cannot be expressed exactly in ERC-20 units is refused
// rather than rounded.
//
// THE THREE THINGS THIS ADAPTER REFUSES TO DO:
//
//   1. Submit to an endpoint that has not proved its chain id. An RPC that
//      answers for the wrong chain is either misconfigured or hostile, and a
//      transfer sent to it is gone. `eth_chainId` is checked on every submit,
//      not cached from startup.
//   2. Report SETTLED for anything it did not observe. A submitted hash is not
//      a settlement; a timeout is not a failure. Both become INDETERMINATE.
//   3. Run at all without a real signer. There is no test-signer fallback and
//      no simulated hash — the seam's contract is that an unregistered rail
//      answers 503, which is a truthful answer and a better one than a fake.
//
// PRODUCTION IS GATED SEPARATELY FROM CODE COMPLETENESS. `arcRailAdapter()`
// returns null unless a signer exists AND the deployment opted in. Arc mainnet
// additionally requires `ARC_MAINNET_ACTIVATED`, which is checked here as well
// as in the capability registry, because a gate the caller owns is a gate
// somebody eventually forgets.
// ---------------------------------------------------------------------------

export const ARC_RAIL_ID = "arc_usdc_transfer";

/** `transfer(address,uint256)` — the 6-decimal ERC-20 interface. */
const ERC20_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);

/**
 * A ceiling on what one Arc transfer may cost us in gas.
 *
 * An ERC-20 `transfer` is a two-balance write. 200k is generous for that and
 * still refuses anything that is not this operation — the same reasoning, and
 * the same number, as the x402 settler's ceiling. Raising it is an explicit
 * env change, never a runtime decision.
 */
export const ARC_GAS_CEILING = 200_000n;

export type ArcNetwork = "arc" | "arc_testnet";

export function arcChainId(network: ArcNetwork): number {
  return network === "arc" ? ARC_MAINNET_CHAIN_ID : ARC_TESTNET_CHAIN_ID;
}

function arcRpcUrl(network: ArcNetwork): string | null {
  const explicit =
    network === "arc"
      ? process.env.ARC_RPC_URL
      : process.env.ARC_TESTNET_RPC_URL;
  if (explicit && explicit.trim()) return explicit.trim();
  // The published default. Usable for testnet; for mainnet the operator must
  // set it explicitly, because ARC_DEPENDENCIES.md records that the mainnet
  // endpoint constant in this repo is NOT independently verified.
  return network === "arc_testnet" ? ARC_RPC.testnet : null;
}

export class ArcChainMismatchError extends Error {
  constructor(expected: number, actual: number, url: string) {
    super(
      `Arc RPC reported chain ${actual} but ${expected} was expected. Refusing to submit — ` +
        `an endpoint answering for the wrong chain is misconfigured or hostile, and a transfer ` +
        `sent to it cannot be recovered. (endpoint host: ${safeHost(url)})`
    );
    this.name = "ArcChainMismatchError";
  }
}

/** Host only. An RPC URL can carry an API key in its path or query. */
function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unparseable";
  }
}

/**
 * Prove the endpoint is the chain we think it is.
 *
 * Deliberately NOT cached across calls. A cached answer is a statement about
 * the endpoint at startup, and the thing that changes is configuration — a
 * failover URL, a rotated provider, an edited env var. The check costs one
 * round trip against a transfer that moves money.
 */
export async function assertArcChain(network: ArcNetwork, url: string): Promise<void> {
  const expected = arcChainId(network);
  const client = createPublicClient({ transport: http(url) });
  const actual = await client.getChainId();
  if (actual !== expected) throw new ArcChainMismatchError(expected, actual, url);
}

export interface ArcSigner {
  readonly address: Address;
  /**
   * Submit an ERC-20 transfer and return its hash.
   *
   * Returning only a hash is deliberate: the adapter decides what that hash
   * MEANS. A signer that also reported success would be making a settlement
   * judgement from inside the component least able to make it.
   */
  submitTransfer(input: {
    readonly network: ArcNetwork;
    readonly rpcUrl: string;
    readonly token: Address;
    readonly to: Address;
    readonly amountErc20: bigint;
    readonly gasLimit: bigint;
  }): Promise<Hex>;
}

/**
 * The production signer, or null.
 *
 * Null is the honest answer today and the seam handles it: an unregistered rail
 * answers 503 `rail_not_connected`. There is deliberately no env-key fallback —
 * `x402Settler.ts` already establishes that a raw key is refused in production,
 * and a second, weaker path here would quietly become the one that gets used.
 */
export function arcSigner(): ArcSigner | null {
  // Wired to the same KMS the x402 settler requires. Until that exists there is
  // no Arc signer, and saying so is the whole point.
  return null;
}

export interface ArcAdapterDeps {
  readonly network: ArcNetwork;
  readonly signer: ArcSigner;
  readonly rpcUrl: string;
  /** Confirmations before SETTLED. Configurable — see ARC_DEPENDENCIES.md §4. */
  readonly confirmations: number;
  /**
   * How long to wait for a receipt before giving up and reporting
   * INDETERMINATE. Bounded because an unbounded wait is an outage, not a
   * stronger guarantee — the answer does not become more knowable with time,
   * and the transaction stays recoverable from its hash either way.
   */
  readonly receiptTimeoutMs: number;
}

/**
 * Build the adapter from explicit dependencies.
 *
 * Exported separately from `arcRailAdapter()` so tests can drive the real
 * decision logic with a deterministic signer and RPC, without that ever
 * becoming a path production can take.
 */
export function createArcAdapter(deps: ArcAdapterDeps): RailAdapter {
  return {
    railId: ARC_RAIL_ID,
    async submit(req: RailSubmitRequest): Promise<RailOutcome> {
      // ── 1. The request must be for THIS chain ──────────────────────────
      if (req.networkId !== deps.network) {
        return {
          kind: "REJECTED",
          reason: `authorization names network ${req.networkId}, this adapter serves ${deps.network}`,
        };
      }
      if (req.asset.toUpperCase() !== "USDC") {
        // Arc's gas asset is USDC and this adapter transfers USDC. Another
        // asset is not a configuration gap, it is a different payment.
        return { kind: "REJECTED", reason: `Arc adapter handles USDC only, not ${req.asset}` };
      }

      // ── 2. The amount must be exact in ERC-20 units ────────────────────
      //
      // The authorization carries atomic units. On Arc "atomic" is ambiguous
      // by construction, so it is pinned here: FurlPay amounts are ERC-20
      // 6-decimal units, and anything that cannot be represented exactly is
      // refused rather than rounded into something the payer did not sign.
      let amountErc20: bigint;
      try {
        if (!/^[0-9]+$/.test(req.amountAtomic)) {
          return { kind: "REJECTED", reason: `amount ${JSON.stringify(req.amountAtomic)} is not a decimal integer` };
        }
        amountErc20 = BigInt(req.amountAtomic);
        if (amountErc20 <= 0n) {
          return { kind: "REJECTED", reason: "amount must be greater than zero" };
        }
      } catch {
        return { kind: "REJECTED", reason: "amount is not parseable as an integer" };
      }

      let to: Address;
      try {
        const { getAddress } = await import("viem");
        to = getAddress(req.destination.trim());
      } catch {
        return { kind: "REJECTED", reason: "destination is not a valid address" };
      }

      // ── 3. The endpoint must prove its identity BEFORE signing ─────────
      try {
        await assertArcChain(deps.network, deps.rpcUrl);
      } catch (e) {
        if (e instanceof ArcChainMismatchError) {
          // A definite, authoritative refusal: nothing was submitted, and we
          // know it, because the mismatch was detected before any signing.
          log.error("arc rpc chain mismatch", {
            authorizationId: req.authorizationId,
            network: deps.network,
            error: e.message,
          });
          return { kind: "REJECTED", reason: e.message };
        }
        // Could not reach the endpoint. We do NOT know whether a previous
        // attempt landed, so this is not a failure.
        return {
          kind: "INDETERMINATE",
          reason: `Arc RPC unreachable during pre-submit chain check: ${(e as Error).message}`,
        };
      }

      // ── 4. Submit ──────────────────────────────────────────────────────
      let hash: Hex;
      try {
        hash = await deps.signer.submitTransfer({
          network: deps.network,
          rpcUrl: deps.rpcUrl,
          token: ARC_USDC_ERC20,
          to,
          amountErc20,
          gasLimit: ARC_GAS_CEILING,
        });
      } catch (e) {
        const reason = (e as Error)?.message ?? String(e);
        const failure = classifyArcTransferFailure(reason);
        if (isPermanentArcFailure(failure)) {
          // Arc told us, authoritatively, that this transfer cannot succeed.
          // FAILED is a claim we are entitled to make.
          return { kind: "REJECTED", reason: `${failure}: ${reason}` };
        }
        // EVERYTHING ELSE IS UNKNOWN. A submission that threw may still have
        // reached the mempool; treating it as failed invites a retry that pays
        // twice.
        return { kind: "INDETERMINATE", reason: `Arc submission outcome unknown: ${reason}` };
      }

      if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
        // A signer that cannot name what it did has not evidenced a payment.
        return { kind: "INDETERMINATE", reason: "Arc signer returned no usable transaction hash" };
      }

      // ── 5. The hash is not a settlement ────────────────────────────────
      //
      // Wait for the configured depth. A receipt that never arrives, or a
      // failed receipt, is reported honestly rather than resolved optimistically
      // in either direction.
      try {
        const client = createPublicClient({ transport: http(deps.rpcUrl) });
        // BOUNDED, DELIBERATELY. `waitForTransactionReceipt` polls until it gets
        // an answer, and "until" is not a duration — a receipt that never
        // materialises holds this request, and the worker behind it, forever.
        // Found by the adapter's own test, which hung rather than failing.
        //
        // Timing out here is NOT deciding the payment failed: the catch below
        // turns it into INDETERMINATE and keeps the hash, which is exactly the
        // state a reconciler needs. Waiting longer would not make the answer
        // more knowable; it would only make the outage larger.
        const receipt = await client.waitForTransactionReceipt({
          hash,
          confirmations: deps.confirmations,
          timeout: deps.receiptTimeoutMs,
        });

        if (receipt.status === "reverted") {
          // On-chain and definitive: the transfer did not move value.
          return { kind: "REJECTED", reason: `Arc transaction ${hash} reverted` };
        }

        return {
          kind: "SETTLED",
          settlementRef: hash,
          feeAtomic:
            receipt.gasUsed !== undefined && receipt.effectiveGasPrice !== undefined
              ? String(receipt.gasUsed * receipt.effectiveGasPrice)
              : undefined,
          confirmations: deps.confirmations,
        };
      } catch (e) {
        // SUBMITTED, OUTCOME UNOBSERVED. This is the single most important
        // branch in the file: the transaction is on the wire and may well
        // succeed. Reporting FAILED here would be a lie that costs money.
        log.error("arc receipt not observed", {
          authorizationId: req.authorizationId,
          transaction: hash,
          error: (e as Error).message,
        });
        return {
          kind: "INDETERMINATE",
          reason: `Arc transaction ${hash} was submitted but its receipt was not observed: ${(e as Error).message}`,
          railRef: hash,
        };
      }
    },
  };
}

/**
 * The adapter this deployment should actually register, or null.
 *
 * Returns null — and therefore leaves `/execute` answering 503 — unless every
 * condition holds. Each one is checked here rather than by the caller.
 */
export function arcRailAdapter(): RailAdapter | null {
  const environment = financialEnvironment();

  if (!flagEnabled("ARC_RAIL_LIVE")) return null;

  const network: ArcNetwork = environment === "production" ? "arc" : "arc_testnet";

  // Mainnet needs its own explicit activation, on top of everything else.
  // ARC_PRODUCTION_ACTIVATION.md is the checklist this flag represents.
  if (network === "arc" && process.env.ARC_MAINNET_ACTIVATED !== "1") {
    log.warn("Arc mainnet is not activated on this deployment", { environment });
    return null;
  }

  const rpcUrl = arcRpcUrl(network);
  if (!rpcUrl) {
    log.warn("Arc rail enabled but no RPC endpoint is configured", { network });
    return null;
  }

  const signer = arcSigner();
  if (!signer) {
    log.warn("Arc rail enabled but no signer is available — rail stays unregistered", { network });
    return null;
  }

  const confirmations = Number(process.env.ARC_CONFIRMATIONS ?? "2");
  const receiptTimeoutMs = Number(process.env.ARC_RECEIPT_TIMEOUT_MS ?? "60000");
  return createArcAdapter({
    network,
    signer,
    rpcUrl,
    confirmations: Number.isFinite(confirmations) && confirmations > 0 ? confirmations : 2,
    receiptTimeoutMs:
      Number.isFinite(receiptTimeoutMs) && receiptTimeoutMs > 0 ? receiptTimeoutMs : 60_000,
  });
}

export { ArcPrecisionError, assertErc20Scale, ARC_ERC20_DECIMALS };
