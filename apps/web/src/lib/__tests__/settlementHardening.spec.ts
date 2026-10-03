import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";

// ---------------------------------------------------------------------------
// Second-round settlement hardening (findings FP-SET-07, -08, -10, -11 and the
// scheduled sweep). Each block names the finding it pins.
// ---------------------------------------------------------------------------

vi.mock("@/lib/ops/alertSink", () => ({ deliverSecurityAlert: vi.fn().mockResolvedValue({ delivered: false, reason: "not_configured" }) }));

import { claimStepUp, recordStepUp } from "@/lib/stepup";
import { networkScope, readScope, trip } from "@/lib/settlementSafety";
import {
  checkNetworkTokens,
  evaluateToken,
  PINNED_TOKENS,
  type PinnedToken,
  type TokenObservation,
} from "@/lib/settlementTokenMonitor";
import { runSettlementSweep, sweepNetwork, type SweepDeps } from "@/lib/settlementSweep";
import { settlementAssetsFor, settlementNetworks as assetNetworks } from "@/lib/x402Assets";
import { EVM_CHAINS } from "@/lib/x402Chains";
import { recordSettlement, unresolvedSettlements } from "@/lib/x402SettlementStore";
import type { ProviderObservation } from "@/lib/settlementDetectors";

const NOW = 1_800_000_000_000;
const ARB = "arbitrum";
const SCOPE = networkScope(ARB);

beforeEach(() => {
  (globalThis as unknown as { __furlpayKv?: Map<string, unknown> }).__furlpayKv?.clear();
  vi.stubEnv("SETTLEMENT_SAFETY_AUTOHALT", "enforce");
});
afterEach(() => vi.unstubAllEnvs());

const clean = (t: PinnedToken): TokenObservation => ({ implementation: t.implementation, admin: t.admin, owner: t.owner, paused: false });
const healthyProbe = async (): Promise<ProviderObservation[]> => [
  { provider: 0, ok: true, chainId: 42161, head: { number: 10n, hash: `0x${"a".repeat(64)}` as Hex, timestamp: BigInt(NOW / 1000 - 1) } },
];
const deps = (over: Partial<SweepDeps> = {}): SweepDeps => ({
  probe: healthyProbe,
  readToken: async (t) => clean(t),
  chainCheck: async () => ({ found: true, confirmed: true, confirmations: 100 }),
  now: () => NOW,
  ...over,
});

describe("FP-SET-07: settlement-token integrity", () => {
  const usdc = PINNED_TOKENS.find((t) => t.network === ARB && t.symbol === "USDC")!;

  it("every mainnet settlement asset the settler accepts has a pin", () => {
    // Adding an asset to the allowlist without pinning it would leave it
    // unmonitored; this makes that a test failure.
    for (const network of assetNetworks()) {
      if (EVM_CHAINS[network]?.testnet) continue;
      for (const a of settlementAssetsFor(network)) {
        const pinned = PINNED_TOKENS.some((p) => p.network === network && p.address.toLowerCase() === a.address.toLowerCase());
        expect(pinned, `${network} ${a.symbol} ${a.address} has no integrity pin`).toBe(true);
      }
    }
  });

  it("matching observations produce no findings", () => {
    expect(evaluateToken(usdc, clean(usdc))).toEqual([]);
  });

  it("implementation or proxy-admin change halts (critical); owner change halts (high)", () => {
    const other = "0x000000000000000000000000000000000000dEaD";
    expect(evaluateToken(usdc, { ...clean(usdc), implementation: other })[0]).toMatchObject({ signal: "token_implementation_changed", action: "halt", severity: "critical" });
    expect(evaluateToken(usdc, { ...clean(usdc), admin: other })[0]).toMatchObject({ signal: "token_admin_changed", action: "halt", severity: "critical" });
    expect(evaluateToken(usdc, { ...clean(usdc), owner: other })[0]).toMatchObject({ signal: "token_owner_changed", action: "halt", severity: "high" });
  });

  it("address comparison is case-insensitive (checksum vs lowercase is not a change)", () => {
    expect(evaluateToken(usdc, { ...clean(usdc), implementation: usdc.implementation.toLowerCase() })).toEqual([]);
  });

  it("paused degrades; an unreadable field degrades rather than passing", () => {
    expect(evaluateToken(usdc, { ...clean(usdc), paused: true })[0]).toMatchObject({ signal: "token_paused", action: "degrade" });
    const f = evaluateToken(usdc, { ...clean(usdc), owner: null });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ signal: "token_monitor_unavailable", action: "degrade" });
  });

  it("checks every pinned token on the network (USDC and XSGD on arbitrum)", async () => {
    const seen: string[] = [];
    await checkNetworkTokens(ARB, async (t) => (seen.push(t.symbol), clean(t)));
    expect(seen.sort()).toEqual(["USDC", "XSGD"]);
  });
});

describe("RPC independence", () => {
  it("two URLs on one provider's domain are reported as not independent, without echoing URLs", async () => {
    const { evaluateRpcIndependence } = await import("@/lib/settlementDetectors");
    const f = evaluateRpcIndependence(ARB, ["https://arb-mainnet.g.alchemy.com/v2/SECRETKEY1", "https://arb-mainnet.alchemy.com/v2/SECRETKEY2"]);
    expect(f?.signal).toBe("rpc_not_independent");
    expect(f?.action).toBe("report");
    expect(JSON.stringify(f)).not.toContain("SECRETKEY");
  });

  it("different providers pass; one provider is not judged here", async () => {
    const { evaluateRpcIndependence } = await import("@/lib/settlementDetectors");
    expect(evaluateRpcIndependence(ARB, ["https://arb1.arbitrum.io/rpc", "https://arbitrum-mainnet.infura.io/v3/x"])).toBeNull();
    expect(evaluateRpcIndependence(ARB, ["https://arb1.arbitrum.io/rpc"])).toBeNull();
  });
});

describe("scheduled sweep", () => {
  it("a clean pass clears DEGRADED (and only DEGRADED)", async () => {
    await trip({ scope: SCOPE, signal: "head_stale", severity: "high", evidence: {}, actor: "system:x", to: "DEGRADED" });
    const r = await sweepNetwork(ARB, deps());
    expect(r).toMatchObject({ cleared: true, state: "NORMAL" });
  });

  it("never clears HALTED", async () => {
    await trip({ scope: SCOPE, signal: "manual_halt", severity: "critical", evidence: {}, actor: "op" });
    const r = await sweepNetwork(ARB, deps());
    expect(r).toMatchObject({ cleared: false, state: "HALTED" });
  });

  it("a token implementation change found by the sweep halts the network", async () => {
    const r = await sweepNetwork(ARB, deps({
      readToken: async (t) => (t.symbol === "USDC" ? { ...clean(t), implementation: "0x000000000000000000000000000000000000dEaD" } : clean(t)),
    }));
    expect(r.findings).toContain("token_implementation_changed");
    expect((await readScope(SCOPE)).state).toBe("HALTED");
  });

  it("shadow mode: the sweep records but does not halt", async () => {
    vi.stubEnv("SETTLEMENT_SAFETY_AUTOHALT", "");
    await sweepNetwork(ARB, deps({ readToken: async (t) => ({ ...clean(t), admin: "0x000000000000000000000000000000000000dEaD" }) }));
    expect((await readScope(SCOPE)).state).toBe("NORMAL");
  });

  it("reconciles pending settlements as part of the pass and reports what is still unresolved", async () => {
    const base = { network: ARB, payer: "0x1", payTo: "0x2", amountAtomic: "1000000", resource: "r", settledAt: new Date(NOW).toISOString() };
    await recordSettlement({ ...base, transaction: `0x${"1".repeat(64)}`, status: "pending" });
    await recordSettlement({ ...base, transaction: `0x${"2".repeat(64)}`, status: "pending" });
    const r = await sweepNetwork(ARB, deps({
      chainCheck: async (tx) => (tx.startsWith("0x1") ? { found: true, confirmed: true, confirmations: 100 } : { found: false, confirmed: false, confirmations: 0 }),
    }));
    expect(r.unresolved).toBe(1);
    expect(await unresolvedSettlements(ARB)).toEqual([`0x${"2".repeat(64)}`]);
  });

  it("stops at the budget instead of overrunning", async () => {
    const out = await runSettlementSweep(() => true, deps());
    expect(out.results).toEqual([]);
    expect(out.skipped.length).toBeGreaterThan(0);
  });
});

describe("FP-SET-10: step-up claims are single-use under concurrency", () => {
  it("exactly one of several concurrent claims wins one step-up", async () => {
    await recordStepUp("op-1", "jti-1", "passkey");
    const results = await Promise.all([1, 2, 3, 4].map(() => claimStepUp("op-1", "jti-1")));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await claimStepUp("op-1", "jti-1")).toBe(false);
  });

  it("no step-up, or another session's step-up, claims nothing", async () => {
    await recordStepUp("op-1", "jti-1", "otp");
    expect(await claimStepUp("op-1", "jti-2")).toBe(false);
    expect(await claimStepUp("op-1", undefined)).toBe(false);
  });

  it("an expired step-up claims nothing", async () => {
    await recordStepUp("op-1", "jti-1", "otp");
    expect(await claimStepUp("op-1", "jti-1", -1)).toBe(false);
  });
});
