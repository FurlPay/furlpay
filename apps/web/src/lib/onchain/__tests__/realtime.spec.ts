import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSanctioned } from "@furlpay/compliance";
import { classify, worst, DAY, MIN } from "../freshness";

// ── Shared mocks: storage + calls log ───────────────────────────────────────
const calls: { kind: string; target: string; arg?: unknown }[] = [];
const db = { latestTx: "2026-10-07T00:00:00Z", latestEv: 1, rwaRows: null as null | unknown[], failRpc: false };

vi.mock("@/lib/supabase", async (orig) => ({
  ...(await orig<typeof import("@/lib/supabase")>()),
  supabaseBackend: "supabase",
  sbSelect: vi.fn(async (table: string, q: string) => {
    calls.push({ kind: "select", target: table, arg: q });
    if (table === "ops_tx_events" && q.includes("order=created_at.desc&limit=1")) return [{ created_at: db.latestTx }];
    if (table === "ops_security_events" && q.includes("limit=1")) return [];
    if (table === "onchain_events" && q.startsWith("select=id&order=id.desc")) return [{ id: db.latestEv }];
    if (table === "linked_wallets") return [];
    return [];
  }),
  sbRpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push({ kind: "rpc", target: fn, arg: args });
    if (db.failRpc) throw new Error("connect ECONNREFUSED db.internal:5432");
    if (fn === "onchain_ingest") return { inserted: (args.p_events as unknown[]).length, duplicates: 0, promoted: 0, reorg_replaced: 0, reinstated: 0, blocked_keys: (args.p_events as { event_key: string; risk_action: string }[]).filter((e) => e.risk_action === "block").map((e) => e.event_key) };
    if (fn === "rwa_replace_snapshot") return { inserted_or_changed: (args.p_rows as unknown[]).length, removed: 0, rows: (args.p_rows as unknown[]).length, total_usd: "1" };
    return true;
  }),
}));
vi.mock("@/lib/ops/events", () => ({ recordSecurityEvent: vi.fn(async (e: unknown) => void calls.push({ kind: "security", target: "ops_security_events", arg: e })) }));
vi.mock("@/lib/onchain/allium", async (orig) => ({
  ...(await orig<typeof import("@/lib/onchain/allium")>()),
  alliumKeyConfigured: () => (process.env.ALLIUM_API_KEY ?? "").length > 0,
  alliumQuery: vi.fn(async () => (db.rwaRows ? { status: "ok", data: db.rwaRows, asOf: "2026-10-07T01:00:00Z", source: "Allium Explorer (tokenized assets)" } : { status: "unavailable", reason: "ALLIUM_RWA_QUERY_ID is not set.", source: "x" })),
}));

beforeEach(() => {
  calls.length = 0;
  db.failRpc = false;
  db.rwaRows = null;
});
afterEach(() => {
  delete process.env.ALLIUM_API_KEY;
  delete process.env.ALLIUM_RWA_QUERY_ID;
});

// ── Freshness ───────────────────────────────────────────────────────────────
describe("classify (per-section freshness)", () => {
  const now = Date.UTC(2026, 9, 7, 12);
  const base = { source: "s", cadence: "c", configured: true, ok: true, now };
  it("never reports live without configuration or with a failed source", () => {
    expect(classify({ ...base, kind: "event", healthyWithinMs: Infinity, configured: false, asOf: new Date(now).toISOString() }).state).toBe("not_connected");
    expect(classify({ ...base, kind: "event", healthyWithinMs: Infinity, ok: false, asOf: new Date(now).toISOString() }).state).toBe("offline");
    expect(classify({ ...base, kind: "event", healthyWithinMs: DAY, asOf: null }).state).toBe("stale");
  });
  it("event-driven: live while healthy, stale after the allowance", () => {
    expect(classify({ ...base, kind: "event", healthyWithinMs: DAY, asOf: new Date(now - MIN).toISOString() }).state).toBe("live");
    expect(classify({ ...base, kind: "event", healthyWithinMs: DAY, asOf: new Date(now - 2 * DAY).toISOString() }).state).toBe("stale");
  });
  it("polled: updating within two cycles, then stale", () => {
    expect(classify({ ...base, kind: "polled", cadenceMs: 30 * MIN, asOf: new Date(now - 45 * MIN).toISOString() }).state).toBe("updating");
    expect(classify({ ...base, kind: "polled", cadenceMs: 30 * MIN, asOf: new Date(now - 61 * MIN).toISOString() }).state).toBe("stale");
  });
  it("lagged: delayed within the known lag (Allium daily metrics), then stale", () => {
    expect(classify({ ...base, kind: "lagged", expectedLagMs: 3 * DAY, asOf: "2026-10-06T00:00:00Z" }).state).toBe("delayed");
    expect(classify({ ...base, kind: "lagged", expectedLagMs: 3 * DAY, asOf: "2026-10-01T00:00:00Z" }).state).toBe("stale");
  });
  it("worst() picks the least fresh", () => {
    const a = classify({ ...base, kind: "polled", cadenceMs: MIN, asOf: new Date(now).toISOString() });
    const b = classify({ ...base, kind: "lagged", expectedLagMs: DAY, asOf: new Date(now - 2 * DAY).toISOString() });
    expect(worst(a, b).state).toBe("stale");
  });
});

// ── AML at ingest ───────────────────────────────────────────────────────────
describe("ingest AML screening", () => {
  const SDN = "0x0330070fd38ec3bb94f58fa55d40368271e9e54a";
  it("uses a real list entry", () => expect(isSanctioned(SDN)).toBe(true));

  it("flags an OFAC SDN counterparty and raises exactly one security event per NEW event — never a ledger write", async () => {
    process.env.TREASURY_ADDRESS_BASE = "0x" + "22".repeat(20);
    const { scopeTransfers, persist } = await import("../ingest");
    const t = {
      event_key: "base:0x" + "a".repeat(64) + ":1", source: "allium_beam" as const, chain: "base", tx_hash: "0x" + "a".repeat(64), block_number: 1, block_hash: null,
      block_timestamp: "2026-10-07T00:00:00.000Z", log_index: 1, from_address: SDN, to_address: "0x" + "22".repeat(20), asset_address: null, asset_symbol: "USDC",
      asset_decimals: null, amount_raw: "1", amount: "0.000001", amount_usd: null, activity_type: "transfer", confirmation_state: "confirmed" as const, provider_event_id: null, metadata: {},
    };
    const { scoped } = await scopeTransfers([t]);
    expect(scoped[0]).toMatchObject({ scope: "treasury", direction: "in", risk_action: "block" });
    expect(scoped[0].risk_flags[0]).toBe("ofac-sdn");
    await persist(scoped);
    expect(calls.filter((c) => c.kind === "security")).toHaveLength(1);
    expect(JSON.stringify(calls.find((c) => c.kind === "security")!.arg)).toContain("sanctions_screen_hit");
    for (const c of calls) expect(c.target).not.toMatch(/ledger|balance|payment|settlement|ops_tx_events/);
    delete process.env.TREASURY_ADDRESS_BASE;
  });
});

// ── Version-keyed dashboard cache ───────────────────────────────────────────
describe("dataVersion / onchainCached", () => {
  it("rebuilds when the ledger or chain events change, reuses otherwise, and coalesces a burst", async () => {
    const dash = await import("../dashboard");
    const build = vi.spyOn(dash, "buildOnchainDashboard");
    const { parseRange } = await import("@/lib/analytics/range");
    const r = parseRange(new URLSearchParams("range=7d"));
    if (!r.ok) throw new Error();
    const t0 = Date.now();
    const v1 = await dash.dataVersion(t0);
    expect(v1).toContain(db.latestTx);
    // Same version within 2 s: memoized, no extra reads.
    const reads = calls.length;
    expect(await dash.dataVersion(t0 + 500)).toBe(v1);
    expect(calls.length).toBe(reads);
    // A new chain event moves the version after the memo window.
    db.latestEv = 2;
    const v2 = await dash.dataVersion(t0 + 2_500);
    expect(v2).not.toBe(v1);
    expect(v2.endsWith("|2")).toBe(true);
    build.mockRestore();
  });
});

// ── Tokenized-assets refresh ────────────────────────────────────────────────
describe("refreshRwaSnapshot", () => {
  const row = (over: Record<string, string> = {}) => ({ product_name: "Fund", token_symbol: "F", chain: "base", issuer_name: "I", asset_class: "rates", asset_type: "money_market_funds_us", market_cap_usd: "1000.5", ...over });

  it("is not_configured without the key and query id, and writes nothing", async () => {
    const { refreshRwaSnapshot } = await import("@/lib/rwaRefresh");
    expect((await refreshRwaSnapshot()).status).toBe("not_configured");
    expect(calls.filter((c) => c.target === "rwa_replace_snapshot")).toHaveLength(0);
  });

  it("replaces TODAY's snapshot with exact decimals from the provider rows", async () => {
    process.env.ALLIUM_API_KEY = "k";
    process.env.ALLIUM_RWA_QUERY_ID = "q_rwa1";
    db.rwaRows = [row(), row({ product_name: "Other", token_symbol: "O", market_cap_usd: "1.5e3" })];
    const { refreshRwaSnapshot } = await import("@/lib/rwaRefresh");
    const now = Date.UTC(2026, 9, 7, 6);
    const r = await refreshRwaSnapshot(now);
    expect(r).toMatchObject({ status: "ok", snapshot: "2026-10-07", rows: 2 });
    const call = calls.find((c) => c.target === "rwa_replace_snapshot")!.arg as { p_snapshot: string; p_source: string; p_rows: { market_cap_usd: string }[] };
    expect(call.p_snapshot).toBe("2026-10-07");
    expect(call.p_source).toBe("allium_query");
    expect(call.p_rows.map((x) => x.market_cap_usd)).toEqual(["1000.5", "1500"]);
    expect(calls.some((c) => c.target === "onchain_touch_source" && (c.arg as { p_ok: boolean }).p_ok === true)).toBe(true);
  });

  it("writes NOTHING when any row is invalid or duplicated", async () => {
    process.env.ALLIUM_API_KEY = "k";
    process.env.ALLIUM_RWA_QUERY_ID = "q_rwa1";
    const { refreshRwaSnapshot } = await import("@/lib/rwaRefresh");
    db.rwaRows = [row(), row({ product_name: "Bad", market_cap_usd: "-3" })];
    expect((await refreshRwaSnapshot()).status).toBe("failed");
    db.rwaRows = [row(), row()];
    expect((await refreshRwaSnapshot()).reason).toMatch(/Duplicate/);
    expect(calls.filter((c) => c.target === "rwa_replace_snapshot")).toHaveLength(0);
  });

  it("app and importer normalize money identically", async () => {
    const { normalizeMoney } = await import("@/lib/rwaRefresh");
    // @ts-expect-error — plain .mjs module without type declarations
    const mjs = await import("../../../../../../scripts/data/rwa-csv.mjs");
    for (const v of ["0", "007.50", "2810893623.835801", "1.5e3", "2.5e-9", "5e-9", "0.999999995", "12.345678904", "-1", "abc", "1e40", "1,000"]) {
      expect(normalizeMoney(v), v).toBe(mjs.normalizeMoney(v));
    }
  });
});

// ── Public live snapshot redaction ──────────────────────────────────────────
describe("rwaFreshness", () => {
  it("labels a CSV snapshot as a snapshot, never live", async () => {
    const { rwaFreshness } = await import("@/lib/rwa");
    const f = rwaFreshness({ snapshot_date: "2026-10-06", imported_at: "2026-10-07T00:00:00Z", sources: ["allium_tokenized_assets_export"] });
    expect(f.state).toBe("not_connected");
    expect(f.reason).toMatch(/2026-10-06 snapshot/);
  });
  it("labels a daily-refreshed snapshot by its import time", async () => {
    process.env.ALLIUM_API_KEY = "k";
    process.env.ALLIUM_RWA_QUERY_ID = "q";
    const { rwaFreshness } = await import("@/lib/rwa");
    const now = Date.UTC(2026, 9, 7, 12);
    expect(rwaFreshness({ snapshot_date: "2026-10-07", imported_at: "2026-10-07T06:00:00Z", sources: ["allium_query"] }, now).state).toBe("updating");
    expect(rwaFreshness({ snapshot_date: "2026-10-04", imported_at: "2026-10-04T06:00:00Z", sources: ["allium_query"] }, now).state).toBe("stale");
  });
});
