import { createPublicClient, http, parseEventLogs, parseAbi, type Hex, type Log } from "viem";
import { EVM_CHAINS, rpcUrls } from "@/lib/x402Chains";
import { EVM_CHAIN_IDS } from "@/lib/x402Signature";

// ---------------------------------------------------------------------------
// Settlement safety detectors. Pure evaluation over observations, so every
// policy below is testable without a chain; the one impure function, probeChain,
// only gathers observations.
//
// Each finding names its signal, severity and ACTION:
//   halt     — critical invariant failure; persisted, sticky, needs recovery.
//   degrade  — the data needed to prove safety is missing or unreliable; this
//              request is refused and the scope may be marked DEGRADED, which
//              the monitor clears when the signal passes.
//   report   — visible in ops, blocks nothing (e.g. a single RPC: disagreement
//              cannot be checked, which is stated rather than treated as "agreed").
//
// Trust: every RPC answer is a claim. Two providers agreeing raises confidence;
// it does not prove finality. A single provider can lie consistently, and these
// checks cannot detect that — see the runbook's limitations section.
// ---------------------------------------------------------------------------

export type FindingAction = "halt" | "degrade" | "report";

export interface Finding {
  signal: string;
  severity: "info" | "medium" | "high" | "critical";
  action: FindingAction;
  evidence: Record<string, unknown>;
}

export interface ProviderObservation {
  /** Index into the configured provider list; URLs are not stored (may embed API keys). */
  provider: number;
  ok: boolean;
  error?: string;
  chainId?: number;
  head?: { number: bigint; hash: Hex; timestamp: bigint };
  /** Hash each provider reports for the shared comparison height. */
  atHeight?: { number: bigint; hash: Hex | null };
}

export interface ChainHealthConfig {
  /** Max age of the newest block before the head counts as stale. */
  maxHeadAgeSeconds: number;
  /** Max head-height gap between providers before they count as diverged. */
  maxProviderLagBlocks: number;
}

/** Thresholds from env, with defaults derived from the chains we settle on.
 *  Arbitrum produces a block roughly every 250ms and Base/Polygon every ~2s; a
 *  head two minutes old on any of them means the sequencer or the provider has
 *  stalled, not that the chain is quiet. 50 blocks of provider lag is ~12s on
 *  Arbitrum — past normal propagation jitter. */
export function chainHealthConfig(env: NodeJS.ProcessEnv = process.env): ChainHealthConfig {
  const num = (v: string | undefined, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  return {
    maxHeadAgeSeconds: num(env.SETTLEMENT_MAX_HEAD_AGE_S, 120),
    maxProviderLagBlocks: num(env.SETTLEMENT_MAX_PROVIDER_LAG_BLOCKS, 50),
  };
}

export function evaluateChainHealth(
  network: string,
  observations: ProviderObservation[],
  nowSeconds: number,
  cfg: ChainHealthConfig = chainHealthConfig(),
): Finding[] {
  const expected = EVM_CHAIN_IDS[network];
  const findings: Finding[] = [];
  if (expected === undefined) {
    return [{ signal: "unknown_network", severity: "critical", action: "halt", evidence: { network } }];
  }

  const live = observations.filter((o) => o.ok);
  if (live.length === 0) {
    findings.push({
      signal: "rpc_unavailable",
      severity: "high",
      action: "degrade",
      evidence: { network, providers: observations.length, errors: observations.map((o) => o.error ?? "unknown").slice(0, 3) },
    });
    return findings;
  }

  for (const o of live) {
    if (o.chainId !== expected) {
      findings.push({
        signal: "chain_id_mismatch",
        severity: "critical",
        action: "halt",
        evidence: { network, provider: o.provider, expected, reported: o.chainId ?? null },
      });
    }
  }

  const newest = live.reduce<bigint>((m, o) => (o.head && o.head.timestamp > m ? o.head.timestamp : m), 0n);
  const age = nowSeconds - Number(newest);
  if (!newest || age > cfg.maxHeadAgeSeconds) {
    findings.push({
      signal: "head_stale",
      severity: "high",
      action: "degrade",
      evidence: { network, headAgeSeconds: newest ? age : null, maxHeadAgeSeconds: cfg.maxHeadAgeSeconds },
    });
  }

  if (live.length < 2) {
    findings.push({
      signal: "rpc_unverified",
      severity: "info",
      action: "report",
      evidence: { network, providers: observations.length, note: "one provider: cross-provider agreement cannot be checked" },
    });
    return findings;
  }

  const heads = live.flatMap((o) => (o.head ? [o.head.number] : []));
  if (heads.length >= 2) {
    const max = heads.reduce((a, b) => (b > a ? b : a));
    const min = heads.reduce((a, b) => (b < a ? b : a));
    if (Number(max - min) > cfg.maxProviderLagBlocks) {
      findings.push({
        signal: "rpc_head_divergence",
        severity: "medium",
        action: "degrade",
        evidence: { network, lagBlocks: Number(max - min), maxProviderLagBlocks: cfg.maxProviderLagBlocks },
      });
    }
  }

  // Same height, different hash: the providers are on different chains or one
  // is serving a reorged/forked view. Nothing about a settlement observed
  // through either can be trusted until a human looks.
  const hashes = live.flatMap((o) => (o.atHeight?.hash ? [{ p: o.provider, h: o.atHeight.hash.toLowerCase(), n: o.atHeight.number }] : []));
  if (hashes.length >= 2 && new Set(hashes.map((x) => x.h)).size > 1) {
    findings.push({
      signal: "rpc_hash_disagreement",
      severity: "critical",
      action: "halt",
      evidence: { network, height: hashes[0].n.toString(), hashes: hashes.map((x) => ({ provider: x.p, hash: x.h })) },
    });
  }
  return findings;
}

/** Query every configured provider individually. Never throws: a failed
 *  provider is an observation (ok: false), not an exception. */
export async function probeChain(network: string, timeoutMs = 4_000): Promise<ProviderObservation[]> {
  const chain = EVM_CHAINS[network];
  const urls = rpcUrls(network);
  if (!chain || urls.length === 0) return [];
  const clients = urls.map((u) => createPublicClient({ chain, transport: http(u, { timeout: timeoutMs, retryCount: 0 }) }));

  const first = await Promise.all(
    clients.map(async (c, provider): Promise<ProviderObservation> => {
      try {
        const [chainId, block] = await Promise.all([c.getChainId(), c.getBlock({ blockTag: "latest" })]);
        return { provider, ok: true, chainId, head: { number: block.number!, hash: block.hash!, timestamp: block.timestamp } };
      } catch (e) {
        return { provider, ok: false, error: (e as Error).name || "rpc_error" };
      }
    }),
  );

  // Compare at a height every live provider has: the lowest head, minus a few
  // blocks so ordinary propagation does not look like a fork.
  const heads = first.flatMap((o) => (o.ok && o.head ? [o.head.number] : []));
  if (heads.length < 2) return first;
  const min = heads.reduce((a, b) => (b < a ? b : a));
  const height = min > 5n ? min - 5n : min;
  return Promise.all(
    first.map(async (o, i) => {
      if (!o.ok) return o;
      try {
        const b = await clients[i].getBlock({ blockNumber: height });
        return { ...o, atHeight: { number: height, hash: b.hash } };
      } catch {
        return { ...o, atHeight: { number: height, hash: null } };
      }
    }),
  );
}

// --- receipt verification --------------------------------------------------

const TOKEN_EVENTS = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)",
]);

export interface ExpectedTransfer {
  token: string;
  from: string;
  to: string;
  value: bigint;
  nonce: string;
}

/**
 * Did the confirmed receipt do exactly what the payer authorized? A `status:
 * success` receipt from the pinned USDC contract SHOULD imply it — FiatToken
 * enforces from/to/value from the signed authorization — so a mismatch here
 * means the contract is not behaving as the allowlist assumed (an upgrade, a
 * wrong address) or the RPC is serving a receipt for something else. Either
 * way the settlement must not be reported as success, and nothing else on the
 * network should settle until someone looks.
 */
export function verifySettlementReceipt(logs: Log[], expected: ExpectedTransfer): Finding | null {
  const token = expected.token.toLowerCase();
  const own = logs.filter((l) => l.address.toLowerCase() === token);
  const parse = () => {
    try {
      return parseEventLogs({ abi: TOKEN_EVENTS, logs: own, strict: true });
    } catch {
      return [];
    }
  };
  const events = parse();
  const transfers = events.filter((e) => e.eventName === "Transfer");
  const used = events.filter((e) => e.eventName === "AuthorizationUsed");

  const match = transfers.filter(
    (t) =>
      t.eventName === "Transfer" &&
      t.args.from.toLowerCase() === expected.from.toLowerCase() &&
      t.args.to.toLowerCase() === expected.to.toLowerCase() &&
      t.args.value === expected.value,
  );
  const nonceUsed = used.some(
    (u) =>
      u.eventName === "AuthorizationUsed" &&
      u.args.authorizer.toLowerCase() === expected.from.toLowerCase() &&
      u.args.nonce.toLowerCase() === expected.nonce.toLowerCase(),
  );

  if (match.length === 1 && transfers.length === 1 && nonceUsed) return null;
  return {
    signal: "receipt_mismatch",
    severity: "critical",
    action: "halt",
    evidence: {
      token,
      expectedValue: expected.value.toString(),
      tokenTransfers: transfers.length,
      matchingTransfers: match.length,
      authorizationUsed: nonceUsed,
      observed: transfers.slice(0, 3).map((t) =>
        t.eventName === "Transfer" ? { to: t.args.to, value: t.args.value.toString() } : null,
      ),
    },
  };
}
