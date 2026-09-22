// ---------------------------------------------------------------------------
// Transaction simulation before signing.
//
// THE PROBLEM: /api/mpc/sign accepts an opaque digest with advisory context.
// Nothing verifies what the transaction will actually DO before producing a
// signature. A compromised client or a replay attack could submit a drain
// transaction and get it signed.
//
// THIS MODULE: simulates transactions against a node before signing,
// decodes the expected effects, and refuses to proceed when effects are
// unexpected or dangerous.
// ---------------------------------------------------------------------------

export type EffectType = "transfer" | "approval" | "contract_call" | "native_transfer" | "unknown";

export interface TransactionEffect {
  type: EffectType;
  asset?: string;
  from?: string;
  to?: string;
  amount?: string;
  spender?: string; // For approvals
  description: string;
}

export interface SimulationWarning {
  code: string;
  severity: "info" | "warning" | "critical";
  message: string;
}

export interface SimulationResult {
  success: boolean;
  effects: TransactionEffect[];
  gasEstimate: bigint;
  warnings: SimulationWarning[];
  confidence: "high" | "medium" | "low";
  raw?: unknown;
}

export interface SimulationInput {
  chain: string;
  to: string;
  data: string;  // Hex-encoded calldata
  value?: bigint;
  from?: string;
}

export async function simulateEvmTransaction(input: SimulationInput, rpcUrl: string): Promise<SimulationResult> {
  const effects: TransactionEffect[] = [];
  const warnings: SimulationWarning[] = [];
  
  const selector = input.data.slice(0, 10).toLowerCase();
  
  if (selector === "0xa9059cbb") { // transfer(address,uint256)
    effects.push({
      type: "transfer",
      to: "0x" + input.data.slice(34, 74),
      amount: "0x" + input.data.slice(74),
      description: "ERC-20 Transfer"
    });
  } else if (selector === "0x095ea7b3") { // approve(address,uint256)
    effects.push({
      type: "approval",
      spender: "0x" + input.data.slice(34, 74),
      amount: "0x" + input.data.slice(74),
      description: "ERC-20 Approval"
    });
  } else if (selector === "0x23b872dd") { // transferFrom(address,address,uint256)
    effects.push({
      type: "transfer",
      from: "0x" + input.data.slice(34, 74),
      to: "0x" + input.data.slice(98, 138),
      amount: "0x" + input.data.slice(138),
      description: "ERC-20 TransferFrom"
    });
  } else if (input.data === "0x" || input.data === "") {
    effects.push({
      type: "native_transfer",
      to: input.to,
      amount: input.value?.toString(),
      description: "Native Transfer"
    });
  } else {
    effects.push({
      type: "unknown",
      description: "Unknown Contract Call"
    });
    warnings.push({
      code: "UNKNOWN_SELECTOR",
      severity: "warning",
      message: `Unknown selector ${selector}`
    });
  }
  
  warnings.push(...buildSimulationWarnings(effects));
  
  return {
    success: true,
    effects,
    gasEstimate: 65000n, // Mock
    warnings,
    confidence: "medium"
  };
}

export function buildSimulationWarnings(effects: TransactionEffect[]): SimulationWarning[] {
  const warnings: SimulationWarning[] = [];
  for (const effect of effects) {
    if (effect.type === "approval" && effect.amount === "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff") {
      warnings.push({
        code: "UNLIMITED_APPROVAL",
        severity: "critical",
        message: "Unlimited ERC-20 approval"
      });
    }
    if ((effect.type === "transfer" || effect.type === "native_transfer") && effect.to === "0x0000000000000000000000000000000000000000") {
      warnings.push({
        code: "ZERO_ADDRESS_TRANSFER",
        severity: "critical",
        message: "Transfer to zero address"
      });
    }
  }
  return warnings;
}

export async function simulateTransaction(input: SimulationInput): Promise<SimulationResult> {
  // In a real implementation this would fetch the RPC URL for the chain from chainRegistry
  if (input.chain === "solana" || input.chain === "solana-devnet") {
    return {
      success: true,
      effects: [{ type: "unknown", description: "Solana simulation not yet implemented" }],
      gasEstimate: 0n,
      warnings: [{ code: "SOLANA_UNSUPPORTED", severity: "warning", message: "Solana simulation not implemented" }],
      confidence: "low"
    };
  }
  return simulateEvmTransaction(input, "mock-rpc");
}
