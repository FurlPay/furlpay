import { applyFindings } from "@/lib/settlementGuard";
import { evaluateChainHealth, evaluateRpcIndependence, probeChain, type Finding, type ProviderObservation } from "@/lib/settlementDetectors";
import { checkNetworkTokens, readToken, type TokenReader } from "@/lib/settlementTokenMonitor";
import { reconcileNetwork, type ChainCheck } from "@/lib/settlementReconcile";
import { clearDegraded, networkScope, readScope } from "@/lib/settlementSafety";
import { checkSettlementOnChain } from "@/lib/x402Settler";
import { EVM_CHAIN_IDS } from "@/lib/x402Signature";
import { rpcUrl } from "@/lib/x402Chains";

// ---------------------------------------------------------------------------
// The scheduled settlement-safety sweep (finding FP-SET-05: the reconciler ran
// only when an operator acted). One pass per settlement network:
//
//   1. chain health        — same detectors as the pre-broadcast gate
//   2. token integrity     — implementation / admin / owner / paused vs pins
//   3. reconciliation      — pending → confirmed/abandoned; 24h reorg re-check
//   4. apply               — blocking findings trip the breaker (shadow mode
//                            records only); a DEGRADED scope with a clean pass
//                            is cleared — the ONLY automatic return to NORMAL
//
// Never broadcasts, never re-sends, never repairs: reconciliation only reads
// the chain and moves records between pending/confirmed/abandoned.
// Overlap, budget and run records come from lib/cron/runner.ts (runJob).
// ---------------------------------------------------------------------------

/** Networks this deployment settles on: those with an RPC configured. With
 *  none configured the settler falls back to public RPCs, and the one network
 *  it settles by default is arbitrum. */
export function settlementNetworks(): string[] {
  const configured = Object.keys(EVM_CHAIN_IDS).filter((n) => !!rpcUrl(n));
  return configured.length ? configured : ["arbitrum"];
}

export interface SweepDeps {
  probe: (network: string) => Promise<ProviderObservation[]>;
  readToken: TokenReader;
  chainCheck: ChainCheck;
  now: () => number;
}

export const defaultSweepDeps: SweepDeps = {
  probe: (n) => probeChain(n),
  readToken,
  chainCheck: checkSettlementOnChain,
  now: () => Date.now(),
};

export interface NetworkSweep {
  network: string;
  findings: string[];
  unresolved: number;
  reorged: number;
  rpcErrors: number;
  state: string;
  cleared: boolean;
}

export async function sweepNetwork(network: string, deps: SweepDeps = defaultSweepDeps): Promise<NetworkSweep> {
  const now = deps.now();
  const scope = networkScope(network);
  const health = evaluateChainHealth(network, await deps.probe(network), Math.floor(now / 1000));
  const tokens = await checkNetworkTokens(network, deps.readToken);
  const recon = await reconcileNetwork(network, deps.chainCheck, now); // trips itself on reorg

  const independence = evaluateRpcIndependence(network);
  const all: Finding[] = [...health, ...tokens, ...(independence ? [independence] : [])];
  const blocking = all.filter((f) => f.action !== "report");
  let cleared = false;
  if (blocking.length) {
    await applyFindings(scope, blocking, `sweep:${now}`);
  } else if (!recon.reorged.length) {
    cleared = (await clearDegraded(scope, "system:sweep"))?.ok === true;
  }
  const state = (await readScope(scope).catch(() => null))?.state ?? "UNREADABLE";
  return {
    network,
    findings: all.map((f) => f.signal),
    unresolved: recon.stillPending.length,
    reorged: recon.reorged.length,
    rpcErrors: recon.errors,
    state,
    cleared,
  };
}

/** Sweep every settlement network, stopping cleanly when the budget runs out. */
export async function runSettlementSweep(
  expired: () => boolean,
  deps: SweepDeps = defaultSweepDeps,
): Promise<{ results: NetworkSweep[]; skipped: string[] }> {
  const results: NetworkSweep[] = [];
  const skipped: string[] = [];
  for (const network of settlementNetworks()) {
    if (expired()) {
      skipped.push(network);
      continue;
    }
    results.push(await sweepNetwork(network, deps));
  }
  return { results, skipped };
}
