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
/**
 * Arc's ERC-20 interface onto native USDC. Identical on mainnet and testnet.
 *
 * Declared BEFORE `TOKENS`, which uses it as a computed key. A `const` declared
 * after the table would be in its temporal dead zone at module initialisation —
 * the key would silently become `undefined` and every Arc token transfer would
 * be refused as an unrecognised contract. That is not hypothetical: it is what
 * happened, and the test for an Arc ERC-20 transfer is what caught it.
 */
const ARC_USDC_ERC20 = "0x3600000000000000000000000000000000000000";

const TOKENS: Record<number, { chain: string; tokens: Record<string, string> }> = {
  1: { chain: "ethereum", tokens: { "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "USDC.ethereum" } },
  137: { chain: "polygon", tokens: { "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": "USDC.polygon" } },
  8453: { chain: "base", tokens: { "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "USDC.base" } },
  42161: {
    chain: "arbitrum",
    tokens: { "0xaf88d065e77c8cc2239327c5edb3a432268e5831": "USDC.arbitrum" },
  },
  // Circle Arc. The token address is the ERC-20 INTERFACE onto the chain's
  // native USDC balance, not a separate contract, and it is the same on both
  // networks. See NATIVE_USDC_CHAINS below for why Arc needs more than a row here.
  5042: { chain: "arc", tokens: { [ARC_USDC_ERC20]: "USDC.arc" } },
  5042002: { chain: "arc-testnet", tokens: { [ARC_USDC_ERC20]: "USDC.arc" } },
};

/**
 * Chains where the NATIVE coin is itself a settlement asset.
 *
 * This is the one structural assumption Arc breaks. Everywhere else the native
 * coin is ETH or POL — something FurlPay does not settle in — so "empty
 * calldata" simply means "not a supported payment" and refusing it is correct.
 * On Arc, USDC *is* the native coin, so a plain send with no calldata is the
 * ordinary way to pay, and the old blanket refusal made the normal Arc payment
 * undescribable.
 *
 * Kept as an explicit set rather than inferred, so adding a chain is a decision
 * someone makes rather than a side effect of a table edit.
 */
const NATIVE_USDC_CHAINS: Record<number, { chain: string; assetId: string }> = {
  5042: { chain: "arc", assetId: "USDC.arc" },
  5042002: { chain: "arc-testnet", assetId: "USDC.arc" },
};

/**
 * 10^(18-6). Arc exposes ONE balance through two interfaces at different
 * precision: 18 decimals natively (gas, msg.value) and 6 through ERC-20.
 *
 * `USDC.arc` is registered ONCE at the canonical 18 decimals, so an intent's
 * amount is ALWAYS 18dp — which means the ERC-20 path has to scale UP by this
 * factor and the native path must not scale at all. The server applies the same
 * rule in apps/web/src/lib/integrity/evmPayload.ts and refuses on disagreement,
 * so getting this wrong produces a refusal rather than a wrong signature.
 *
 * Duplicated from apps/web/src/lib/chains/arc.ts because this app shares no code
 * with the server. It is a power of ten, not a judgement, and the server check is
 * what actually enforces it.
 */
const ARC_DECIMAL_SCALE = 10n ** 12n;

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
    // A native transfer. On most chains the native coin is ETH or POL, which
    // FurlPay does not settle in, so there is no asset id to name and claiming
    // one would put a fabricated asset into the intent.
    //
    // ON ARC THERE IS. USDC is the native coin, so a plain send with no calldata
    // is a USDC payment — and the ordinary way to pay on a chain where the gas
    // asset and the payment asset are the same thing. `value` is already in the
    // canonical 18 decimals `USDC.arc` is registered at, so it is used unscaled.
    const native = NATIVE_USDC_CHAINS[tx.chainId];
    if (native) {
      if (tx.value === 0n) {
        // A zero-value native send moves nothing and is not a payment to
        // describe. Arc permits it (a zero-value send even to 0x0 succeeds), so
        // it has to be refused here rather than relying on the chain.
        throw new UndescribableTransaction("This transaction does not transfer any value.");
      }
      return {
        action: "transfer",
        chain: native.chain,
        assetId: native.assetId,
        amountMinor: tx.value.toString(),
        destination: to,
      };
    }
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
      // description would not mention. On Arc it is worse than untidy: native
      // value IS USDC there, so such a transaction moves USDC twice.
      throw new UndescribableTransaction(
        "This transaction sends native currency alongside a token transfer."
      );
    }
    return {
      action: "transfer",
      chain: chainEntry.chain,
      assetId,
      // SCALED ON ARC ONLY. Calldata to Arc's ERC-20 interface carries a 6dp
      // amount, while `USDC.arc` is registered at the canonical 18dp — so the
      // intent must state the 18dp figure or the server's independent check
      // compares 1e8 against 1e20 and refuses a perfectly good payment. Every
      // other chain's USDC is 6dp on both sides and needs no conversion.
      amountMinor: toIntentAmount(tx.chainId, decoded.amount).toString(),
      destination: decoded.address,
    };
  }

  if (decoded.selector === APPROVE) {
    return {
      action: "approve",
      chain: chainEntry.chain,
      assetId,
      // Scaled on Arc for the same reason as a transfer: this is the amount
      // being GRANTED, and an unscaled 6dp figure would describe an allowance a
      // trillion times smaller than the one actually authorised.
      amountMinor: toIntentAmount(tx.chainId, decoded.amount).toString(),
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
 * The amount an INTENT should carry for a token-interface transfer.
 *
 * Identity on every chain except Arc, where the ERC-20 interface is 6 decimals
 * over a balance whose canonical precision is 18. Separated out so the scaling
 * is one named decision rather than a bare `* 10n ** 12n` inline at a call site.
 */
function toIntentAmount(chainId: number, erc20Amount: bigint): bigint {
  return NATIVE_USDC_CHAINS[chainId] ? erc20Amount * ARC_DECIMAL_SCALE : erc20Amount;
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
