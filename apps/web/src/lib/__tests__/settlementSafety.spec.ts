import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { encodeAbiParameters, encodeEventTopics, parseAbi, type Hex, type Log } from "viem";

// The alert sink is the one external side effect; every test controls it.
const deliver = vi.fn();
vi.mock("@/lib/ops/alertSink", () => ({ deliverSecurityAlert: (a: unknown) => deliver(a) }));

import * as kv from "@/lib/kv";
import {
  approveRecovery,
  assertSettlementAllowed,
  markMitigated,
  networkScope,
  readScope,
  requiredApprovals,
  SettlementHaltedError,
  transitionHistory,
  trip,
  type RecoveryChecks,
} from "@/lib/settlementSafety";
import { evaluateChainHealth, verifySettlementReceipt, type ProviderObservation } from "@/lib/settlementDetectors";
import { __resetGuardCacheForTests, afterReceipt, beforeBroadcast } from "@/lib/settlementGuard";
import { reconcileNetwork } from "@/lib/settlementReconcile";
import { getSettlement, recordSettlement, unresolvedSettlements } from "@/lib/x402SettlementStore";

// ---------------------------------------------------------------------------
// Settlement circuit breaker. Numbers in test names map to the failure cases
// in docs/SETTLEMENT-CIRCUIT-BREAKER-RUNBOOK.md §Test matrix.
// ---------------------------------------------------------------------------

const ARB = "arbitrum";
const SCOPE = networkScope(ARB);
const NOW = 1_800_000_000_000;
const HEALTHY: RecoveryChecks = { healthy: true, unresolvedSettlements: 0 };

const obs = (o: Partial<ProviderObservation> & { provider: number }): ProviderObservation => ({
  ok: true,
  chainId: 42161,
  head: { number: 1000n, hash: `0x${"a".repeat(64)}` as Hex, timestamp: BigInt(Math.floor(NOW / 1000) - 1) },
  atHeight: { number: 995n, hash: `0x${"b".repeat(64)}` as Hex },
  ...o,
});
const twoHealthy = () => [obs({ provider: 0 }), obs({ provider: 1 })];
const deps = (observations: ProviderObservation[]) => ({ probe: async () => observations, now: () => NOW });

beforeEach(() => {
  (globalThis as unknown as { __furlpayKv?: Map<string, unknown> }).__furlpayKv?.clear();
  __resetGuardCacheForTests();
  deliver.mockReset().mockResolvedValue({ delivered: false, reason: "not_configured" });
  vi.stubEnv("SETTLEMENT_SAFETY_AUTOHALT", "enforce");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function haltedIncident(severity: "high" | "critical" = "critical") {
  const rec = await trip({ scope: SCOPE, signal: "manual_halt", severity, evidence: { reason: "test" }, actor: "op-a" });
  return rec.incidentId!;
}

describe("gate and detectors", () => {
  it("1. normal settlement passes every check", async () => {
    await expect(beforeBroadcast(ARB, deps(twoHealthy()))).resolves.toBeUndefined();
    expect((await readScope(SCOPE)).state).toBe("NORMAL");
  });

  it("2. a wrong chain id refuses the request and halts the network", async () => {
    await expect(beforeBroadcast(ARB, deps([obs({ provider: 0, chainId: 1 })]))).rejects.toBeInstanceOf(SettlementHaltedError);
    const rec = await readScope(SCOPE);
    expect(rec.state).toBe("HALTED");
    expect(rec.signal).toBe("chain_id_mismatch");
    expect(rec.evidence).toMatchObject({ expected: 42161, reported: 1 });
  });

  it("3. providers disagreeing on the block hash at one height halts", async () => {
    const split = [obs({ provider: 0 }), obs({ provider: 1, atHeight: { number: 995n, hash: `0x${"c".repeat(64)}` as Hex } })];
    await expect(beforeBroadcast(ARB, deps(split))).rejects.toThrow(/rpc_hash_disagreement/);
    expect((await readScope(SCOPE)).state).toBe("HALTED");
  });

  it("4. a stale head refuses and marks the network DEGRADED (not HALTED)", async () => {
    const stale = twoHealthy().map((o) => ({ ...o, head: { ...o.head!, timestamp: BigInt(Math.floor(NOW / 1000) - 600) } }));
    await expect(beforeBroadcast(ARB, deps(stale))).rejects.toThrow(/head_stale/);
    expect((await readScope(SCOPE)).state).toBe("DEGRADED");
  });

  it("all providers down is 'cannot verify', which refuses", async () => {
    const down = [{ provider: 0, ok: false, error: "TimeoutError" }];
    await expect(beforeBroadcast(ARB, deps(down))).rejects.toThrow(/rpc_unavailable/);
  });

  it("a single provider is reported as unverified, not as agreement", () => {
    const f = evaluateChainHealth(ARB, [obs({ provider: 0 })], Math.floor(NOW / 1000));
    expect(f.map((x) => x.signal)).toEqual(["rpc_unverified"]);
    expect(f[0].action).toBe("report");
  });

  it("shadow mode records the would-be trip but does not halt", async () => {
    vi.stubEnv("SETTLEMENT_SAFETY_AUTOHALT", "");
    await expect(beforeBroadcast(ARB, deps([obs({ provider: 0, chainId: 1 })]))).rejects.toThrow();
    expect((await readScope(SCOPE)).state).toBe("NORMAL");
    expect((await transitionHistory(5))[0].signal).toBe("shadow:chain_id_mismatch");
  });

  it("20. an unreadable control plane refuses settlement", async () => {
    vi.spyOn(kv, "kvGet").mockRejectedValue(new Error("kv redis error: 403"));
    await expect(assertSettlementAllowed(ARB)).rejects.toMatchObject({ scope: "control_plane" });
  });

  it("the ops console's global pause stops the settler; a rail pause does not reach it", async () => {
    const { setGlobalPause, setRailPause } = await import("@/lib/ops/controls");
    await setRailPause("x402", true, "op", "rail only");
    await expect(beforeBroadcast(ARB, deps(twoHealthy()))).resolves.toBeUndefined();
    await setGlobalPause(true, "op", "incident drill");
    await expect(beforeBroadcast(ARB, deps(twoHealthy()))).rejects.toThrow(/ops global pause/);
  });

  it("a global halt stops every network; a network halt stops only its own", async () => {
    await trip({ scope: networkScope("base"), signal: "manual_halt", severity: "high", evidence: {}, actor: "op" });
    await expect(assertSettlementAllowed(ARB)).resolves.toBeUndefined();
    await expect(assertSettlementAllowed("base")).rejects.toBeInstanceOf(SettlementHaltedError);
    await trip({ scope: "global", signal: "manual_halt", severity: "critical", evidence: {}, actor: "op" });
    await expect(assertSettlementAllowed(ARB)).rejects.toMatchObject({ scope: "global" });
  });
});

describe("halt durability and races", () => {
  it("10/11. a halt raised mid-flight stops the next submission and any queued retry", async () => {
    await beforeBroadcast(ARB, deps(twoHealthy())); // worker A passes
    await trip({ scope: SCOPE, signal: "manual_halt", severity: "critical", evidence: {}, actor: "op" });
    // Health is cached as good — the durable gate must still refuse.
    await expect(beforeBroadcast(ARB, deps(twoHealthy()))).rejects.toBeInstanceOf(SettlementHaltedError);
    await expect(beforeBroadcast(ARB, deps(twoHealthy()))).rejects.toBeInstanceOf(SettlementHaltedError);
  });

  it("12. a restart keeps the halt (state is in the store, not the process)", async () => {
    await haltedIncident();
    vi.resetModules();
    const fresh = await import("@/lib/settlementSafety");
    await expect(fresh.assertSettlementAllowed(ARB)).rejects.toThrow(/HALTED/);
  });

  it("13. NORMAL written at an old epoch is a halt (resume raced a trip)", async () => {
    await kv.kvSet(`settle:safety:state:${SCOPE}`, { scope: SCOPE, state: "NORMAL", epoch: 1, since: "", actor: "x", policyVersion: "p" });
    await kv.kvSet(`settle:safety:epoch:${SCOPE}`, 2);
    expect((await readScope(SCOPE)).state).toBe("HALTED");
    await expect(assertSettlementAllowed(ARB)).rejects.toThrow(/epoch_fence/);
  });

  it("13. a final approval racing a new trip never leaves the scope open", async () => {
    vi.stubEnv("SETTLEMENT_RECOVERY_MIN_APPROVERS", "");
    const id = await haltedIncident("high");
    await markMitigated(SCOPE, "op-a", "rpc provider rotated and verified", HEALTHY, id);
    await Promise.all([
      approveRecovery(SCOPE, "op-b", "reviewed probe output", HEALTHY, id),
      trip({ scope: SCOPE, signal: "rpc_hash_disagreement", severity: "critical", evidence: {}, actor: "system:x" }),
    ]);
    await expect(assertSettlementAllowed(ARB)).rejects.toBeInstanceOf(SettlementHaltedError);
  });

  it("19. a failing alert sink does not undo the halt", async () => {
    deliver.mockRejectedValue(new Error("pager down"));
    await haltedIncident();
    await expect(assertSettlementAllowed(ARB)).rejects.toBeInstanceOf(SettlementHaltedError);
    expect(deliver).toHaveBeenCalledOnce();
  });

  it("a DEGRADED signal never downgrades an existing halt", async () => {
    await haltedIncident();
    await trip({ scope: SCOPE, signal: "head_stale", severity: "high", evidence: {}, actor: "system:x", to: "DEGRADED" });
    expect((await readScope(SCOPE)).state).toBe("HALTED");
  });
});

describe("recovery", () => {
  it("cannot resume straight from HALTED; mitigation needs passing checks", async () => {
    const id = await haltedIncident();
    expect((await approveRecovery(SCOPE, "op-b", "looked at it", HEALTHY, id)).ok).toBe(false);
    const r = await markMitigated(SCOPE, "op-a", "notes long enough here", { healthy: false, unresolvedSettlements: 0 }, id);
    expect(r).toMatchObject({ ok: false, code: "checks_failing" });
  });

  it("15. a critical incident needs two distinct approvers, one other than the mitigator", async () => {
    const id = await haltedIncident("critical");
    await markMitigated(SCOPE, "op-a", "rotated provider and verified heads", HEALTHY, id);
    expect(await approveRecovery(SCOPE, "op-a", "reviewed evidence", HEALTHY, id)).toMatchObject({ ok: false, code: "awaiting_approvals" });
    // The same approver again still counts once.
    expect(await approveRecovery(SCOPE, "op-a", "reviewed evidence", HEALTHY, id)).toMatchObject({ ok: false, code: "awaiting_approvals" });
    await expect(assertSettlementAllowed(ARB)).rejects.toThrow(/RECOVERY_PENDING/);
    expect((await approveRecovery(SCOPE, "op-b", "independent review", HEALTHY, id)).ok).toBe(true);
    await expect(assertSettlementAllowed(ARB)).resolves.toBeUndefined();
  });

  it("the approver floor can be raised by env but never lowered", () => {
    expect(requiredApprovals("critical", { SETTLEMENT_RECOVERY_MIN_APPROVERS: "1" } as NodeJS.ProcessEnv)).toBe(2);
    expect(requiredApprovals("high", { SETTLEMENT_RECOVERY_MIN_APPROVERS: "3" } as NodeJS.ProcessEnv)).toBe(3);
    expect(requiredApprovals(undefined, {} as NodeJS.ProcessEnv)).toBe(2);
  });

  it("16. an expired approval no longer counts", async () => {
    const id = await haltedIncident("critical");
    await markMitigated(SCOPE, "op-a", "rotated provider and verified heads", HEALTHY, id);
    const t0 = Date.now();
    await approveRecovery(SCOPE, "op-b", "reviewed evidence", HEALTHY, id, t0);
    const late = await approveRecovery(SCOPE, "op-c", "reviewed evidence", HEALTHY, id, t0 + 31 * 60_000);
    expect(late).toMatchObject({ ok: false, code: "awaiting_approvals" });
  });

  it("16/18. approvals for an old incident are dead after a new anomaly", async () => {
    const id = await haltedIncident("critical");
    await markMitigated(SCOPE, "op-a", "rotated provider and verified heads", HEALTHY, id);
    await approveRecovery(SCOPE, "op-b", "reviewed evidence", HEALTHY, id);
    await trip({ scope: SCOPE, signal: "receipt_mismatch", severity: "critical", evidence: {}, actor: "system:x" });
    const rec = await readScope(SCOPE);
    expect(rec.state).toBe("HALTED");
    expect(rec.approvals).toEqual([]);
    expect(await approveRecovery(SCOPE, "op-c", "reviewed evidence", HEALTHY, id)).toMatchObject({ ok: false });
  });

  it("17. a healthy dependency with unresolved settlements does not resume", async () => {
    const id = await haltedIncident("high");
    await markMitigated(SCOPE, "op-a", "rotated provider and verified heads", HEALTHY, id);
    const r = await approveRecovery(SCOPE, "op-b", "reviewed evidence", { healthy: true, unresolvedSettlements: 2 }, id);
    expect(r).toMatchObject({ ok: false, code: "unresolved_settlements" });
    await expect(assertSettlementAllowed(ARB)).rejects.toBeInstanceOf(SettlementHaltedError);
  });

  it("18. failing checks at final approval keep the scope halted", async () => {
    const id = await haltedIncident("high");
    await markMitigated(SCOPE, "op-a", "rotated provider and verified heads", HEALTHY, id);
    const r = await approveRecovery(SCOPE, "op-b", "reviewed evidence", { healthy: false, unresolvedSettlements: 0 }, id);
    expect(r).toMatchObject({ ok: false, code: "checks_failing" });
  });
});

// --- receipts and reconciliation -------------------------------------------

const TOKEN = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const FROM = "0x1111111111111111111111111111111111111111";
const TO = "0x2222222222222222222222222222222222222222";
const NONCE = `0x${"9".repeat(64)}` as Hex;
const EVENTS = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)",
]);
function transferLog(to: string, value: bigint, address = TOKEN): Log {
  return {
    address: address as Hex,
    topics: encodeEventTopics({ abi: EVENTS, eventName: "Transfer", args: { from: FROM, to: to as Hex } }) as [Hex, ...Hex[]],
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
  } as unknown as Log;
}
function usedLog(): Log {
  return {
    address: TOKEN as Hex,
    topics: encodeEventTopics({ abi: EVENTS, eventName: "AuthorizationUsed", args: { authorizer: FROM, nonce: NONCE } }) as [Hex, ...Hex[]],
    data: "0x",
  } as unknown as Log;
}
const expected = { token: TOKEN, from: FROM, to: TO, value: 1_000_000n, nonce: NONCE };

describe("receipt verification", () => {
  it("accepts exactly the authorized transfer", () => {
    expect(verifySettlementReceipt([transferLog(TO, 1_000_000n), usedLog()], expected)).toBeNull();
  });

  it("8. rejects a different recipient, amount, a missing nonce event, or a second transfer", () => {
    expect(verifySettlementReceipt([transferLog(FROM, 1_000_000n), usedLog()], expected)?.signal).toBe("receipt_mismatch");
    expect(verifySettlementReceipt([transferLog(TO, 999_999n), usedLog()], expected)).not.toBeNull();
    expect(verifySettlementReceipt([transferLog(TO, 1_000_000n)], expected)).not.toBeNull();
    expect(verifySettlementReceipt([transferLog(TO, 1_000_000n), transferLog(TO, 1n), usedLog()], expected)).not.toBeNull();
    // A Transfer emitted by some other contract does not count.
    expect(verifySettlementReceipt([transferLog(TO, 1_000_000n, FROM), usedLog()], expected)).not.toBeNull();
  });

  it("8. the settler converts a post-broadcast refusal into SettlementPendingError", () => {
    // Every settler caller records SettlementPendingError as PENDING with the
    // hash; a plain error would let three of the four drop the transaction.
    const src = readFileSync(new URL("../x402Settler.ts", import.meta.url), "utf8");
    expect(src).toMatch(/await afterReceipt\([\s\S]*?\} catch \(e\) \{\s*throw new SettlementPendingError\(landed/);
    expect(src.indexOf("await beforeBroadcast(network)")).toBeLessThan(src.indexOf("walletClient.writeContract("));
  });

  it("8. a mismatched receipt halts the network and carries the tx (never reported settled)", async () => {
    const tx = `0x${"e".repeat(64)}`;
    await expect(afterReceipt(ARB, [transferLog(FROM, 5n)], expected, tx)).rejects.toMatchObject({ transaction: tx });
    expect((await readScope(SCOPE)).signal).toBe("receipt_mismatch");
  });
});

describe("reconciliation", () => {
  const base = {
    network: ARB,
    payer: FROM,
    payTo: TO,
    amountAtomic: "1000000",
    expectedTransfer: { token: TOKEN, from: FROM, to: TO, valueAtomic: "1000000", nonce: NONCE },
    resource: "https://r.example/x",
  };
  const txA = `0x${"a1".repeat(32)}`;
  const txB = `0x${"b2".repeat(32)}`;

  it("5. pending without enough confirmations stays unresolved; with them it confirms", async () => {
    await recordSettlement({ ...base, transaction: txA, settledAt: new Date().toISOString(), status: "pending" });
    let r = await reconcileNetwork(ARB, async () => ({ found: true, confirmed: true, confirmations: 0, receiptVerified: true }));
    expect(r.stillPending).toEqual([txA]);
    r = await reconcileNetwork(ARB, async () => ({ found: true, confirmed: true, confirmations: 100, receiptVerified: true }));
    expect(r.confirmed).toEqual([txA]);
    expect(await unresolvedSettlements(ARB)).toEqual([]);
  });

  it("an RPC error is never assumed to be success or failure", async () => {
    await recordSettlement({ ...base, transaction: txA, settledAt: new Date().toISOString(), status: "pending" });
    const r = await reconcileNetwork(ARB, async () => {
      throw new Error("rpc down");
    });
    expect(r).toMatchObject({ errors: 1, stillPending: [txA], confirmed: [], abandoned: [] });
    expect((await getSettlement(txA))?.status).toBe("pending");
  });

  it.each([false, undefined])("never promotes a successful receipt without explicit verification (%s)", async (receiptVerified) => {
    await recordSettlement({ ...base, transaction: txA, settledAt: new Date().toISOString(), status: "pending" });
    const r = await reconcileNetwork(ARB, async () => ({
      found: true,
      confirmed: true,
      confirmations: 100,
      receiptVerified,
    }));
    expect(r.confirmed).toEqual([]);
    expect(r.abandoned).toEqual([txA]);
    expect((await getSettlement(txA))?.status).toBe("abandoned");
  });

  it("6. a confirmed settlement that vanished is a reorg: the network halts, the record is kept", async () => {
    await recordSettlement({ ...base, transaction: txB, settledAt: new Date().toISOString(), status: "confirmed" });
    const r = await reconcileNetwork(ARB, async () => ({ found: false, confirmed: false, confirmations: 0 }));
    expect(r.reorged).toEqual([txB]);
    expect(r.tripped).toBe(true);
    expect((await readScope(SCOPE)).signal).toBe("settlement_reorged");
    expect((await getSettlement(txB))?.status).toBe("confirmed");
  });

  it("is idempotent: a second pass over the same state changes nothing", async () => {
    await recordSettlement({ ...base, transaction: txA, settledAt: new Date().toISOString(), status: "pending" });
    const check = async () => ({ found: false, confirmed: false, confirmations: 0 });
    const a = await reconcileNetwork(ARB, check);
    const b = await reconcileNetwork(ARB, check);
    expect(b).toEqual(a);
  });
});
