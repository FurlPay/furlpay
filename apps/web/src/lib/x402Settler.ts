import {
  createPublicClient,
  createWalletClient,
  parseAbi,
  parseSignature,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { FacilitatorRequest, Settler, SettleSubmission } from "@/lib/x402Facilitator";
import { EVM_CHAIN_IDS } from "@/lib/x402Signature";
import { EVM_CHAINS, rpcTransport } from "@/lib/x402Chains";
import { log } from "@/lib/log";

// ---------------------------------------------------------------------------
// Real on-chain x402 settler (EVM). This is the injectable `Settler` that
// turns the facilitator from a deterministic mock into an actual money mover:
// it submits the payer's signed EIP-3009 `transferWithAuthorization` to the
// token contract, so USDC/XSGD moves payer → recipient in one transaction and
// the FACILITATOR (not the payer) pays gas — the gasless meta-transaction that
// makes agentic micropayments viable.
//
// Availability is gated on FACILITATOR_EVM_PRIVATE_KEY. Without it, no real
// settler is constructed and the facilitator stays on the mock path — so a
// misconfigured deployment degrades to "cannot settle" (fail closed), never to
// "credits balance off a fake settlement". The key is a hot signing key: use a
// dedicated fee-payer account with only gas, funded from cold storage, and
// ideally a KMS/HSM-backed signer in production (see docs).
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

/** Whether a real EVM settler can be constructed in this deployment. */
export function liveSettlerAvailable(): boolean {
  return !!process.env.FACILITATOR_EVM_PRIVATE_KEY;
}

/**
 * Build the real on-chain settler, or return null when no signing key is
 * configured (caller then keeps the mock path / refuses to settle). The
 * returned function matches the `Settler` type injected into settle().
 */
export function createEvmSettler(): Settler | null {
  const rawKey = process.env.FACILITATOR_EVM_PRIVATE_KEY;
  if (!rawKey) return null;

  const key = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as Hex;
  let account;
  try {
    account = privateKeyToAccount(key);
  } catch (e) {
    log.error("FACILITATOR_EVM_PRIVATE_KEY is not a valid private key", { error: (e as Error).message });
    return null;
  }

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

    // Submit the payer's signed authorization. The token contract re-verifies
    // the EIP-712 signature and the nonce on-chain; we already verified both
    // off-chain in the facilitator, so a revert here is exceptional.
    const hash = await walletClient.writeContract({
      address: req.paymentRequirements.asset as Address,
      abi: EIP3009_ABI,
      functionName: "transferWithAuthorization",
      args: [
        auth.from as Address,
        auth.to as Address,
        BigInt(auth.value),
        BigInt(auth.validAfter),
        BigInt(auth.validBefore),
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
    let receipt;
    try {
      receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: minConfirmations,
      });
    } catch (e) {
      throw new SettlementPendingError(hash, network, (e as Error).message);
    }
    if (receipt.status !== "success") {
      throw new Error(`settlement reverted on-chain (tx ${hash})`);
    }

    const confirmations = Number(
      await publicClient.getTransactionConfirmations({ hash }).catch(() => BigInt(minConfirmations))
    );
    log.info("x402 on-chain settlement confirmed", {
      network,
      tx: hash,
      confirmations,
      value: auth.value,
    });
    return { transaction: hash, confirmations };
  };
}

/**
 * Resolve a pending settlement directly against the chain (the recovery poll
 * behind GET /api/x402/settlement/[tx]). Read-only — needs an RPC, not the
 * fee-payer key. Returns null when the network is not an EVM chain we know.
 */
export async function checkSettlementOnChain(
  txHash: string,
  network: string
): Promise<{ found: boolean; confirmed: boolean; confirmations: number } | null> {
  const chain = EVM_CHAINS[network];
  if (!chain || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return null;
  const publicClient = createPublicClient({ chain, transport: rpcTransport(network) });
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash as Hex });
    if (receipt.status !== "success") return { found: true, confirmed: false, confirmations: 0 };
    const confirmations = Number(await publicClient.getTransactionConfirmations({ hash: txHash as Hex }));
    return { found: true, confirmed: true, confirmations };
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
