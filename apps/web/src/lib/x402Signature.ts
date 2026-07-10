import { createPublicClient, verifyTypedData, type Address, type Hex, type TypedDataDefinition } from "viem";
import { EVM_CHAINS, rpcTransport } from "@/lib/x402Chains";
import { log } from "@/lib/log";

// ---------------------------------------------------------------------------
// EIP-3009 authorization signature verification (the cryptographic core the
// x402 "exact/evm" scheme is built on).
//
// A payer signs an EIP-712 typed `TransferWithAuthorization` message; the
// facilitator MUST recover the signer and confirm it equals `authorization.from`
// before it will submit the transfer on-chain. Without this, anyone can present
// a well-formed authorization "from" an address they do not control — the
// structural checks (amount/recipient/window) would all pass. This is the check
// that makes a payment actually authorized by the account being debited.
//
// Reference: EIP-3009 (transferWithAuthorization), EIP-712 typed data; the
// domain binds the signature to one token contract on one chain, so it cannot
// be replayed to a different asset or network.
// ---------------------------------------------------------------------------

/** EIP-712 primaryType + field layout for EIP-3009 transferWithAuthorization. */
const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/** Canonical EVM chain ids for the networks x402 settles on. Solana is not an
 *  EVM chain — its authorizations use ed25519, not EIP-712, and are verified
 *  separately (not yet implemented; see verifyAuthorizationSignature). */
export const EVM_CHAIN_IDS: Record<string, number> = {
  arbitrum: 42161,
  "arbitrum-sepolia": 421614,
  base: 8453,
  "base-sepolia": 84532,
  polygon: 137,
  ethereum: 1,
};

export interface AuthorizationFields {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

export interface SignatureContext {
  network: string;
  /** Token contract the authorization is for — the EIP-712 verifyingContract. */
  asset: string;
  /** Token EIP-712 domain name (e.g. "USD Coin") and version (e.g. "2"),
   *  as advertised in the 402 quote's `extra`. Must match the token's own
   *  domain or recovery fails. */
  domainName: string;
  domainVersion: string;
}

export type SignatureVerdict =
  | { verified: true }
  | { verified: false; reason: string };

const isHexAddress = (s: string): s is Address => /^0x[0-9a-fA-F]{40}$/.test(s);
const isHex = (s: string): s is Hex => /^0x[0-9a-fA-F]+$/.test(s);
const isBytes32 = (s: string): s is Hex => /^0x[0-9a-fA-F]{64}$/.test(s);

/**
 * Recover the EIP-3009 signer and confirm it equals `authorization.from`.
 *
 * EVM networks: full EIP-712 verification, fail-closed on any malformed field
 * or recovery mismatch. Solana: returns `svm_verification_unavailable` — the
 * caller decides whether to fail closed (recommended once a live SVM settler
 * exists) or fall through (there is no live Solana settlement route today).
 */
export async function verifyAuthorizationSignature(
  auth: AuthorizationFields,
  signature: string,
  ctx: SignatureContext
): Promise<SignatureVerdict> {
  const chainId = EVM_CHAIN_IDS[ctx.network];
  if (chainId === undefined) {
    // Non-EVM (Solana): different signature scheme. Signal explicitly so the
    // caller never mistakes "not checked" for "checked and valid".
    return { verified: false, reason: "svm_verification_unavailable" };
  }

  if (!isHexAddress(auth.from) || !isHexAddress(auth.to)) return { verified: false, reason: "bad_address" };
  if (!isHexAddress(ctx.asset)) return { verified: false, reason: "bad_asset" };
  if (!isBytes32(auth.nonce)) return { verified: false, reason: "bad_nonce" };
  if (!isHex(signature) || (signature.length !== 132 && signature.length !== 130)) {
    return { verified: false, reason: "bad_signature_format" };
  }

  let value: bigint, validAfter: bigint, validBefore: bigint;
  try {
    value = BigInt(auth.value);
    validAfter = BigInt(auth.validAfter);
    validBefore = BigInt(auth.validBefore);
  } catch {
    return { verified: false, reason: "bad_numeric_field" };
  }

  const typedData = {
    domain: {
      name: ctx.domainName,
      version: ctx.domainVersion,
      chainId,
      verifyingContract: ctx.asset as Address,
    },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: auth.from as Address,
      to: auth.to as Address,
      value,
      validAfter,
      validBefore,
      nonce: auth.nonce as Hex,
    },
  } as const satisfies TypedDataDefinition;

  // Fast path: pure ECDSA recovery (EOA signers) — no RPC round-trip.
  try {
    const ok = await verifyTypedData({
      address: auth.from as Address,
      ...typedData,
      signature: signature as Hex,
    });
    if (ok) return { verified: true };
  } catch (e) {
    log.warn("EIP-3009 signature verification threw", { error: (e as Error).message, network: ctx.network });
  }

  // Smart-contract wallets (Safe, 4337 accounts): no key to recover, so ECDSA
  // fails — but USDC v2.2 itself accepts ERC-1271 signatures on-chain, so we
  // must too or we reject payments the token would settle. viem's client-side
  // verifyTypedData handles EOA + ERC-1271 + ERC-6492 (pre-deploy wallets) via
  // eth_call. Only attempted after the ECDSA fast path fails, and it fails
  // closed on RPC errors.
  const chain = EVM_CHAINS[ctx.network];
  if (chain) {
    try {
      const client = createPublicClient({ chain, transport: rpcTransport(ctx.network) });
      const ok = await client.verifyTypedData({
        address: auth.from as Address,
        ...typedData,
        signature: signature as Hex,
      });
      if (ok) return { verified: true };
    } catch (e) {
      log.warn("ERC-1271 signature verification failed", { error: (e as Error).message, network: ctx.network });
      return { verified: false, reason: "signature_verification_error" };
    }
  }
  return { verified: false, reason: "signature_recovery_mismatch" };
}

/** True when this network's authorizations can be cryptographically verified
 *  here (EVM/EIP-712). Solana returns false until an SVM verifier is wired. */
export function canVerifySignature(network: string): boolean {
  return EVM_CHAIN_IDS[network] !== undefined;
}
