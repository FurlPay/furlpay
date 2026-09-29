import { NETWORK_USDC, NETWORK_XSGD } from "@/lib/x402";
import { log } from "@/lib/log";

// ---------------------------------------------------------------------------
// The settlement-asset allowlist, and the sponsored-gas ceiling.
//
// WHY THIS IS ITS OWN MODULE. Both the facilitator (which decides whether to
// settle) and the settler (which actually broadcasts) must agree on exactly
// which contract may be called. The facilitator already imports `defaultSettler`
// from the settler, so putting the allowlist in either of them would make the
// other import it back and create a runtime cycle. It lives here so both can
// depend on it and neither depends on the other for this.
//
// WHAT IT PREVENTS. `paymentRequirements.asset` arrives in the request body, and
// the settler passes it to writeContract() as the contract address while OUR
// fee-payer pays the gas. Nothing checked it. That is arXiv:2607.19545's SR8
// ("a facilitator must settle only proofs whose on-chain execution semantics are
// explicitly allowed and unambiguous") unmet, and SR8 unmet is what makes its
// SR6 (Gas Abuse) unbounded:
//
//   1. Attacker deploys contract M with a `transferWithAuthorization(...)` entry
//      point that burns gas.
//   2. They POST `asset = M`. verifyAuthorizationSignature builds its EIP-712
//      domain from `verifyingContract: asset` — and `extra.name` / `extra.version`
//      were also taken from the request, so the whole domain was theirs. They
//      sign a valid authorization over it with their own key, `from` their own
//      address.
//   3. Every structural check in verify() compares request fields against other
//      request fields (`auth.to` vs `payTo`, `auth.value` vs `maxAmountRequired`),
//      so all of them pass, and the signature genuinely verifies.
//   4. settle() calls M with our fee-payer as msg.sender.
//
// The route is unauthenticated by protocol design and allows 30 requests per
// minute per IP, so this was an unbounded drain on the gas float plus an
// arbitrary-contract call from an address we control.
//
// THE FIX USES THE REGISTRY THE CODEBASE ALREADY HAD. lib/x402.ts names the
// canonical, on-chain-verified token per network. Pinning to it is not a new
// policy — it is the promise `/supported` already implies, finally enforced.
// ---------------------------------------------------------------------------

interface SettlementAsset {
  readonly address: string;
  /**
   * EIP-712 domain, as the DEPLOYED CONTRACT reports it.
   *
   * A property of the contract, never of the request. USDC (FiatTokenV2_2)
   * answers `name() == "USD Coin"` and `version() == "2"`; a request claiming
   * otherwise is wrong or hostile. Accepting these from `extra` let an attacker
   * choose the domain their own signature would be checked against — and even
   * with the address pinned, a wrong name would pass verify() and then revert
   * on-chain, so we would pay gas for a guaranteed failure.
   */
  readonly domainName: string;
  readonly domainVersion: string;
  readonly symbol: "USDC" | "XSGD";
}

/**
 * Closed set, keyed by the network ids the facilitator advertises.
 *
 * Only networks in `SUPPORTED_KINDS` appear. Adding a network here without
 * adding a verifier and settler for it would re-create the gap this closes, so
 * the two lists are meant to move together.
 *
 * BUILT LAZILY, AND THAT IS NOT STYLE — IT IS A REAL IMPORT CYCLE. The module
 * graph is `x402.ts -> x402Settler.ts -> x402Assets.ts -> x402.ts`: the settler
 * needs this allowlist, and x402.ts already imports the settler. Evaluating the
 * table at module scope read `NETWORK_USDC` before x402.ts had finished
 * initialising, so the addresses came out `undefined` and five suites failed to
 * load. Reading the registry on FIRST USE defers it past initialisation.
 *
 * Duplicating the addresses here would also have "fixed" it, and would be worse:
 * two copies of a security-critical allowlist drift, and the drift is silent.
 */
let cachedAssets: Readonly<Record<string, readonly SettlementAsset[]>> | null = null;

function settlementAssets(): Readonly<Record<string, readonly SettlementAsset[]>> {
  if (cachedAssets) return cachedAssets;
  cachedAssets = {
    arbitrum: [
      { address: NETWORK_USDC.arbitrum, domainName: "USD Coin", domainVersion: "2", symbol: "USDC" },
      ...(NETWORK_XSGD.arbitrum
        ? ([
            { address: NETWORK_XSGD.arbitrum, domainName: "XSGD", domainVersion: "1", symbol: "XSGD" },
          ] as const)
        : []),
    ],
    "arbitrum-sepolia": [
      {
        address: NETWORK_USDC["arbitrum-sepolia"],
        // Circle's testnet deployment reports "USDC", not "USD Coin".
        domainName: "USDC",
        domainVersion: "2",
        symbol: "USDC",
      },
    ],
    base: [{ address: NETWORK_USDC.base, domainName: "USD Coin", domainVersion: "2", symbol: "USDC" }],
  };
  return cachedAssets;
}

export type AssetResolution =
  | { readonly ok: true; readonly address: string; readonly domainName: string; readonly domainVersion: string; readonly symbol: string }
  | { readonly ok: false; readonly reason: "asset_malformed" | "asset_not_allowed" };

const HEX40 = /^0x[0-9a-fA-F]{40}$/;

/**
 * Pin a requested asset to a known contract for this network.
 *
 * Comparison is lowercased, because two spellings of one address differ only in
 * case and refusing the other spelling would reject a legitimate payment.
 *
 * `X402_USDC_ADDRESS` is deliberately NOT consulted. That override exists so a
 * local devnet can point the PAYER at a mock token; letting it widen the
 * facilitator's settlement allowlist would reopen this hole one environment
 * variable at a time. A devnet that needs a different token adds a network entry.
 */
export function resolveSettlementAsset(network: string, requested: unknown): AssetResolution {
  if (typeof requested !== "string" || !HEX40.test(requested.trim())) {
    return { ok: false, reason: "asset_malformed" };
  }
  const wanted = requested.trim().toLowerCase();
  const allowed = settlementAssets()[network] ?? [];
  const hit = allowed.find((a) => a.address.toLowerCase() === wanted);
  if (!hit) return { ok: false, reason: "asset_not_allowed" };
  return {
    ok: true,
    address: hit.address,
    domainName: hit.domainName,
    domainVersion: hit.domainVersion,
    symbol: hit.symbol,
  };
}

/** Assets `/supported` may advertise, so the promise matches the enforcement. */
export function settlementAssetsFor(network: string): readonly SettlementAsset[] {
  return settlementAssets()[network] ?? [];
}

/** Every network with at least one settleable asset. */
export function settlementNetworks(): readonly string[] {
  return Object.keys(settlementAssets());
}

// ── Canonical atomic amounts ───────────────────────────────────────────────

/**
 * Unsigned decimal digits, and nothing else.
 *
 * WHY `BigInt()` ALONE IS NOT A VALIDATOR. It is a lenient coercion, and the
 * leniency was measured rather than assumed:
 *
 *     BigInt("0x10")  -> 16n      hexadecimal
 *     BigInt("0o17")  -> 15n      octal
 *     BigInt("0b101") -> 5n       binary
 *     BigInt("+5")    -> 5n       leading sign
 *     BigInt(" 1 ")   -> 1n       surrounding whitespace, tabs and newlines too
 *     BigInt("")      -> 0n       empty string is ZERO, not an error
 *
 * So `BigInt(auth.value)` accepted `"0x10"` as sixteen atomic units, and a live
 * request confirmed verify() answering isValid for it.
 *
 * THE RISK IS CANONICALIZATION MISMATCH, NOT ARITHMETIC. EIP-712 hashes the
 * NUMERIC value, so `"0x10"` and `"16"` produce the same digest and no signature
 * is bypassed — that part is worth stating plainly rather than overclaiming.
 * What breaks is agreement between components that see the same field:
 * `recordSettlement()` stores `amountAtomic` VERBATIM, so the settlement record
 * and the evidence trail would read `"0x10"` while the chain moved 16; and a
 * resource server comparing `amount` textually against its own
 * `maxAmountRequired` disagrees with a facilitator that compared numerically.
 * Two parsers, one field, different answers is the shape most authorization
 * bypasses have.
 *
 * The x402 wire format specifies decimal atomic-unit strings, so this accepts
 * exactly that. Leading zeros are permitted: `"007"` is numerically unambiguous
 * and some clients zero-pad, and refusing it would cost a real payment for no
 * security gain. The regex also rejects `-`, which is why a negative amount
 * reports `invalid_amount` rather than reaching a sign comparison.
 *
 * Mirrors `@furlpay/control-plane`'s `parseAtomic`, deliberately: one repository
 * should have one rule for what an atomic amount looks like.
 */
const CANONICAL_ATOMIC = /^[0-9]+$/;

/**
 * Parse a wire amount, or null when it is not a canonical decimal integer.
 *
 * Returns null rather than throwing so the caller answers with a verdict instead
 * of a 500 — a malformed amount is a client error, not a server fault.
 */
export function parseAtomicAmount(value: unknown): bigint | null {
  if (typeof value !== "string" || !CANONICAL_ATOMIC.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

// ── SR6: bounded sponsored execution ───────────────────────────────────────

const DEFAULT_GAS_LIMIT = 200_000n;
/** Below this no transaction can execute; a "bound" under it is a broken config. */
export const MIN_GAS_LIMIT = 21_000n;
/** Above this the value stops bounding an operation that costs under ~100k. */
export const MAX_GAS_LIMIT = 1_000_000n;

/**
 * The gas ceiling for one sponsored settlement.
 *
 * SR6 requires that "sponsored execution must be constrained by configurable
 * upper bounds on fees, gas or compute units". We pay this gas and the caller is
 * unauthenticated, so an absent ceiling is an unbounded bill.
 *
 * The default is derived from the operation rather than guessed:
 * `transferWithAuthorization` on FiatTokenV2_2 is an ecrecover, two balance
 * writes and a nonce write, comfortably under 100k gas, so 200k leaves room for
 * a proxy hop while still refusing anything that is not this operation.
 *
 * Out-of-range configuration falls back to the default rather than being honoured
 * or throwing: a typo in an env var must not remove the bound, and must not take
 * settlement down either.
 */
export function settlementGasLimit(): bigint {
  const raw = (process.env.X402_SETTLEMENT_GAS_LIMIT ?? "").trim();
  if (!raw) return DEFAULT_GAS_LIMIT;
  let parsed: bigint;
  try {
    parsed = BigInt(raw);
  } catch {
    log.warn("X402_SETTLEMENT_GAS_LIMIT is not an integer; using the default", { raw });
    return DEFAULT_GAS_LIMIT;
  }
  if (parsed < MIN_GAS_LIMIT || parsed > MAX_GAS_LIMIT) {
    log.warn("X402_SETTLEMENT_GAS_LIMIT is outside the permitted range; using the default", {
      raw,
      min: String(MIN_GAS_LIMIT),
      max: String(MAX_GAS_LIMIT),
    });
    return DEFAULT_GAS_LIMIT;
  }
  return parsed;
}
