import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@/lib/evm/rlp";
import { call, type ChainSlug } from "@/lib/evm/rpc";
import { readErc20Balance } from "@/lib/tokens/erc20Metadata";
import type { StakingAccounting, StakingPosition, StakingProtocol } from "./types";

// ---------------------------------------------------------------------------
// The contract calls behind liquid staking.
//
// TWO SHAPES, AND ONLY TWO, because a wallet that tries to speak every
// protocol's bespoke ABI ends up guessing at one of them:
//
//   ERC-4626   the tokenized-vault standard. `deposit`, `redeem`,
//              `convertToAssets` — a published interface with a fixed ABI, so
//              the encoding below is derived from the standard rather than from
//              any one deployment.
//
//   NATIVE     a payable `submit()`-style entrypoint that takes the chain's own
//              coin and mints a receipt token. This is how ETH liquid staking
//              works, and the receipt's value is read from the token itself.
//
// SELECTORS ARE COMPUTED FROM SIGNATURES, never pasted. Four bytes of hex carry
// no meaning a reviewer can check, and a transposed digit in a DEPOSIT selector
// sends a user's ETH to a function that is not the one they chose.
//
// NO ADDRESSES LIVE HERE. Every function takes the contract as an argument, and
// the caller got it from verified server configuration. See ./types.ts.
// ---------------------------------------------------------------------------

function selector(signature: string): string {
  return bytesToHex(keccak_256(new TextEncoder().encode(signature)).slice(0, 4));
}

export const STAKING_SELECTORS = {
  // ERC-4626, from the standard.
  deposit4626: selector("deposit(uint256,address)"),
  redeem4626: selector("redeem(uint256,address,address)"),
  convertToAssets: selector("convertToAssets(uint256)"),
  previewRedeem: selector("previewRedeem(uint256)"),
  maxRedeem: selector("maxRedeem(address)"),
  asset4626: selector("asset()"),
  // Native liquid staking: the payable entrypoint that accepts the chain coin.
  submitNative: selector("submit(address)"),
  // Shared reads.
  balanceOf: selector("balanceOf(address)"),
  decimals: selector("decimals()"),
} as const;

export type StakingInterface = "erc4626" | "native_submit";

export class StakingError extends Error {
  readonly code:
    | "unsupported_interface"
    | "invalid_address"
    | "invalid_amount"
    | "rpc_failed"
    | "not_configured";
  constructor(code: StakingError["code"], message: string) {
    super(message);
    this.name = "StakingError";
    this.code = code;
  }
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function addressWord(address: string): string {
  if (!ADDRESS_RE.test(address)) {
    throw new StakingError("invalid_address", `Invalid address: ${address}`);
  }
  return address.replace(/^0x/, "").toLowerCase().padStart(64, "0");
}

function uintWord(value: bigint): string {
  if (value < 0n) throw new StakingError("invalid_amount", "Amount cannot be negative.");
  if (value >= 1n << 256n) throw new StakingError("invalid_amount", "Amount exceeds uint256.");
  return value.toString(16).padStart(64, "0");
}

function decodeUint(hex: string): bigint | null {
  const body = (hex || "").replace(/^0x/, "");
  if (body.length < 64) return null;
  try {
    return BigInt(`0x${body.slice(0, 64)}`);
  } catch {
    return null;
  }
}

/**
 * Calldata to stake.
 *
 * ERC-4626 `deposit(assets, receiver)` moves an ERC-20 and therefore needs a
 * prior allowance — the caller is responsible for that, exactly as the swap
 * path already is. `submit(referral)` is payable and moves the chain's own
 * coin, so it carries `value` instead and needs no approval.
 *
 * The zero address is passed as the referral because FurlPay takes no referral
 * fee on staking. Passing an address here would silently enrol the user's
 * deposit in a fee-sharing programme they were not told about.
 */
export function encodeStake(input: {
  interface: StakingInterface;
  /** Raw units of the asset being staked. */
  amount: bigint;
  /** Who receives the receipt token — the user's own address. */
  receiver: string;
}): { data: string; value: bigint } {
  const receiver = addressWord(input.receiver);
  if (input.amount <= 0n) throw new StakingError("invalid_amount", "Amount must be positive.");

  if (input.interface === "erc4626") {
    return {
      data: `${STAKING_SELECTORS.deposit4626}${uintWord(input.amount)}${receiver}`,
      // An ERC-4626 deposit moves a token, never the chain coin. A non-zero
      // value here would send ETH to a non-payable function and revert.
      value: 0n,
    };
  }

  if (input.interface === "native_submit") {
    const ZERO = "0".repeat(64);
    return {
      data: `${STAKING_SELECTORS.submitNative}${ZERO}`,
      // The stake IS the value on this interface.
      value: input.amount,
    };
  }

  throw new StakingError("unsupported_interface", `Unknown staking interface: ${String(input.interface)}`);
}

/**
 * Calldata to begin unstaking.
 *
 * ERC-4626 `redeem(shares, receiver, owner)` returns the underlying
 * immediately where the vault has liquidity. A native liquid-staking exit runs
 * through a protocol-specific withdrawal queue whose ABI is NOT standardised —
 * so it is refused here rather than guessed at, and the UI routes the user to
 * the protocol's own withdrawal flow.
 *
 * Guessing a queue ABI is precisely the failure this refusal prevents: a
 * plausible-looking call that reverts, or worse, hits a different function.
 */
export function encodeUnstake(input: {
  interface: StakingInterface;
  /** Receipt-token units to redeem. */
  shares: bigint;
  receiver: string;
  owner: string;
}): { data: string; value: bigint } {
  if (input.shares <= 0n) throw new StakingError("invalid_amount", "Amount must be positive.");

  if (input.interface === "erc4626") {
    return {
      data:
        `${STAKING_SELECTORS.redeem4626}${uintWord(input.shares)}` +
        `${addressWord(input.receiver)}${addressWord(input.owner)}`,
      value: 0n,
    };
  }

  throw new StakingError(
    "unsupported_interface",
    "This protocol's withdrawal queue is not a standard interface, so FurlPay cannot build the transaction. Use the protocol's own withdrawal page.",
  );
}

/**
 * Read a position from the chain.
 *
 * The receipt balance is always read. The UNDERLYING value is read only for
 * exchange-rate accounting, where the two genuinely differ — and it is read
 * from the contract's own `convertToAssets`, never computed here. The protocol
 * owns that rate; reproducing the arithmetic locally would drift the moment
 * the protocol changes how it is derived, and drift on this number is a
 * misreported balance.
 *
 * A failed underlying read yields `null`, not the raw balance. Substituting the
 * balance would silently report a 1:1 rate and under-report every reward.
 */
export async function readPosition(input: {
  chain: ChainSlug;
  protocol: StakingProtocol;
  owner: string;
  receiptDecimals: number;
  underlyingDecimals: number;
}): Promise<StakingPosition> {
  const { protocol } = input;
  if (!protocol.receiptToken) {
    throw new StakingError("not_configured", "This protocol has no verified receipt token.");
  }

  const balance = await readErc20Balance(input.chain, protocol.receiptToken, input.owner);
  if (balance === null) {
    throw new StakingError("rpc_failed", "Could not read your staked balance.");
  }

  let underlyingValue: bigint | null = null;
  if (protocol.accounting === "exchange_rate" && protocol.contract && balance > 0n) {
    underlyingValue = await convertToAssets(input.chain, protocol.contract, balance);
  } else if (protocol.accounting === "rebasing") {
    // A rebasing receipt is already denominated in the underlying: the balance
    // IS the value, and there is no rate to read.
    underlyingValue = balance;
  }

  return {
    protocolId: protocol.id,
    receiptBalance: balance,
    receiptDecimals: input.receiptDecimals,
    underlyingValue,
    underlyingDecimals: input.underlyingDecimals,
    readAt: Date.now(),
  };
}

/** ERC-4626 `convertToAssets(shares)`. Null when the call fails or is unreadable. */
export async function convertToAssets(
  chain: ChainSlug,
  vault: string,
  shares: bigint,
): Promise<bigint | null> {
  try {
    const raw = await call(chain, vault, `${STAKING_SELECTORS.convertToAssets}${uintWord(shares)}`);
    return decodeUint(raw);
  } catch {
    // Null, never a fallback figure. See readPosition.
    return null;
  }
}

/**
 * ERC-4626 `previewRedeem(shares)` — what an exit would actually return now.
 *
 * Distinct from convertToAssets: preview accounts for withdrawal fees and
 * current liquidity, so it is the number to show on an unstake screen.
 * convertToAssets is the idealised rate and belongs on the balance display.
 */
export async function previewRedeem(
  chain: ChainSlug,
  vault: string,
  shares: bigint,
): Promise<bigint | null> {
  try {
    const raw = await call(chain, vault, `${STAKING_SELECTORS.previewRedeem}${uintWord(shares)}`);
    return decodeUint(raw);
  } catch {
    return null;
  }
}

/** ERC-4626 `maxRedeem(owner)` — the cap the vault will honour right now. */
export async function maxRedeem(chain: ChainSlug, vault: string, owner: string): Promise<bigint | null> {
  try {
    const raw = await call(chain, vault, `${STAKING_SELECTORS.maxRedeem}${addressWord(owner)}`);
    return decodeUint(raw);
  } catch {
    return null;
  }
}

export function accountingOf(protocol: StakingProtocol): StakingAccounting {
  return protocol.accounting;
}
