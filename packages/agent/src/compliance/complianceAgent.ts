import { ethers } from "ethers";
import Anthropic from "@anthropic-ai/sdk";
import {
  WRAPPER_ABI,
  ATTESTATION_ABI,
  ESCROW_ABI,
  POLICY_MANAGER_ABI,
  OUTCOME,
  reasonToString,
  type Addresses,
  type Authorization,
  type Outcome,
} from "./chain.js";

// Compliance agent — the mediator. It evaluates a proposed payment against the
// on-chain PolicyManager, and:
//   - PASS    → submits settlement through the PolicyWrapper (non-custodial)
//   - FAIL    → submits it anyway so the on-chain FAIL attestation is recorded,
//               but no funds move; reports the rejection
//   - PENDING → proposes a tranche split (compliant part settles, remainder is
//               escrowed), collects a source-of-funds attestation, then releases
//
// Claude (Opus 4.8) is used for the *mediation* layer — explaining the outcome
// and articulating the staged-settlement proposal to the buyer — while the
// *enforcement* is entirely on-chain. The chain decides; the agent negotiates.

export interface EvaluateResult {
  outcome: Outcome;
  reason: string;
}

export class ComplianceAgent {
  private wrapper: ethers.Contract;
  private attestations: ethers.Contract;
  private escrow: ethers.Contract;
  private policyManager: ethers.Contract;
  private anthropic?: Anthropic;

  constructor(
    private relayer: ethers.Wallet,
    private attestor: ethers.Wallet,
    private addresses: Addresses,
    private chainId: number,
    private sofThresholdUsdc = Number(process.env.SOF_THRESHOLD_USDC || 1000),
  ) {
    // Wrap signers in NonceManager so sequential txs get correct, locally-tracked
    // nonces (the JSON-RPC provider's getTransactionCount can lag between awaited
    // txs and cause "nonce too low"). Share one manager when relayer == attestor.
    const relayerSigner = new ethers.NonceManager(relayer);
    const attestorSigner =
      relayer.address.toLowerCase() === attestor.address.toLowerCase()
        ? relayerSigner
        : new ethers.NonceManager(attestor);
    this.wrapper = new ethers.Contract(addresses.policyWrapper, WRAPPER_ABI, relayerSigner);
    this.attestations = new ethers.Contract(addresses.attestationRegistry, ATTESTATION_ABI, attestorSigner);
    this.escrow = new ethers.Contract(addresses.complianceEscrow, ESCROW_ABI, relayerSigner);
    this.policyManager = new ethers.Contract(addresses.policyManager, POLICY_MANAGER_ABI, relayer.provider);
    if (process.env.ANTHROPIC_API_KEY) this.anthropic = new Anthropic();
  }

  /** Read-only policy evaluation (non-interactive check). */
  async evaluate(payer: string, recipient: string, amount: bigint, txId: string): Promise<EvaluateResult> {
    const [outcome, reason] = await this.policyManager.evaluate({ payer, recipient, amount, txId });
    return { outcome: OUTCOME[Number(outcome)] ?? "FAIL", reason: reasonToString(reason) };
  }

  /** Claude-authored explanation of the compliance decision (mediation layer). */
  async explain(context: {
    outcome: Outcome;
    reason: string;
    amountUsdc: number;
    product: string;
  }): Promise<string> {
    if (!this.anthropic) return this.fallbackExplain(context);
    try {
      const resp = await this.anthropic.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 700,
        thinking: { type: "adaptive" },
        system:
          "You are FurlPay's compliance mediation agent for on-chain stablecoin payments. " +
          "Explain the compliance outcome for a payment plainly and professionally, in 2-3 sentences. " +
          "For PENDING (source-of-funds), explain that an initial compliant tranche settles immediately " +
          "and the remainder is held in on-chain escrow until a source-of-funds attestation is provided. " +
          "No emojis.",
        messages: [
          {
            role: "user",
            content:
              `Outcome: ${context.outcome} (${context.reason || "none"}). ` +
              `Payment: ${context.amountUsdc} USDC for "${context.product}". ` +
              `Source-of-funds threshold: ${this.sofThresholdUsdc} USDC.`,
          },
        ],
      });
      const text = resp.content.find((b) => b.type === "text");
      return text && text.type === "text" ? text.text.trim() : this.fallbackExplain(context);
    } catch {
      return this.fallbackExplain(context);
    }
  }

  private fallbackExplain(context: { outcome: Outcome; reason: string; amountUsdc: number }): string {
    switch (context.outcome) {
      case "PASS":
        return `Payment of ${context.amountUsdc} USDC passed all compliance checks and settled immediately.`;
      case "FAIL":
        return `Payment blocked: ${context.reason || "sanctions"} check failed. No funds were moved; a FAIL attestation was recorded on-chain.`;
      default:
        return `Payment exceeds the ${this.sofThresholdUsdc} USDC source-of-funds threshold. An initial ${this.sofThresholdUsdc} USDC tranche settles now; the remainder is escrowed on-chain until a source-of-funds attestation is provided.`;
    }
  }

  /** Scenario I — settle (or record rejection) via the PolicyWrapper. */
  async settle(from: string, to: string, auth: Authorization, resource: string, txId: string) {
    const resourceHash = ethers.id(resource);
    const tx = await this.wrapper.settleWithPolicy(from, to, auth, resourceHash, txId);
    const receipt = await tx.wait();
    return { txHash: receipt.hash as string, blockNumber: receipt.blockNumber as number };
  }

  /** Scenario II — settle the compliant tranche and escrow the remainder. */
  async tranche(
    from: string,
    to: string,
    compliantAuth: Authorization,
    escrowAuth: Authorization,
    resource: string,
    txId: string,
    releaseDeadline: number,
  ) {
    const resourceHash = ethers.id(resource);
    const tx = await this.wrapper.settleTranche(
      from,
      to,
      compliantAuth,
      escrowAuth,
      resourceHash,
      txId,
      releaseDeadline,
    );
    const receipt = await tx.wait();
    return { txHash: receipt.hash as string, blockNumber: receipt.blockNumber as number };
  }

  /** Record a source-of-funds attestation for a payer (attestor key). */
  async recordSoF(subject: string, evidenceHash: string, expiry: number) {
    const tx = await this.attestations.recordSoF(subject, evidenceHash, expiry);
    const receipt = await tx.wait();
    return { txHash: receipt.hash as string };
  }

  /** Release an escrowed tranche once SoF is attested. */
  async release(txId: string) {
    const tx = await this.escrow.release(txId);
    const receipt = await tx.wait();
    return { txHash: receipt.hash as string };
  }

  async attestation(txId: string) {
    const [outcome, reason, timestamp, exists] = await this.attestations.txAttestations(txId);
    return {
      exists: exists as boolean,
      outcome: OUTCOME[Number(outcome)] ?? "PASS",
      reason: reasonToString(reason),
      timestamp: Number(timestamp),
    };
  }

  /** Compliant tranche = min(amount, threshold); remainder is escrowed. */
  splitAtThreshold(amountAtomic: bigint): { compliant: bigint; remainder: bigint } {
    const threshold = ethers.parseUnits(String(this.sofThresholdUsdc), 6);
    if (amountAtomic <= threshold) return { compliant: amountAtomic, remainder: 0n };
    return { compliant: threshold, remainder: amountAtomic - threshold };
  }
}
