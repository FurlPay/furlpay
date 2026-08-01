import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, toBigInt } from "./rlp";
import { call, type ChainSlug } from "./rpc";

// ---------------------------------------------------------------------------
// The two ERC-20 calls a non-custodial swap needs: read the allowance, and
// raise it.
//
// Selectors are COMPUTED from their signatures, not pasted as magic hex. The
// four bytes of `0xdd62ed3e` carry no meaning a reviewer can check, and a
// transposed digit is a call to a different function — or to nothing, which on
// a token with a fallback is worse. `keccak256("allowance(address,address)")`
// is checkable by reading it.
// ---------------------------------------------------------------------------

function selector(signature: string): string {
  return bytesToHex(keccak_256(new TextEncoder().encode(signature)).slice(0, 4));
}

const ALLOWANCE = selector("allowance(address,address)");
const APPROVE = selector("approve(address,uint256)");

/** Left-pads a 20-byte address into a 32-byte ABI word. */
function addressWord(address: string): string {
  const clean = address.replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(clean)) throw new Error(`Invalid address: ${address}`);
  return clean.padStart(64, "0");
}

/** A uint256 as a 32-byte ABI word. */
function uintWord(value: bigint): string {
  if (value < 0n) throw new Error("uint256 cannot be negative.");
  const hex = value.toString(16);
  if (hex.length > 64) throw new Error("Value exceeds uint256.");
  return hex.padStart(64, "0");
}

/**
 * How much `spender` may currently move on `owner`'s behalf.
 *
 * A read, so no signature and no gas — which is why it is worth doing before
 * asking the user for anything: a wallet that has swapped this token before is
 * usually already approved, and prompting again for nothing trains people to
 * approve reflexively.
 */
export async function allowance(
  chain: ChainSlug,
  token: string,
  owner: string,
  spender: string
): Promise<bigint> {
  const data = ALLOWANCE + addressWord(owner) + addressWord(spender);
  const result = await call(chain, token, data);
  // A token that returns nothing for allowance() is not one we can reason
  // about; treat it as zero and let the approval path run.
  return result && result !== "0x" ? toBigInt(result) : 0n;
}

/**
 * Calldata for `approve(spender, amount)`.
 *
 * Approves the EXACT amount, never `type(uint256).max`. Infinite approval is
 * the industry default and it is a standing grant: it survives the swap, and if
 * the spender is ever compromised it drains the token. The cost of exactness is
 * one approval per swap — the user is already confirming a transaction, and the
 * gas is a few cents on the L2s this runs on.
 */
export function encodeApprove(spender: string, amount: bigint): string {
  return APPROVE + addressWord(spender) + uintWord(amount);
}

/** Exposed for tests: pins the computed selectors against the published ones. */
export const SELECTORS = { allowance: ALLOWANCE, approve: APPROVE };
