import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@/lib/evm/rlp";
import type { Eip1559Transaction } from "@/lib/evm/transaction";

// ---------------------------------------------------------------------------
// What this transaction MEANS, derived from its own bytes.
//
// WHY THE CLIENT DESCRIBES ITS OWN TRANSACTION AT ALL. The server needs a
// semantic intent — action, asset, amount, recipient — to price policy, render
// a confirmation and bind every control to one digest. It cannot infer that
// from raw calldata for an arbitrary contract, and it must not accept a
// description on trust.
//
// So the split is: the client SAYS what it believes; the server INDEPENDENTLY
// decodes the same calldata and refuses if the two disagree
// (apps/web/src/lib/integrity/evmPayload.ts). A wrong description here does not
// produce a wrong signature — it produces a refusal. That is what makes it safe
// for this file to be a convenience rather than a trust anchor.
//
// SELECTORS ARE COMPUTED, NOT PASTED. `0xa9059cbb` carries no meaning a
// reviewer can check and a transposed digit is a call to a different function.
// `keccak256("transfer(address,uint256)")` is checkable by reading it — the
// same discipline as lib/evm/erc20.ts.
// ---------------------------------------------------------------------------

function selector(signature: string): string {
  return bytesToHex(keccak_256(new TextEncoder().encode(signature)).slice(0, 4));
}

const TRANSFER = selector("transfer(address,uint256)");
const APPROVE = selector("approve(address,uint256)");

/**
 * Token contracts this app will describe, per chain.
 *
 * Mirrors `USDC_BY_NETWORK` in lib/wallet.ts and the server's
 * lib/assets/stablecoins.ts. Kept as a pinned table rather than resolved at
 * runtime for the same reason wallet.ts pins it: the contract a transfer is
 * addressed to is the difference between sending USDC and sending a lookalike,
 * and a table someone must deliberately edit is the control.
 *
 * Fail closed: an unlisted chain or contract yields no description, and the
 * transaction cannot be prepared at all.
 */
const TOKENS: Record<number, { chain: string; tokens: Record<string, string> }> = {
  1: { chain: "ethereum", tokens: { "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "USDC.ethereum" } },
  137: { chain: "polygon", tokens: { "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": "USDC.polygon" } },
  8453: { chain: "base", tokens: { "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "USDC.base" } },
  42161: {
    chain: "arbitrum",
    tokens: { "0xaf88d065e77c8cc2239327c5edb3a432268e5831": "USDC.arbitrum" },
  },
};

export interface IntentDescription {
  readonly action: "transfer" | "approve";
  readonly chain: string;
  readonly assetId: string;
  readonly amountMinor: string;
  readonly destination: string;
  readonly spender?: string;
}

export class UndescribableTransaction extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UndescribableTransaction";
  }
}

/**
 * Describe a transaction, or refuse.
 *
 * REFUSES rather than guessing. A description the app cannot justify from the
 * bytes would be shown to the user as if it were fact, and the user's approval
 * would then attach to a sentence rather than to a transaction. An unknown
 * contract call is not "probably a transfer"; it is unknown, and it stops here.
 */
export function describeTransaction(tx: Eip1559Transaction): IntentDescription {
  const chainEntry = TOKENS[tx.chainId];
  if (!chainEntry) {
    throw new UndescribableTransaction(
      `Chain ${tx.chainId} is not one this app can describe for signing.`
    );
  }

  const to = tx.to.toLowerCase();
  const data = (tx.data || "0x").toLowerCase();

  if (data === "0x") {
    // A native transfer. There is no token contract, so there is nothing to
    // pin — but there is also no supported native settlement asset today, and
    // claiming one would put a fabricated asset id into the intent.
    throw new UndescribableTransaction(
      "Native-currency transfers are not supported by cloud signing yet."
    );
  }

  const assetId = chainEntry.tokens[to];
  if (!assetId) {
    throw new UndescribableTransaction(
      "This transaction is addressed to a contract this app does not recognise."
    );
  }

  const decoded = decodeTwoArgCall(data);
  if (!decoded) {
    throw new UndescribableTransaction(
      "This transaction's calldata is not a plain transfer or approval."
    );
  }

  if (decoded.selector === TRANSFER) {
    if (tx.value !== 0n) {
      // A token transfer that also sends native value is doing something the
      // description would not mention.
      throw new UndescribableTransaction(
        "This transaction sends native currency alongside a token transfer."
      );
    }
    return {
      action: "transfer",
      chain: chainEntry.chain,
      assetId,
      amountMinor: decoded.amount.toString(),
      destination: decoded.address,
    };
  }

  if (decoded.selector === APPROVE) {
    return {
      action: "approve",
      chain: chainEntry.chain,
      assetId,
      amountMinor: decoded.amount.toString(),
      // For an approval the value goes nowhere today; the SPENDER is what is
      // being granted, and the server binds that separately for exactly that
      // reason.
      destination: to,
      spender: decoded.address,
    };
  }

  throw new UndescribableTransaction("Unrecognised contract call.");
}

/**
 * Decode `f(address,uint256)`, strictly.
 *
 * Length is exact and address padding must be zero — the same two rules the
 * server applies. Solidity ignores trailing calldata and masks address padding,
 * so a lenient decoder here would describe one transaction while the EVM ran
 * another, and the user would approve the description.
 */
function decodeTwoArgCall(
  data: string
): { selector: string; address: string; amount: bigint } | null {
  if (data.length !== 2 + 8 + 64 + 64) return null;
  const word0 = data.slice(10, 74);
  const word1 = data.slice(74, 138);
  if (!/^0{24}[0-9a-f]{40}$/.test(word0)) return null;
  if (!/^[0-9a-f]{64}$/.test(word1)) return null;
  return {
    selector: data.slice(0, 10),
    address: "0x" + word0.slice(24),
    amount: BigInt("0x" + word1),
  };
}

/** Exposed for tests: pins the computed selectors against the published ones. */
export const SELECTORS = { transfer: TRANSFER, approve: APPROVE };
