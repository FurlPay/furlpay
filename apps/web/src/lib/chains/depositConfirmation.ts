// ---------------------------------------------------------------------------
// Reorg-aware deposit crediting.
//
// THE PROBLEM: Settlement has a confirmation-depth gate via @furlpay/settlement.
// Deposits do not. A deposit credited during a chain reorganization credits
// money that never existed — and because the ledger is append-only, the only
// correction is a compensating entry that the customer may have already spent.
//
// THIS MODULE: defines per-chain confirmation policies that MUST be satisfied
// before a deposit is credited to a customer's balance.
// ---------------------------------------------------------------------------

export interface DepositConfirmationPolicy {
  chain: string;
  /** Minimum confirmations before crediting a deposit. */
  minConfirmations: number;
  /** Maximum block depth to monitor for reorgs after crediting. */
  reorgMonitorDepth: number;
  /** Expected time to reach minConfirmations, in milliseconds. */
  expectedWaitMs: number;
  /** Whether the chain has bounded finality. If not, minConfirmations is a
   *  risk-accepted threshold, not a guarantee. */
  boundedFinality: boolean;
}

export const DEPOSIT_POLICIES: Record<string, DepositConfirmationPolicy> = {
  ethereum: {
    chain: "ethereum",
    minConfirmations: 12,
    reorgMonitorDepth: 64,
    expectedWaitMs: 12 * 12_000, // ~2.4 min
    boundedFinality: true,
  },
  arbitrum: {
    chain: "arbitrum",
    minConfirmations: 1,
    reorgMonitorDepth: 10,
    expectedWaitMs: 250,
    boundedFinality: false, // Optimistic — no bounded L1 finality
  },
  base: {
    chain: "base",
    minConfirmations: 1,
    reorgMonitorDepth: 10,
    expectedWaitMs: 2_000,
    boundedFinality: false, // Optimistic rollup
  },
  polygon: {
    chain: "polygon",
    minConfirmations: 128,
    reorgMonitorDepth: 256,
    expectedWaitMs: 128 * 2_100, // ~4.5 min
    boundedFinality: true,
  },
  solana: {
    chain: "solana",
    minConfirmations: 31, // ~12.8s at TowerBFT; ~400ms at Alpenglow
    reorgMonitorDepth: 64,
    expectedWaitMs: 12_800,
    boundedFinality: true,
  },
  arc: {
    chain: "arc",
    minConfirmations: 1, // Deterministic sub-second finality
    reorgMonitorDepth: 3,
    expectedWaitMs: 800,
    boundedFinality: true,
  },
  tempo: {
    chain: "tempo",
    minConfirmations: 1, // Sub-second settlement
    reorgMonitorDepth: 3,
    expectedWaitMs: 500,
    boundedFinality: true,
  },
};

export function getDepositPolicy(chain: string): DepositConfirmationPolicy | undefined {
  // Own properties only: "constructor"/"toString" would otherwise return an
  // Object.prototype member whose minConfirmations is undefined, and
  // `n < undefined` is false — canCreditDeposit would report a deposit safe.
  return Object.hasOwn(DEPOSIT_POLICIES, chain) ? DEPOSIT_POLICIES[chain] : undefined;
}

export function canCreditDeposit(chain: string, currentConfirmations: number): { safe: boolean; reason: string; policy: DepositConfirmationPolicy | undefined } {
  const policy = getDepositPolicy(chain);
  if (!policy) {
    return { safe: false, reason: `No deposit policy defined for chain ${chain}`, policy: undefined };
  }
  
  if (currentConfirmations < policy.minConfirmations) {
    return { 
      safe: false, 
      reason: `Insufficient confirmations: ${currentConfirmations} < ${policy.minConfirmations}`,
      policy 
    };
  }
  
  return { safe: true, reason: "Confirmations satisfied", policy };
}

export function isDepositFinal(chain: string, confirmations: number): boolean {
  const policy = getDepositPolicy(chain);
  if (!policy) return false;
  return policy.boundedFinality && confirmations >= policy.minConfirmations;
}
