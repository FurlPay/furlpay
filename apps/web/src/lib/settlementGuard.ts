import type { Log } from "viem";
import { kvIncr } from "@/lib/kv";
import { railPaused } from "@/lib/ops/controls";
import {
  assertSettlementAllowed,
  autoTrip,
  networkScope,
  SettlementHaltedError,
} from "@/lib/settlementSafety";
import {
  evaluateChainHealth,
  probeChain,
  verifySettlementReceipt,
  type ExpectedTransfer,
  type Finding,
  type ProviderObservation,
} from "@/lib/settlementDetectors";

// ---------------------------------------------------------------------------
// The two calls lib/x402Settler.ts makes around the irreversible step:
//
//   beforeBroadcast(network)  — chain health, velocity, then the durable gate
//                               LAST, so the window between "state checked" and
//                               "transaction signed" is one KV round trip rather
//                               than the length of an RPC probe.
//   afterReceipt(...)         — the confirmed receipt must show exactly the
//                               authorized transfer before success is reported.
//
// RESIDUAL WINDOW, stated rather than hidden: a halt written after the gate
// read and before writeContract returns does not stop that one transaction. An
// external broadcast cannot be made atomic with a KV read. The window is
// milliseconds, and the epoch fence guarantees nothing AFTER it gets through.
// ---------------------------------------------------------------------------

export interface GuardDeps {
  probe: (network: string) => Promise<ProviderObservation[]>;
  now: () => number;
}

const defaultDeps: GuardDeps = { probe: (n) => probeChain(n), now: () => Date.now() };

// A HEALTHY verdict may be reused briefly — probing three RPC calls per
// micropayment is a cost, and a 10s-old "healthy" is still evidence. An
// unhealthy or failed probe is never cached: the next request probes again.
const HEALTH_CACHE_MS = 10_000;
const healthyUntil = new Map<string, number>();

export function __resetGuardCacheForTests(): void {
  healthyUntil.clear();
}

export async function beforeBroadcast(network: string, deps: GuardDeps = defaultDeps): Promise<void> {
  const scope = networkScope(network);
  const now = deps.now();

  if ((healthyUntil.get(network) ?? 0) <= now) {
    const findings = evaluateChainHealth(network, await deps.probe(network), Math.floor(now / 1000));
    const blocking = findings.filter((f) => f.action !== "report");
    if (blocking.length) {
      await applyFindings(scope, blocking);
      throw new SettlementHaltedError(scope, blocking.map((f) => f.signal).join(","));
    }
    healthyUntil.set(network, now + HEALTH_CACHE_MS);
  }

  await checkVelocity(network, now);

  // The ops console's GLOBAL pause (lib/ops/controls.ts) stops broadcasting too.
  // Before this it was enforced only at route tops, so the button an operator
  // reaches for in an incident did not stop the facilitator. Rail pauses stay
  // route-level: the settler serves several rails and cannot tell which one
  // called it. Unlike controls.ts itself, this read fails closed.
  let opsPause: Awaited<ReturnType<typeof railPaused>>;
  try {
    opsPause = await railPaused("x402");
  } catch {
    throw new SettlementHaltedError("control_plane", "ops pause state could not be read");
  }
  if (opsPause.paused && opsPause.scope === "global") {
    throw new SettlementHaltedError("global", `ops global pause${opsPause.state?.reason ? ` (${opsPause.state.reason})` : ""}`);
  }

  // LAST: the durable, epoch-fenced gate. Fails closed on any store error.
  await assertSettlementAllowed(network);
}

export async function afterReceipt(
  network: string,
  logs: Log[],
  expected: ExpectedTransfer,
  tx: string,
): Promise<void> {
  const finding = verifySettlementReceipt(logs, expected);
  if (!finding) return;
  healthyUntil.delete(network);
  await applyFindings(networkScope(network), [{ ...finding, evidence: { ...finding.evidence, tx } }], tx);
  throw new SettlementHaltedError(networkScope(network), `receipt_mismatch on ${tx}`, undefined, tx);
}

/** Apply blocking findings to a scope: a halt finding trips HALTED, otherwise
 *  DEGRADED. Shared by the pre-broadcast gate and the scheduled sweep so both
 *  follow one policy. Respects shadow mode (autoTrip). */
export async function applyFindings(scope: ReturnType<typeof networkScope>, findings: Finding[], correlationId?: string): Promise<void> {
  const halt = findings.find((f) => f.action === "halt");
  const f = halt ?? findings[0];
  await autoTrip({
    scope,
    signal: f.signal,
    severity: f.severity === "critical" ? "critical" : "high",
    evidence: { ...f.evidence, signals: findings.map((x) => x.signal) },
    actor: `system:${f.signal}`,
    correlationId,
    to: halt ? "HALTED" : "DEGRADED",
  });
}

/**
 * Settlement-count velocity per network per hour. OFF unless
 * SETTLEMENT_MAX_PER_HOUR is set: there is no production history to derive a
 * threshold from, and an invented constant would either never fire or halt
 * real traffic. What it bounds is the fee-payer's gas exposure — EIP-3009
 * moves payer funds directly, so FurlPay's own outflow per settlement is gas.
 */
async function checkVelocity(network: string, now: number): Promise<void> {
  const cap = Number(process.env.SETTLEMENT_MAX_PER_HOUR);
  if (!Number.isInteger(cap) || cap <= 0) return;
  const bucket = Math.floor(now / 3_600_000);
  let count: number;
  try {
    count = await kvIncr(`settle:velocity:${network}:${bucket}`, 3_700);
  } catch {
    throw new SettlementHaltedError("control_plane", "velocity counter unavailable");
  }
  if (count > cap) {
    await autoTrip({
      scope: networkScope(network),
      signal: "settlement_velocity",
      severity: "high",
      evidence: { network, count, cap, windowSeconds: 3600 },
      actor: "system:settlement_velocity",
      to: "HALTED",
    });
    throw new SettlementHaltedError(networkScope(network), `settlement_velocity ${count}/${cap} per hour`);
  }
}
