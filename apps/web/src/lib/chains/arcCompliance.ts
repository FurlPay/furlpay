import { getAddress, type Address } from "viem";

import { ARC_USDC_ERC20 } from "./arc";

// ---------------------------------------------------------------------------
// Sanctions screening on Arc — against the list that actually enforces.
//
// THE PROBLEM THIS SOLVES, and why the obvious framing of it was wrong.
//
// On other chains FurlPay screens a counterparty by calling a Chainalysis
// sanctions-oracle contract. MEASURED 2026-09-25: that oracle is NOT DEPLOYED ON
// ARC. The instinct is to treat this as a compliance gap and reach for an
// off-chain screening API to fill it.
//
// That instinct is wrong, and the measurement below is why. Arc's USDC is a full
// Circle FiatTokenV2, and it exposes its OWN blocklist as a free view:
//
//   eth_call 0x3600…0000  isBlacklisted(address) -> bool
//
// VERIFIED ON BOTH ARC NETWORKS, 2026-09-25:
//
//   testnet (chainId 0x4cef52 == 5042002)
//     isBlacklisted(0x70997970C51812dc3A010C7d01b50e0d17dc79C8) -> TRUE
//     isBlacklisted(0x8b1332e6414c830e823110667a6f0c10463d0f98) -> false
//   mainnet (chainId 0x13b2 == 5042)
//     isBlacklisted(0x70997970C51812dc3A010C7d01b50e0d17dc79C8) -> false
//
// That first address is the one Arc publishes on testnet expressly "for testing
// restricted value transfer behavior", and it reads TRUE on testnet and false on
// mainnet — exactly as documented. So the view is real, it is authoritative, and
// it is testable without involving a real sanctioned party.
//
// WHY THIS IS BETTER THAN THE ORACLE IT REPLACES. A third-party screening list
// and the list that reverts your transfer are two different lists, and the gap
// between them is where a payment fails after you told the user it would
// succeed. Here they are THE SAME LIST — the contract we query is the contract
// that enforces. There is no divergence to reconcile, no subscription to keep
// current, and no vendor between us and the decision.
//
// WHAT THIS IS NOT. It is not AML, not KYC, not transaction monitoring, and not
// a substitute for any of them. It answers exactly one question: would Circle's
// USDC contract on Arc refuse to move value to or from this address right now.
// That is a narrow question, and this module makes no broader claim.
//
// FAIL-CLOSED IS THE WHOLE DESIGN. An unreachable RPC does not mean "not
// blocked" — it means we do not know, and a screening check that reports "clear"
// when it could not reach the list is worse than no check at all, because it
// launders an unknown into an assurance. So the result type has three states and
// there is no boolean anywhere that collapses them.
// ---------------------------------------------------------------------------

/** `isBlacklisted(address)` — Circle FiatTokenV2. Verified present on Arc. */
export const ARC_IS_BLACKLISTED_SELECTOR = "0xfe575a87";

/**
 * Arc's published testnet address that reads as blocklisted.
 *
 * Exists so the blocklist path can be exercised end-to-end on testnet without
 * involving a real sanctioned party — which is otherwise impossible to test and
 * therefore usually untested.
 */
export const ARC_TESTNET_BLOCKED_TEST_ADDRESS: Address = getAddress(
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
);

/**
 * The outcome of a screening call. Three states, deliberately — see the
 * fail-closed note above.
 *
 * `unknown` is not a soft `clear`. A caller that treats it as one has
 * reintroduced the bug this type exists to prevent.
 */
export type ArcScreeningStatus = "clear" | "blocked" | "unknown";

export interface ArcScreeningResult {
  address: Address;
  status: ArcScreeningStatus;
  /** Set when `status` is `unknown`. Why the answer is missing. */
  reason?: string;
  /** When the answer was obtained. A blocklist answer is only true as of now. */
  checkedAt: string;
  /** The contract consulted — the same one that enforces. */
  source: Address;
}

/** Minimal RPC shape, injected so this is testable without a network. */
export type ArcEthCall = (request: { to: Address; data: string }) => Promise<string>;

export class ArcScreeningError extends Error {
  constructor(
    message: string,
    readonly result: ArcScreeningResult
  ) {
    super(message);
    this.name = "ArcScreeningError";
  }
}

function encodeIsBlacklisted(address: Address): string {
  // address left-padded to 32 bytes. No ABI encoder needed for one static arg,
  // and hand-encoding keeps this callable from any transport.
  return `${ARC_IS_BLACKLISTED_SELECTOR}${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
}

/**
 * Ask Arc's USDC contract whether it would refuse to move value to or from this
 * address.
 *
 * Never throws for a network problem — returns `unknown` with a reason, so the
 * caller decides what an unanswerable check means for its own operation. It
 * throws only on an address that is not an address, which is a programming error
 * rather than a screening outcome.
 */
export async function screenArcAddress(
  address: string,
  ethCall: ArcEthCall
): Promise<ArcScreeningResult> {
  const normalised = getAddress(address.trim()); // throws on a non-address
  const base = {
    address: normalised,
    checkedAt: new Date().toISOString(),
    source: ARC_USDC_ERC20,
  } as const;

  let raw: string;
  try {
    raw = await ethCall({ to: ARC_USDC_ERC20, data: encodeIsBlacklisted(normalised) });
  } catch (e) {
    return {
      ...base,
      status: "unknown",
      reason: `eth_call failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // An empty return means the function is not there — on a chain where we have
  // measured that it IS there, that means we are not talking to Arc's USDC.
  // Reporting `clear` from a contract that answered nothing would be inventing
  // an answer.
  if (!raw || raw === "0x") {
    return {
      ...base,
      status: "unknown",
      reason:
        `isBlacklisted(address) returned no data. Arc's USDC implements it ` +
        `(verified on mainnet and testnet), so an empty return means this RPC is ` +
        `not Arc, or ${ARC_USDC_ERC20} is not the USDC contract on it.`,
    };
  }

  let value: bigint;
  try {
    value = BigInt(raw);
  } catch {
    return { ...base, status: "unknown", reason: `unparseable eth_call result: ${raw}` };
  }

  // A bool is 0 or 1. Anything else is not a bool, and guessing which way to
  // round it is exactly the kind of decision that should not be made silently.
  if (value !== 0n && value !== 1n) {
    return {
      ...base,
      status: "unknown",
      reason: `isBlacklisted returned ${value}, which is not a boolean`,
    };
  }

  return { ...base, status: value === 1n ? "blocked" : "clear" };
}

/**
 * Screen every party to a transfer and refuse unless ALL of them are clear.
 *
 * BOTH SIDES MATTER. Arc reverts a transfer to OR from a blocklisted address, so
 * screening only the recipient leaves the sender's status to be discovered as a
 * failed receipt after gas has been spent.
 *
 * Throws on `blocked` AND on `unknown`. That is the fail-closed contract: the
 * only way past this function is a positive answer from the enforcing contract.
 */
export async function assertArcPartiesClear(
  parties: readonly { role: string; address: string }[],
  ethCall: ArcEthCall
): Promise<ArcScreeningResult[]> {
  const results: ArcScreeningResult[] = [];

  for (const { role, address } of parties) {
    const result = await screenArcAddress(address, ethCall);
    results.push(result);

    if (result.status === "blocked") {
      throw new ArcScreeningError(
        `${role} ${result.address} is blocklisted by Circle's USDC contract on ` +
          `Arc. A transfer to or from this address REVERTS on-chain — it would be ` +
          `mined, consume gas, and move nothing. This is a standing issuer ` +
          `decision, not a transient error: do not retry.`,
        result
      );
    }

    if (result.status === "unknown") {
      throw new ArcScreeningError(
        `Could not determine whether ${role} ${result.address} is blocklisted ` +
          `(${result.reason}). Refusing rather than assuming clear: an ` +
          `unanswered screening check is not a passed one.`,
        result
      );
    }
  }

  return results;
}

/**
 * Build an `ArcEthCall` over plain JSON-RPC.
 *
 * Deliberately dependency-free — no SDK, no key. The screening call is a public
 * view, which is part of why this approach is worth preferring over a vendor.
 */
export function arcEthCallViaRpc(rpcUrl: string, fetchImpl: typeof fetch = fetch): ArcEthCall {
  return async ({ to, data }) => {
    const response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
    });
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
    const body = (await response.json()) as { result?: string; error?: { message?: string } };
    if (body.error) throw new Error(body.error.message ?? "RPC error");
    return body.result ?? "0x";
  };
}
