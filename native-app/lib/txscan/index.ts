import { track } from "@/lib/analytics";
import { flagEnabled } from "@/lib/flags";
import { analyzeTransaction, type AnalyzeInput } from "./analyze";
import { simulateWithProvider } from "./provider";
import { worstRisk, type ScanFinding, type ScanResult } from "./types";

// ---------------------------------------------------------------------------
// The scan orchestrator: run both layers, merge honestly.
//
// MERGE RULE: THE WORST VERDICT WINS, AND NEITHER LAYER MAY LOWER THE OTHER.
//
// This is the whole safety property of the module and it is easy to get subtly
// wrong. The intuitive merge — "the provider simulated real chain state, so
// trust its verdict over our heuristics" — means a provider that returns
// `safe` for an unlimited approval (because unlimited approvals are legitimate
// and it is scoring maliciousness, not user intent) erases the local
// `danger` finding the user most needed to see. So the levels are combined with
// `worstRisk` and the findings are concatenated. A user may see the same
// concern twice; they will never see it zero times.
//
// FINDINGS ARE DEDUPLICATED BY id, NOT BY TEXT. Two layers describing the same
// unlimited approval in different words are one concern, and showing it twice
// dilutes the list. Ids are namespaced by layer where the concerns are genuinely
// different.
// ---------------------------------------------------------------------------

export interface ScanOptions extends AnalyzeInput {
  /** The connected site, when this came from WalletConnect. Feeds domain reputation. */
  origin?: string;
  /**
   * Skip the network layer.
   *
   * Set when the user has declined provider scanning in settings (it discloses
   * the transaction to a third party before it is public) and on paths that
   * must not add latency. Local analysis still runs — it is not optional.
   */
  localOnly?: boolean;
}

export async function scanTransaction(options: ScanOptions): Promise<ScanResult> {
  const started = Date.now();
  const local = analyzeTransaction(options);

  // The flag is a kill switch for the NETWORK layer only. Local analysis is
  // pure, free and offline, so there is no state of the world in which turning
  // it off makes anything better.
  if (options.localOnly || !flagEnabled("tx_simulation")) {
    track("tx_simulated", {
      chain: String(options.chainId),
      riskLevel: local.level,
      findingCount: local.findings.length,
      provider: "local",
      latencyMs: Date.now() - started,
    });
    return local;
  }

  const outcome = await simulateWithProvider({
    chainId: options.chainId,
    from: options.from,
    to: options.to,
    // Decimal string: see normalizeDelta in ./provider.ts — a wei value cannot
    // survive a JSON number.
    value: options.value.toString(),
    data: options.data,
    origin: options.origin,
  });

  if (!outcome.ok) {
    const merged: ScanResult = {
      ...local,
      // The local level stands. It is a real verdict from a real analysis, and
      // downgrading it to "unknown" because a second opinion was unavailable
      // would discard the finding that is actually in hand.
      findings: [
        ...local.findings,
        {
          id: "provider_unavailable",
          // `unknown`, not `caution`: the deep check not running is a gap in
          // knowledge, not evidence of a problem. Colouring it as a warning
          // teaches users to ignore warnings.
          level: "unknown",
          title: "Deep security check did not run",
          detail: outcome.unconfigured
            ? "Extended contract simulation is not configured for this deployment. FurlPay's own checks still ran."
            : outcome.reason,
        } satisfies ScanFinding,
      ],
      providerError: outcome.reason,
    };
    track("tx_simulated", {
      chain: String(options.chainId),
      riskLevel: merged.level,
      findingCount: merged.findings.length,
      provider: "local_only",
      latencyMs: Date.now() - started,
    });
    return merged;
  }

  const remote = outcome.result;
  const seen = new Set<string>();
  const findings: ScanFinding[] = [];
  for (const f of [...local.findings, ...remote.findings]) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    findings.push(f);
  }

  const merged: ScanResult = {
    level: worstRisk([local.level, remote.level]),
    // The provider simulated actual state, so its category is better informed —
    // but only when it committed to one. "unknown" from the provider must not
    // erase a category the local decoder was certain about.
    category: remote.category !== "unknown" ? remote.category : local.category,
    findings,
    // Provider deltas come from real state and supersede our inferred ones;
    // ours are used only when the provider returned none.
    deltas: remote.deltas.length > 0 ? remote.deltas : local.deltas,
    // Carried through from the provider, never asserted here. The server
    // answers this call with a local decode when no vendor is configured, and
    // claiming a simulation happened because a response arrived is exactly the
    // fabrication this module exists to avoid.
    simulated: remote.simulated,
    sources: [...local.sources, ...remote.sources],
    contract: remote.contract ?? local.contract,
  };

  track("tx_simulated", {
    chain: String(options.chainId),
    riskLevel: merged.level,
    findingCount: merged.findings.length,
    provider: remote.sources[0] ?? "provider",
    latencyMs: Date.now() - started,
  });

  return merged;
}

export { analyzeTransaction, SELECTORS, UINT256_MAX, short } from "./analyze";
export { simulateWithProvider } from "./provider";
export {
  RISK_ORDER,
  requiresExplicitAcknowledgement,
  toMoneyWarnings,
  unscannedResult,
  worstRisk,
} from "./types";
export type { AssetDelta, RiskLevel, ScanFinding, ScanResult, TxCategory } from "./types";
