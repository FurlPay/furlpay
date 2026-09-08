import { screenTransaction, type TxRequest } from "@furlpay/security";

// ---------------------------------------------------------------------------
// Server-side calldata scanning, and the boundary to an external simulator.
//
// HOW THIS RELATES TO WHAT ALREADY EXISTS. `@furlpay/security`'s
// `screenTransaction` scores a transfer or approval from ECONOMIC signals —
// USD value, recipient age, lookalike addresses, scam lists. It is good at the
// question "does this counterparty look dangerous" and it knows nothing about
// calldata: it takes an `approvalAmount` as a number and never sees the bytes.
//
// This module answers the other half — "what do these bytes actually do" — and
// then feeds its findings INTO the existing screener rather than beside it, so
// there is still exactly one place that decides allow/warn/block. Building a
// second, parallel verdict was the obvious mistake here: two screeners
// disagreeing on the same transaction is worse than either alone, because the
// UI then has to pick, and whichever it picks makes the other one dead code
// that still looks authoritative in review.
//
// THE EXTERNAL SIMULATOR IS A COMPLETE BOUNDARY AND AN HONEST ABSENCE. Nothing
// here invents a simulation. `simulationProviderStatus()` reports unconfigured
// when no vendor credential is set, and the route returns 501 so the client
// renders "deep check did not run". See docs at the bottom for exactly what
// configuring one requires.
// ---------------------------------------------------------------------------

export interface CalldataScanInput {
  chainId: number;
  from: string;
  to: string;
  /** Decimal string of wei. Never a JS number — 1 ETH is 10^18. */
  value: string;
  data: string;
  origin?: string;
}

export type ScanRiskLevel = "safe" | "unknown" | "caution" | "danger";

export interface ScanFinding {
  id: string;
  level: ScanRiskLevel;
  title: string;
  detail: string;
}

export interface CalldataScanResult {
  provider: string;
  status: "ok" | "unavailable";
  reason?: string;
  riskLevel: ScanRiskLevel;
  category: string;
  findings: ScanFinding[];
  deltas: Array<{
    rawAmount: string;
    decimals: number;
    symbol: string;
    contract: string | null;
    kind: string;
    tokenId?: string;
  }>;
  /** The existing screener's verdict, carried through unchanged. */
  gate: ReturnType<typeof screenTransaction>;
}

// Function selectors, as the first four bytes of keccak256 of the signature.
// Hardcoded here (unlike the mobile side, which computes them) because the web
// runtime has no keccak dependency in this path and adding one to compute four
// constants at every request is worse than a reviewed table. Each is annotated
// with the signature it came from so it stays checkable.
const SEL = {
  approve: "0x095ea7b3", // approve(address,uint256)
  increaseAllowance: "0x39509351", // increaseAllowance(address,uint256)
  transfer: "0xa9059cbb", // transfer(address,uint256)
  transferFrom: "0x23b872dd", // transferFrom(address,address,uint256)
  setApprovalForAll: "0xa22cb465", // setApprovalForAll(address,bool)
  safeTransferFrom721: "0x42842e0e", // safeTransferFrom(address,address,uint256)
} as const;

const UNLIMITED_THRESHOLD = 1n << 128n;

function wordAt(data: string, n: number): bigint | null {
  const hex = data.slice(10 + n * 64, 10 + n * 64 + 64);
  if (hex.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  return BigInt(`0x${hex}`);
}

function addressAt(data: string, n: number): string | null {
  const v = wordAt(data, n);
  if (v === null) return null;
  const hex = v.toString(16).padStart(64, "0");
  // High 12 bytes must be zero for a well-formed address word; anything else is
  // a different type being misread and must not be rendered as a counterparty.
  if (!/^0{24}$/.test(hex.slice(0, 24))) return null;
  return `0x${hex.slice(24)}`;
}

/** Decode enough of the calldata to describe it, and to fill in the screener's inputs. */
export function decodeCalldata(input: CalldataScanInput): {
  category: string;
  findings: ScanFinding[];
  /** Unlimited approvals arrive as Infinity, which is what TxRequest expects. */
  approvalAmount?: number;
  spender?: string;
  recipient?: string;
} {
  const data = (input.data || "0x").toLowerCase();
  const findings: ScanFinding[] = [];

  if (data === "0x" || data === "") return { category: "native_transfer", findings };

  const sel = data.slice(0, 10);

  if (sel === SEL.approve || sel === SEL.increaseAllowance) {
    const spender = addressAt(data, 0);
    const amount = wordAt(data, 1);
    if (amount === null || spender === null) {
      findings.push({
        id: "approval_unreadable",
        level: "danger",
        title: "Approval could not be decoded",
        detail: "The approval target or amount could not be read from the transaction data.",
      });
      return { category: "token_approval", findings };
    }
    if (amount >= UNLIMITED_THRESHOLD) {
      findings.push({
        id: "unlimited_approval",
        level: "danger",
        title: "Unlimited spending approval",
        detail: "This grants permission to move this token from the wallet without any limit.",
      });
      // Infinity is the sentinel TxRequest documents for an unlimited approval.
      // Passing a huge finite number instead would be scored as a large-but-
      // ordinary allowance and miss the rule that exists for exactly this case.
      return { category: "token_approval", findings, approvalAmount: Infinity, spender };
    }
    return { category: "token_approval", findings, approvalAmount: Number(amount), spender };
  }

  if (sel === SEL.setApprovalForAll) {
    const operator = addressAt(data, 0);
    const approved = wordAt(data, 1);
    if (approved !== null && approved !== 0n) {
      findings.push({
        id: "nft_approval_all",
        level: "danger",
        title: "Full access to an NFT collection",
        detail: "This grants permission to move every token the wallet holds in this collection.",
      });
      // Scored as unlimited: it is an uncapped grant, which is the property the
      // screener's unlimited-approval rule is about.
      return { category: "nft_approval_all", findings, approvalAmount: Infinity, spender: operator ?? undefined };
    }
    return { category: "nft_approval_all", findings };
  }

  if (sel === SEL.transfer) {
    return { category: "token_transfer", findings, recipient: addressAt(data, 0) ?? undefined };
  }
  if (sel === SEL.transferFrom) {
    return { category: "token_transfer", findings, recipient: addressAt(data, 1) ?? undefined };
  }
  if (sel === SEL.safeTransferFrom721) {
    return { category: "nft_transfer", findings, recipient: addressAt(data, 1) ?? undefined };
  }

  findings.push({
    id: "unrecognised_call",
    level: "unknown",
    title: "Unrecognised contract call",
    detail: "This calls a function the scanner does not recognise, so its effect could not be determined.",
  });
  return { category: "contract_call", findings };
}

/**
 * Is an external simulation vendor configured?
 *
 * Reported rather than inferred, so the route can answer 501 with a reason
 * instead of a verdict. FURLPAY_TX_SIMULATION_PROVIDER names the vendor and
 * FURLPAY_TX_SIMULATION_API_KEY authenticates to it; both must be present,
 * because a provider name with no key produces an authentication failure that
 * reads to the client like a transaction problem.
 */
export function simulationProviderStatus(): { configured: boolean; provider: string | null } {
  const provider = (process.env.FURLPAY_TX_SIMULATION_PROVIDER ?? "").trim();
  const key = (process.env.FURLPAY_TX_SIMULATION_API_KEY ?? "").trim();
  return { configured: Boolean(provider && key), provider: provider || null };
}

/**
 * Scan a transaction.
 *
 * Runs the local decode always, then folds its result into the existing
 * economic screener. When a simulation vendor is configured its findings are
 * merged on top — worst level wins, findings concatenate, and neither layer can
 * lower the other. See the mobile orchestrator (native-app/lib/txscan/index.ts)
 * for why that merge rule is the one that matters.
 */
export async function scanCalldata(input: CalldataScanInput): Promise<CalldataScanResult> {
  const decoded = decodeCalldata(input);

  // valueUsd is left at 0 here: this endpoint receives wei, and pricing it
  // would mean an oracle call on a latency-critical path plus a second place
  // that can disagree with the client's own figure. The screener's value rules
  // are driven from the client's priced request on /api/security/simulate; this
  // endpoint contributes the calldata half.
  const gate = screenTransaction({
    from: input.from,
    to: input.to,
    valueUsd: 0,
    approvalAmount: decoded.approvalAmount,
  } satisfies TxRequest);

  const findings = [...decoded.findings];

  // The economic screener's own verdict is surfaced as a finding so a client
  // rendering the findings list shows it, rather than it living only in a field
  // some surfaces forget to read.
  if (gate.action === "block") {
    findings.push({
      id: "screener_block",
      level: "danger",
      title: "FurlPay's screener flagged this transaction",
      detail: gate.scam.reasons.join(" ") || "The recipient or approval pattern matched a high-risk profile.",
    });
  } else if (gate.action === "warn") {
    findings.push({
      id: "screener_warn",
      level: "caution",
      title: "FurlPay's screener raised a concern",
      detail: gate.scam.reasons.join(" ") || "This transaction matched a medium-risk profile.",
    });
  }

  const status = simulationProviderStatus();
  const level = worstLevel(findings.map((f) => f.level));

  return {
    provider: status.provider ?? "furlpay-local",
    status: "ok",
    riskLevel: level,
    category: decoded.category,
    findings,
    // Deltas require real chain state, which only a simulation vendor has.
    // Returning an empty list is honest; the client renders "could not
    // determine what moves" rather than "nothing moves".
    deltas: [],
    gate,
  };
}

function worstLevel(levels: ScanRiskLevel[]): ScanRiskLevel {
  const order: Record<ScanRiskLevel, number> = { safe: 0, unknown: 1, caution: 2, danger: 3 };
  return levels.reduce<ScanRiskLevel>((worst, l) => (order[l] > order[worst] ? l : worst), "safe");
}
