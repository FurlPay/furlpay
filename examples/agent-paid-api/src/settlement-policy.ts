import {
  CHAIN_FINALITY,
  planSettlement,
  type SettlementChain,
  type ConsensusObservation,
} from "@furlpay/settlement";
import type { SettlementPolicy, SettlementVerdict } from "@furlpay/gateway";

// ---------------------------------------------------------------------------
// The adapter that puts @furlpay/settlement on the running path.
//
// Until this existed, `packages/settlement` — risk tiers, per-chain finality
// models, Alpenglow consensus detection, 52 tests — was imported by nothing.
// The gateway made its own release decision with `requiredConfirmations`:
// three hardcoded USD bands and a confirmation count, with no idea which chain
// it was on. Twelve confirmations is roughly five seconds on Solana and about
// twenty-four on Base, and on an optimistic rollup it is not finality at any
// count. A chain-blind number cannot express that; this can.
//
// The adapter lives HERE rather than in the gateway because the gateway ships
// to npm with a zero-runtime-dependency contract. `SettlementPolicy` is an
// injected interface for exactly that reason — the same pattern as
// SpendPolicyHook and FacilitatorClient.
// ---------------------------------------------------------------------------

/** Networks the gateway can name, mapped to the chains settlement models. */
const CHAIN_FOR_NETWORK: Readonly<Record<string, SettlementChain>> = {
  "solana:mainnet-beta": "solana",
  "solana:devnet": "solana",
  "base:mainnet": "base",
  "base:sepolia": "base",
  "arbitrum:mainnet": "arbitrum",
  "arbitrum:sepolia": "arbitrum",
  "polygon:mainnet": "polygon",
};

/**
 * Confirmations to demand for a plan.
 *
 * Derived from the expected wait rather than invented: a chain that finalises
 * in 400ms slots needs a different count from one with 2s blocks to represent
 * the same real-world assurance. `null` (unsatisfiable by waiting) is handled
 * by the caller before this is reached.
 */
function confirmationsFor(expectedWaitMs: number | null, chain: SettlementChain): number {
  if (expectedWaitMs === null) return 0;
  // CHAIN_FINALITY.confirmMs IS the block/slot interval, already per chain and
  // already sourced. A second table here would be a second source of truth for
  // the same fact, which is the duplication this whole adapter exists to end.
  const blockMs = CHAIN_FINALITY[chain].confirmMs;
  return Math.max(1, Math.ceil(expectedWaitMs / blockMs));
}

export interface SettlementPolicyOptions {
  /**
   * What is currently known about Solana's consensus.
   *
   * Left undefined, `detectConsensus` assumes TowerBFT and plans against
   * ~12.8s — the safe reading. It only shortens when something actually
   * observed says otherwise (a Votor certificate, the feature gate, or
   * repeated sub-second finalities). Alpenglow's published date is
   * deliberately NOT an input: a date is a plan, and releasing money faster
   * because a calendar rolled over is how a delayed release becomes an
   * incident.
   */
  observation?: ConsensusObservation;
}

export function settlementPolicy(opts: SettlementPolicyOptions = {}): SettlementPolicy {
  return {
    forPayment({ amountAtomic, decimals, network }): SettlementVerdict {
      const chain = CHAIN_FOR_NETWORK[network];

      if (!chain) {
        // An unmodelled network — the example's simulation rail, for instance.
        // Fall back to a single confirmation and say so, rather than inventing
        // a finality claim for a chain that does not exist.
        return {
          confirmations: 1,
          expectedWaitMs: 0,
          unsatisfiable: false,
          tier: "unmodelled",
          explanation: `No finality model for "${network}"; releasing on first confirmation.`,
        };
      }

      // Atomic string to USD for tiering only. The division happens once, here,
      // at the boundary — and the result feeds a THRESHOLD comparison, never an
      // accounting figure. Nothing downstream stores this number.
      const usd = Number(BigInt(amountAtomic)) / 10 ** decimals;

      const plan = planSettlement({ amountUsd: usd, chain, observation: opts.observation });

      return {
        confirmations: confirmationsFor(plan.expectedWaitMs, chain),
        expectedWaitMs: plan.expectedWaitMs,
        unsatisfiable: plan.unsatisfiable,
        tier: plan.tier,
        explanation: plan.explanation,
      };
    },
  };
}
