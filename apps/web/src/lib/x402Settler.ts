import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseSignature,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum, arbitrumSepolia, base, baseSepolia, polygon, mainnet } from "viem/chains";
import type { Chain } from "viem";
import type { FacilitatorRequest, Settler, SettleSubmission } from "@/lib/x402Facilitator";
import { EVM_CHAIN_IDS } from "@/lib/x402Signature";
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

const EVM_CHAINS: Record<string, Chain> = {
  arbitrum,
  "arbitrum-sepolia": arbitrumSepolia,
  base,
  "base-sepolia": baseSepolia,
  polygon,
  ethereum: mainnet,
};

// transferWithAuthorization with (v, r, s) — the form USDC (FiatTokenV2)
// exposes. The 65-byte compact signature is split into components on-chain.
const EIP3009_ABI = parseAbi([
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
]);

/** Per-network RPC override, else the chain's public default. */
function rpcUrl(network: string): string | undefined {
  const perNetwork: Record<string, string | undefined> = {
    arbitrum: process.env.ARBITRUM_RPC_URL,
    "arbitrum-sepolia": process.env.ARBITRUM_SEPOLIA_RPC_URL,
    base: process.env.BASE_RPC_URL,
    "base-sepolia": process.env.BASE_SEPOLIA_RPC_URL,
    polygon: process.env.POLYGON_RPC_URL,
    ethereum: process.env.ETHEREUM_RPC_URL,
  };
  return perNetwork[network];
}

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
    const url = rpcUrl(network);
    const transport = url ? http(url) : http();

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
    // success — never release a resource on a reorg-able settlement.
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: minConfirmations,
    });
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

/** Process-wide settler: the real EVM settler when a key is configured, else
 *  null. Cached so we build one wallet client per instance, not per request. */
let cached: Settler | null | undefined;
export function defaultSettler(): Settler | null {
  if (cached === undefined) cached = createEvmSettler();
  return cached;
}
