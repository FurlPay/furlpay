import { decodeErc20Call, type EvmChainPayload } from "./evmPayload";
import type { CanonicalIntent } from "./canonical";
import type { SimulationResult } from "./boundary";

// ---------------------------------------------------------------------------
// Transaction simulation.
//
// WHAT THIS FILE HONESTLY IS. There is no simulation provider configured on
// this deployment. Blockaid, Tenderly and Alchemy all require credentials and
// a paid account, and none of them are wired up. Writing a module that returns
// `outcome: "clean"` on the strength of a local decoder would be the exact
// failure the boundary exists to prevent — a control that reports success
// without doing the work, which is worse than no control because it silences
// the warning that would otherwise be shown.
//
// So this module NEVER RETURNS "clean". Its two possible verdicts are:
//
//   "warning"      local analysis found something the user should see
//   "unavailable"  nothing was checked, and the user is told so
//
// `clean` is reserved for a real provider that has actually examined the
// transaction against current chain state and known-bad address lists. When
// one is configured, it plugs in as a `SimulationProvider` and this local pass
// becomes what runs alongside it, not instead of it.
//
// WHY THE LOCAL PASS IS STILL WORTH HAVING. It is not risk intelligence — it
// cannot know that an address drained a pool yesterday. It reads the calldata
// we already decode for the payload check and surfaces the structural facts a
// confirmation screen should never omit: an unlimited approval, a transfer to
// the token contract itself, a transfer to the zero address. Those are
// determinable from the bytes alone, with no provider and no network call, and
// they are among the most common ways money is lost.
//
// The boundary treats `unavailable` as a warning rather than a refusal on
// purpose (see boundary.ts): a provider outage is not evidence of danger, and
// blocking all payments when a third party is down hands that third party an
// off switch for the product.
// ---------------------------------------------------------------------------

export interface SimulationProvider {
  readonly name: string;
  simulate(input: {
    intent: CanonicalIntent;
    payload: EvmChainPayload;
    digest: string;
  }): Promise<SimulationResult>;
}

const registered: SimulationProvider[] = [];

/** Register a real provider. Called from deployment wiring, not from a route. */
export function registerSimulationProvider(provider: SimulationProvider): void {
  registered.push(provider);
}

export function simulationConfigured(): boolean {
  return registered.length > 0;
}

/** The maximum an ERC-20 allowance can be — what wallets call "unlimited". */
const UINT256_MAX = (1n << 256n) - 1n;
/**
 * Above this, an allowance is unlimited in every way that matters.
 *
 * Some routers request `2^255` or `uint96 max` rather than `uint256 max`
 * specifically so a naive `=== MAX` check reads it as a bounded approval. Any
 * allowance beyond half the type's range outlives every token supply that will
 * ever exist, so it is treated as unlimited regardless of the exact constant.
 */
const EFFECTIVELY_UNLIMITED = UINT256_MAX / 2n;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
/** ERC-20's own conventional burn address, and a frequent typo destination. */
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dead";

/**
 * Structural analysis of the calldata. No network, no provider, no verdict of
 * safety.
 *
 * Returns the findings only. The caller decides what to do with them, and
 * `simulate()` below is what turns them into a bound `SimulationResult`.
 */
export function localFindings(
  intent: CanonicalIntent,
  payload: EvmChainPayload
): { warnings: string[]; unlimitedApproval: { spender: string; amountMinor: string } | null } {
  const warnings: string[] = [];
  const decoded = decodeErc20Call(payload.data);
  let unlimitedApproval: { spender: string; amountMinor: string } | null = null;

  if (decoded?.kind === "approve") {
    const amount = BigInt(decoded.amountMinor);
    if (amount >= EFFECTIVELY_UNLIMITED) {
      unlimitedApproval = { spender: decoded.counterparty, amountMinor: decoded.amountMinor };
      warnings.push(
        `Unlimited spending approval for ${decoded.counterparty}. That contract can move this ` +
          "token from your wallet at any time in future, not just now."
      );
    }
    if (decoded.counterparty === payload.to) {
      warnings.push("This approves the token contract to spend its own token from your wallet.");
    }
  }

  const recipient = decoded?.kind === "transfer" ? decoded.counterparty : null;
  const destination = recipient ?? (payload.data === "0x" ? payload.to : null);

  if (destination === ZERO_ADDRESS || destination === DEAD_ADDRESS) {
    // Not reversible, and not something a payments app ever means to do.
    warnings.push("This sends to a burn address. The funds cannot be recovered.");
  }
  if (destination && destination === payload.to && decoded?.kind === "transfer") {
    // Sending a token to its own contract is the single most common way tokens
    // are permanently lost; most contracts have no way to return them.
    warnings.push(
      "This sends the token to its own contract address, where it will most likely be lost."
    );
  }
  if (destination && destination === intent.accountId.toLowerCase()) {
    warnings.push("The recipient is this account. This transaction sends funds to itself.");
  }

  return { warnings, unlimitedApproval };
}

/**
 * Produce a bound simulation result.
 *
 * `boundDigest` is set to the digest of the intent being examined — that is
 * what makes this evidence about THIS transaction rather than evidence about
 * something. A simulation that cannot say which transaction it examined is not
 * admissible at the boundary, and boundary.ts refuses it (`simulation_unbound`).
 */
export async function simulate(input: {
  intent: CanonicalIntent;
  payload: EvmChainPayload;
  digest: string;
  now?: number;
}): Promise<SimulationResult> {
  const now = input.now ?? Date.now();
  const local = localFindings(input.intent, input.payload);

  const assetChanges = assetChangesFor(input.intent);
  const approval = local.unlimitedApproval
    ? {
        spender: local.unlimitedApproval.spender,
        amountMinor: local.unlimitedApproval.amountMinor,
        unlimited: true,
      }
    : undefined;

  if (registered.length > 0) {
    const provider = registered[0];
    try {
      const result = await provider.simulate({
        intent: input.intent,
        payload: input.payload,
        digest: input.digest,
      });
      // The provider's own binding is re-checked rather than trusted. A result
      // bound to a different digest is a result about a different transaction,
      // however it got here.
      if (result.boundDigest !== input.digest) {
        return unavailable(input.digest, now, [
          ...local.warnings,
          "The simulation provider returned a result for a different transaction.",
        ], assetChanges, approval);
      }
      return {
        ...result,
        // Local findings are ADDED to the provider's, never replaced by them.
        // A provider that misses an unlimited approval should not cause us to
        // stop mentioning it.
        warnings: [...result.warnings, ...local.warnings],
      };
    } catch {
      // A provider that threw checked nothing. Say so.
      return unavailable(input.digest, now, local.warnings, assetChanges, approval);
    }
  }

  if (local.warnings.length > 0) {
    return {
      outcome: "warning",
      boundDigest: input.digest,
      provider: "furlpay-local-static",
      simulatedAt: new Date(now).toISOString(),
      warnings: [
        ...local.warnings,
        // Said explicitly so a warning is never mistaken for a full check.
        "No external simulation provider is configured, so this transaction has not been " +
          "checked against known-malicious addresses.",
      ],
      assetChanges,
      approval,
    };
  }

  return unavailable(input.digest, now, [], assetChanges, approval);
}

function unavailable(
  digest: string,
  now: number,
  warnings: readonly string[],
  assetChanges: SimulationResult["assetChanges"],
  approval: SimulationResult["approval"]
): SimulationResult {
  return {
    outcome: "unavailable",
    boundDigest: digest,
    provider: "none",
    simulatedAt: new Date(now).toISOString(),
    warnings: [...warnings],
    assetChanges,
    approval,
  };
}

/**
 * The asset movement the intent describes, for the confirmation screen.
 *
 * Taken from the INTENT, which `verifyPayloadMatchesIntent` has already proved
 * agrees with the calldata. Deriving it from the intent rather than re-decoding
 * means the number on the screen is the same number the policy priced and the
 * digest bound — three readings of one value, not three values.
 */
function assetChangesFor(intent: CanonicalIntent): SimulationResult["assetChanges"] {
  if (intent.action === "approve") {
    // An approval moves nothing today. Reporting a delta would overstate what
    // is happening and understate what is being granted.
    return [];
  }
  return [{ assetId: intent.assetId, deltaMinor: intent.amountMinor, direction: "out" }];
}
