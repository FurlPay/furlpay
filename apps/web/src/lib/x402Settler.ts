import {
  createPublicClient,
  createWalletClient,
  parseAbi,
  parseSignature,
  type Account,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { FacilitatorRequest, Settler, SettleSubmission } from "@/lib/x402Facilitator";
import { EVM_CHAIN_IDS } from "@/lib/x402Signature";
import { EVM_CHAINS, rpcTransport } from "@/lib/x402Chains";
import { createKmsAccount, kmsAccountAvailable } from "@/lib/kmsAccount";
import { financialEnvironment, flagEnabled, flagState } from "@/lib/flags";
import { log } from "@/lib/log";
import { resolveSettlementAsset, settlementGasLimit, parseAtomicAmount } from "@/lib/x402Assets";
import { afterReceipt, beforeBroadcast } from "@/lib/settlementGuard";
import type { SettlementExpectedTransfer } from "@/lib/x402SettlementStore";

// ---------------------------------------------------------------------------
// Real on-chain x402 settler (EVM). This is the injectable `Settler` that
// turns the facilitator from a deterministic mock into an actual money mover:
// it submits the payer's signed EIP-3009 `transferWithAuthorization` to the
// token contract, so USDC/XSGD moves payer → recipient in one transaction and
// the FACILITATOR (not the payer) pays gas — the gasless meta-transaction that
// makes agentic micropayments viable.
//
// WHERE THE SIGNING KEY COMES FROM, and the bug this ordering fixes.
//
// This module used to do exactly one thing to obtain a signer:
//   privateKeyToAccount(process.env.FACILITATOR_EVM_PRIVATE_KEY)
// which walked straight past lib/kms.ts — the module whose entire purpose is
// that application code asks for a SIGNATURE and never for a KEY. lib/kms.ts
// refuses env-key signing in production; that refusal was unreachable, because
// nothing routed through it. Likewise ONCHAIN_SETTLEMENT_LIVE requires
// FURLPAY_KMS_PROVIDER, and this file never consulted the flag. Two correct
// controls, neither wired to the thing it guarded.
//
// The resolution order is now, in priority:
//   1. A KMS-backed account (FURLPAY_KMS_PROVIDER + the fee-payer address).
//      No key material in this process. This is the only acceptable production
//      configuration.
//   2. FACILITATOR_EVM_PRIVATE_KEY — DEVELOPMENT AND STAGING ONLY. Refused
//      outright when financialEnvironment() === "production", in this file as
//      well as in EnvKeySigner's constructor, because a guard the caller owns
//      is a guard somebody eventually forgets.
//
// And in staging/production the settler additionally requires
// ONCHAIN_SETTLEMENT_LIVE to be on, so broadcasting real transactions is an
// explicit, per-capability decision with a kill switch, not a side effect of
// an env var being present.
//
// Either way the fee-payer holds GAS ONLY: EIP-3009 moves payer → payTo
// directly, so this account never custodies user funds. Fund it from cold
// storage and keep it separate from the treasury.
//
// Confirmation depth: settle() hands us the `minConfirmations` the amount
// requires (Attack I-A, revert-grant). We wait for exactly that depth before
// reporting success, so the resource is never released on a reorg-able tx.
// ---------------------------------------------------------------------------

/**
 * Thrown when the authorization was SUBMITTED on-chain but the settler could
 * not observe the required confirmation depth (RPC timeout / lag). This is not
 * "settlement failed": the transfer may still confirm — the payer may already
 * be debited — so callers must surface the tx hash and point the client at
 * GET /api/x402/settlement/[tx] instead of reporting a plain failure. The
 * EIP-3009 nonce stays burned either way (re-signing needs a fresh nonce).
 */
export class SettlementPendingError extends Error {
  readonly transaction: Hex;
  readonly network: string;
  constructor(transaction: Hex, network: string, cause: string) {
    super(`settlement pending: tx ${transaction} submitted on ${network} but confirmation not observed (${cause})`);
    this.transaction = transaction;
    this.network = network;
  }
}

// transferWithAuthorization with (v, r, s) — the form USDC (FiatTokenV2)
// exposes. The 65-byte compact signature is split into components on-chain.
const EIP3009_ABI = parseAbi([
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
]);

/**
 * Resolve the fee-payer account, preferring the KMS.
 *
 * Returns null (never throws) when nothing usable is configured, so the caller
 * fails closed with `settler_unavailable` rather than crashing a settlement.
 * Every refusal is logged with its reason: "we cannot settle" and "we chose not
 * to settle" look identical from outside, and an operator needs to tell them
 * apart.
 */
function resolveFeePayerAccount(): Account | null {
  const environment = financialEnvironment();

  // 1. KMS-backed. The address is public configuration, not a secret; without
  //    it we cannot know WHICH key to ask for, so a KMS with no address set is
  //    a misconfiguration worth naming rather than silently skipping.
  const kmsAddress = (process.env.FACILITATOR_EVM_ADDRESS ?? "").trim();
  if (kmsAccountAvailable()) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(kmsAddress)) {
      log.error("a KMS is configured but FACILITATOR_EVM_ADDRESS is missing or malformed", {
        environment,
      });
      return null;
    }
    const account = createKmsAccount({
      keyId: "furlpay-gas-sponsor",
      purpose: "gas-sponsor",
      address: kmsAddress as Hex,
    });
    if (account) return account;
    log.error("KMS reported available but produced no account", { environment });
    return null;
  }

  // 2. Raw env key — never in production. This is the branch lib/kms.ts exists
  //    to make unreachable there, enforced here too so the settler cannot be
  //    the one caller that skips it.
  const rawKey = process.env.FACILITATOR_EVM_PRIVATE_KEY;
  if (!rawKey) return null;

  if (environment === "production") {
    log.error(
      "refusing to sign with FACILITATOR_EVM_PRIVATE_KEY in production — configure FURLPAY_KMS_PROVIDER",
      { environment }
    );
    return null;
  }

  const key = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as Hex;
  try {
    return privateKeyToAccount(key);
  } catch (e) {
    log.error("FACILITATOR_EVM_PRIVATE_KEY is not a valid private key", { error: (e as Error).message });
    return null;
  }
}

/** Whether a real EVM settler can be constructed in this deployment. */
export function liveSettlerAvailable(): boolean {
  return createEvmSettler() !== null;
}

/**
 * Build the real on-chain settler, or return null when this deployment must not
 * broadcast (caller then keeps the mock path in dev, or refuses to settle).
 * The returned function matches the `Settler` type injected into settle().
 */
export function createEvmSettler(): Settler | null {
  // Broadcasting real transactions is a per-capability decision with its own
  // kill switch, checked BEFORE any key is resolved. Development is exempt:
  // ONCHAIN_SETTLEMENT_LIVE may not be enabled there at all (flags.ts), and the
  // local-chain verification path in docs/GO-LIVE-MONEY.md §3a depends on this
  // settler working against a hardhat node.
  const environment = financialEnvironment();
  if (environment !== "development" && !flagEnabled("ONCHAIN_SETTLEMENT_LIVE")) {
    const state = flagState("ONCHAIN_SETTLEMENT_LIVE");
    log.warn("on-chain settlement is not enabled on this deployment", {
      environment,
      reason: state.blocker?.reason,
      detail: state.blocker?.detail,
    });
    return null;
  }

  const account = resolveFeePayerAccount();
  if (!account) return null;

  return async (req: FacilitatorRequest, _payer: string, minConfirmations: number): Promise<SettleSubmission> => {
    const network = req.paymentRequirements.network;
    const chain = EVM_CHAINS[network];
    if (!chain || EVM_CHAIN_IDS[network] === undefined) {
      throw new Error(`no EVM settler for network ${network}`);
    }
    const transport = rpcTransport(network);

    const publicClient = createPublicClient({ chain, transport });
    const walletClient = createWalletClient({ account, chain, transport });

    const auth = req.paymentPayload.payload.authorization;
    // Split the 65-byte signature into (v, r, s). parseSignature yields
    // yParity (0/1); USDC's transferWithAuthorization expects v ∈ {27,28}.
    const parsed = parseSignature(req.paymentPayload.payload.signature as Hex);
    const r = parsed.r;
    const s = parsed.s;
    const v = parsed.v !== undefined ? Number(parsed.v) : 27 + parsed.yParity;

    // ── The contract address is RE-RESOLVED, not trusted ──────────────────
    //
    // verify() pins the asset to the per-network allowlist and settle() always
    // calls verify() first, so by here the address is already known-good. This
    // repeats the check anyway, because this is the line that actually spends
    // our gas on somebody else's bytecode. The cost is one map lookup; the thing
    // it prevents is a future refactor that reorders or short-circuits verify()
    // and reopens an arbitrary-contract call without anyone noticing.
    const pinned = resolveSettlementAsset(network, req.paymentRequirements.asset);
    if (!pinned.ok) {
      throw new Error(`refusing to settle against a non-allowlisted asset (${pinned.reason})`);
    }

    // Submit the payer's signed authorization. The token contract re-verifies
    // the EIP-712 signature and the nonce on-chain; we already verified both
    // off-chain in the facilitator, so a revert here is exceptional.
    //
    // GAS IS BOUNDED (arXiv:2607.19545 SR6, "sponsored execution must be
    // constrained by configurable upper bounds"). WE pay this gas, and the
    // caller is unauthenticated by protocol design, so an unbounded `gas` field
    // means an unbounded bill. The default is derived from the operation rather
    // than guessed: `transferWithAuthorization` on FiatTokenV2_2 is an ecrecover
    // plus two balance writes and a nonce write, which lands under ~100k gas, so
    // 200k is generous headroom for a proxy hop and still refuses anything that
    // is not this operation. Raising it is an explicit env change.
    // F-20. These were `BigInt(auth.value)` inline, which is the coercing
    // built-in rather than this repository's rule for an atomic amount.
    // `BigInt` accepts hex, octal, binary, a leading sign, surrounding
    // whitespace, and the empty string as ZERO — so `"0x10"` submitted sixteen
    // units while `recordSettlement` stored the literal `"0x10"` in the
    // settlement record and the evidence trail. No signature is bypassed (EIP-712
    // hashes numerically, so `"0x10"` and `"16"` share a digest), but the chain
    // and the audit trail would disagree about what happened, which is the
    // canonicalization mismatch F-9 exists to prevent.
    //
    // This is the last line before a transaction is signed, so it refuses rather
    // than coerces. The facilitator validates upstream; a second gate here costs
    // nothing and removes the assumption that it always ran.
    const settleValue = parseAtomicAmount(auth.value);
    const settleValidAfter = parseAtomicAmount(auth.validAfter);
    const settleValidBefore = parseAtomicAmount(auth.validBefore);
    if (settleValue === null || settleValidAfter === null || settleValidBefore === null) {
      throw new Error(
        `invalid_amount: authorization carries a non-canonical numeric field; refusing to settle ` +
          `(value=${JSON.stringify(auth.value)})`
      );
    }

    // ── Settlement safety: the last gate before anything is signed ────────
    // Chain identity and RPC health for this network, the settlement velocity
    // cap, then the durable epoch-fenced halt state — refused on any failure to
    // read it (lib/settlementGuard.ts). Every caller of the settler (facilitator,
    // paywall, MPP, gasless transfers, account funding) passes through here, so
    // a halt cannot be bypassed by a route that forgot a pause check.
    await beforeBroadcast(network);

    const hash = await walletClient.writeContract({
      address: pinned.address as Address,
      abi: EIP3009_ABI,
      functionName: "transferWithAuthorization",
      gas: settlementGasLimit(),
      args: [
        auth.from as Address,
        auth.to as Address,
        settleValue,
        settleValidAfter,
        settleValidBefore,
        auth.nonce as Hex,
        v,
        r,
        s,
      ],
    });

    // Wait for the confirmation depth this amount requires before reporting
    // success — never release a resource on a reorg-able settlement. From this
    // point the tx is on the wire: a timeout is NOT a failure (the payer may
    // still be debited), so surface it as pending with the hash attached.
    // REPLACEMENT IS NOT FAILURE, AND IT IS NOT THE SAME TRANSACTION.
    //
    // A fee bump, a speed-up or a cancel from the fee-payer reuses the nonce
    // and produces a DIFFERENT hash. The original can then never confirm, so
    // waiting on it is waiting forever — and the previous code did exactly
    // that: `waitForTransactionReceipt` eventually timed out, the settlement
    // was logged pending against a hash that was already dead, and the client
    // polled it indefinitely. viem surfaces the replacement; we follow it, and
    // everything downstream keys off the hash that actually landed.
    let replacedBy: Hex | undefined;
    let receipt;
    try {
      receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: minConfirmations,
        onReplaced: (replacement) => {
          replacedBy = replacement.transaction.hash;
          log.warn("x402 settlement transaction was replaced", {
            network,
            original: hash,
            replacedBy,
            reason: replacement.reason,
          });
        },
      });
    } catch (e) {
      throw new SettlementPendingError(replacedBy ?? hash, network, (e as Error).message);
    }
    // The hash that ACTUALLY landed. Everything after this point — the revert
    // check, the confirmation count, the settlement record, the hash handed to
    // the client — must use the replacement, not the one we submitted.
    const landed = (receipt.transactionHash ?? replacedBy ?? hash) as Hex;

    if (receipt.status !== "success") {
      throw new Error(`settlement reverted on-chain (tx ${landed})`);
    }

    // `success` is not enough: the receipt must show exactly the authorized
    // transfer (from, to, value) and the authorization's nonce consumed. A
    // mismatch halts the network and is never reported as settled.
    //
    // It surfaces as SettlementPendingError, not as a plain failure: the tx IS
    // on-chain and its outcome is disputed. Every caller (facilitator, paywall,
    // MPP, gasless) already records that class as PENDING with the hash, which
    // puts it in the unresolved index that blocks recovery until a human
    // resolves it. A plain error would let three of the four callers drop it.
    try {
      await afterReceipt(
        network,
        receipt.logs,
        { token: pinned.address, from: auth.from, to: auth.to, value: settleValue, nonce: auth.nonce },
        landed,
      );
    } catch (e) {
      throw new SettlementPendingError(landed, network, (e as Error).message);
    }

    const confirmations = Number(
      await publicClient
        .getTransactionConfirmations({ hash: landed })
        .catch(() => BigInt(minConfirmations))
    );
    log.info("x402 on-chain settlement confirmed", {
      network,
      tx: landed,
      ...(landed !== hash ? { submittedAs: hash } : {}),
      confirmations,
      value: auth.value,
    });
    return { transaction: landed, confirmations };
  };
}

/**
 * Resolve a pending settlement directly against the chain (the recovery poll
 * behind GET /api/x402/settlement/[tx]). Read-only — needs an RPC, not the
 * fee-payer key. Returns null when the network is not an EVM chain we know.
 */
export async function checkSettlementOnChain(
  txHash: string,
  network: string,
  expected?: SettlementExpectedTransfer,
): Promise<{ found: boolean; confirmed: boolean; confirmations: number; receiptVerified?: boolean } | null> {
  const chain = EVM_CHAINS[network];
  if (!chain || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return null;
  const publicClient = createPublicClient({ chain, transport: rpcTransport(network) });
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash as Hex });
    if (receipt.status !== "success") return { found: true, confirmed: false, confirmations: 0 };
    const confirmations = Number(await publicClient.getTransactionConfirmations({ hash: txHash as Hex }));
    if (!expected) return { found: true, confirmed: true, confirmations };

    // Recovery runs after the original request is gone, so it can only be as
    // trustworthy as the expected effect durably stored with that request.
    // Reject malformed stored data too: accepting a successful receipt without
    // a usable expected transfer would recreate the bypass this check closes.
    if (!/^[1-9]\d*$/.test(expected.valueAtomic)) {
      return { found: true, confirmed: true, confirmations, receiptVerified: false };
    }
    try {
      await afterReceipt(
        network,
        receipt.logs,
        {
          token: expected.token,
          from: expected.from,
          to: expected.to,
          value: BigInt(expected.valueAtomic),
          nonce: expected.nonce,
        },
        txHash,
      );
      return { found: true, confirmed: true, confirmations, receiptVerified: true };
    } catch {
      // afterReceipt has already recorded the receipt-mismatch finding and
      // tripped the network (or shadow alert). The caller now keeps this
      // settlement out of the success path for manual reconciliation.
      return { found: true, confirmed: true, confirmations, receiptVerified: false };
    }
  } catch {
    // Not found yet (still in mempool / dropped) — not proof of failure.
    return { found: false, confirmed: false, confirmations: 0 };
  }
}

/** Process-wide settler: the real EVM settler when a key is configured, else
 *  null. Cached so we build one wallet client per instance, not per request. */
let cached: Settler | null | undefined;
export function defaultSettler(): Settler | null {
  if (cached === undefined) cached = createEvmSettler();
  return cached;
}
