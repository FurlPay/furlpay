import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The production (Supabase) path of the dashboard build, against a fake
// PostgREST that answers from fixed tables and records every query, so the
// arithmetic is checked on known data and every query string is inspectable.

const NOW = Date.parse("2026-10-01T12:00:00Z");
const DAY = 86_400_000;
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

type Row = Record<string, string | number | null>;
const tables: Record<string, Row[]> = {};
const queries: string[] = [];

// Minimal PostgREST filter evaluation for the operators the module uses.
function matches(row: Row, query: string): boolean {
  for (const part of query.split("&")) {
    const [k, raw] = part.split("=");
    if (!raw || ["select", "order", "limit"].includes(k)) continue;
    const v = decodeURIComponent(raw);
    const val = row[k];
    if (v.startsWith("eq.") && String(val) !== v.slice(3)) return false;
    if (v.startsWith("gte.") && !(String(val) >= v.slice(4))) return false;
    if (v.startsWith("lt.") && !(String(val) < v.slice(3))) return false;
    if (v === "not.is.null" && (val === null || val === undefined)) return false;
    if (v.startsWith("not.like.") && String(val).startsWith(v.slice(9).replace(/\*$/, ""))) return false;
  }
  return true;
}

// The RPC path. These mirror migration 0027's SQL semantics so the TypeScript
// side (bucketing, change, notes) is tested; the SQL itself is proven on real
// PostgreSQL by scripts/db/verify-analytics.mjs.
const rpcMode = { value: "sql" as "sql" | "missing" };
class SupabaseFunctionMissing extends Error {}
const inR = (t: unknown, a: Record<string, unknown>) => String(t) >= String(a.p_from) && String(t) < String(a.p_to);
const trunc = (t: string, unit: unknown) => (unit === "hour" ? `${t.slice(0, 13)}:00:00.000Z` : `${t.slice(0, 10)}T00:00:00.000Z`);
const RPC: Record<string, (a: Record<string, unknown>) => unknown[]> = {
  analytics_signup_cohort: (a) => {
    const by = new Map<string, Row[]>();
    for (const u of tables.users.filter((u) => inR(u.created_at, a))) {
      const k = trunc(String(u.created_at), a.p_unit);
      by.set(k, [...(by.get(k) ?? []), u]);
    }
    return [...by.entries()].map(([bucket, us]) => ({
      bucket,
      signups: us.length,
      kyc_started: us.filter((u) => u.kyc_status !== "unverified").length,
      kyc_verified: us.filter((u) => u.kyc_status === "verified").length,
      wallet_linked: us.filter((u) => (tables.linked_wallets ?? []).some((w) => w.user_id === u.id)).length,
      transacted: us.filter((u) => tables.ops_tx_events.some((t) => t.user_id === u.id && t.state === "settled" && String(t.created_at) >= String(u.created_at))).length,
    }));
  },
  analytics_active_users: (a) => {
    const rows = tables.audit_log.filter((x) => x.user_id && inR(x.created_at, a) && !String(x.action ?? "").startsWith("admin."));
    const by = new Map<string, Set<unknown>>();
    for (const x of rows) by.set(trunc(String(x.created_at), a.p_unit), (by.get(trunc(String(x.created_at), a.p_unit)) ?? new Set()).add(x.user_id));
    return [...[...by.entries()].map(([bucket, s]) => ({ bucket, users: s.size })), { bucket: null, users: new Set(rows.map((x) => x.user_id)).size }];
  },
  analytics_tx_buckets: (a) => {
    const by = new Map<string, { n: number; v: number; f: number }>();
    for (const t of tables.ops_tx_events.filter((t) => inR(t.created_at, a) && (!a.p_rail || t.rail === a.p_rail))) {
      const k = `${trunc(String(t.created_at), a.p_unit)}|${String(t.token).toUpperCase()}|${t.state}`;
      const e = by.get(k) ?? { n: 0, v: 0, f: 0 };
      by.set(k, { n: e.n + 1, v: e.v + Number(t.amount_usd), f: e.f + Number(t.fee_usd) });
    }
    return [...by.entries()].map(([k, e]) => { const [bucket, token, state] = k.split("|"); return { bucket, token, state, n: e.n, volume_usd: e.v, fee_usd: e.f }; });
  },
  analytics_rail_users: (a) => {
    const s = tables.ops_tx_events.filter((t) => t.state === "settled" && t.user_id && inR(t.created_at, a) && (!a.p_rail || t.rail === a.p_rail));
    const rails = [...new Set(s.map((t) => t.rail))];
    const all = new Set(s.map((t) => t.user_id)).size;
    return rails.map((rail) => ({ rail, users: new Set(s.filter((t) => t.rail === rail).map((t) => t.user_id)).size, all_users: all }));
  },
  analytics_signup_starts: () => [{ started: 0, completed: 0, first_event: null }],
};

vi.mock("@/lib/supabase", () => ({
  supabaseBackend: "supabase",
  SupabaseFunctionMissing,
  sbRpc: async (fn: string, args: Record<string, unknown>) => {
    queries.push(`rpc/${fn}`);
    if (rpcMode.value === "missing") throw new SupabaseFunctionMissing(fn);
    return RPC[fn](args);
  },
  sbCount: async (table: string, query = "") => {
    queries.push(`${table}?${query}`);
    return (tables[table] ?? []).filter((r) => matches(r, query)).length;
  },
  sbSelect: async (table: string, query = "") => {
    queries.push(`${table}?${query}`);
    const cols = /select=([^&]+)/.exec(query)?.[1].split(",") ?? [];
    let rows = (tables[table] ?? []).filter((r) => matches(r, query));
    if (/order=created_at\.desc/.test(query)) rows = [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const lim = Number(/limit=(\d+)/.exec(query)?.[1] ?? rows.length);
    return rows.slice(0, lim).map((r) => (cols.includes("*") ? r : Object.fromEntries(cols.map((c) => [c, r[c]]))));
  },
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  queries.length = 0;
  tables.users = [
    // Before the 7-day window: 2 users (one verified).
    { id: "u-old-1", created_at: at(20), kyc_status: "verified", email: "old1@example.com" },
    { id: "u-old-2", created_at: at(9), kyc_status: "unverified", email: "old2@example.com" },
    // Previous 7-day window: 2 signups, 1 now verified.
    { id: "u-prev-1", created_at: at(10), kyc_status: "verified", email: "p1@example.com" },
    // Inside the window: 4 signups: 2 verified, 1 pending, 1 unverified.
    { id: "u-new-1", created_at: at(6), kyc_status: "verified", email: "n1@example.com" },
    { id: "u-new-2", created_at: at(3), kyc_status: "verified", email: "n2@example.com" },
    { id: "u-new-3", created_at: at(2), kyc_status: "pending", email: "n3@example.com" },
    { id: "u-new-4", created_at: at(1), kyc_status: "unverified", email: "n4@example.com" },
  ];
  tables.audit_log = [
    { user_id: "u-new-1", action: "transfer", created_at: at(1) },
    { user_id: "u-new-1", action: "auth.login", created_at: at(1) },
    { user_id: "u-old-1", action: "auth.login", created_at: at(2) },
    { user_id: "u-old-1", action: "auth.login", created_at: at(8) }, // previous window
    { user_id: "u-new-3", action: "admin.read", created_at: at(1) }, // an operator, not product activity
    { user_id: null, action: "cron.run", created_at: at(1) },
  ];
  tables.linked_wallets = [{ user_id: "u-new-1", linked_at: at(1) }];
  tables.ops_tx_events = [
    { rail: "transfers", state: "settled", amount_usd: 100, fee_usd: 1, token: "USDC", user_id: "u-new-1", created_at: at(1) },
    { rail: "lifi", state: "settled", amount_usd: 50, fee_usd: 0.5, token: "ETH", user_id: "u-new-1", created_at: at(2) },
    { rail: "lifi", state: "settled", amount_usd: 20, fee_usd: 0.2, token: "ETH", user_id: "u-old-1", created_at: at(2) },
    { rail: "transfers", state: "failed", amount_usd: 999, fee_usd: 0, token: "USDC", user_id: "u-new-2", created_at: at(1) },
    { rail: "transfers", state: "settled", amount_usd: 40, fee_usd: 0.4, token: "USDC", user_id: "u-old-2", created_at: at(9) }, // previous window
  ];
  tables.ops_security_events = [];
});
afterEach(() => vi.useRealTimers());

async function build(product: "all" | "lifi" = "all") {
  const { parseRange } = await import("../range");
  const { buildDashboard } = await import("../dashboard");
  const r = parseRange(new URLSearchParams("range=7d"), NOW);
  if (!r.ok) throw new Error(r.error);
  return buildDashboard(r.range, product);
}

for (const mode of ["sql", "missing"] as const) {
  describe(`${mode === "sql" ? "SQL aggregation (0027)" : "row fallback (0027 not applied)"}`, () => {
    beforeEach(() => {
      rpcMode.value = mode;
    });

    it("users, signups, KYC, active users (admin.* and system actors excluded)", async () => {
      const k = (await build()).kpis;
      expect(k.totalUsers.status === "ok" && k.totalUsers.data.value).toBe(7);
      expect(k.totalUsers.status === "ok" && k.totalUsers.data.change).toBeCloseTo(4 / 3, 4); // 7 now vs 3 at start
      expect(k.newSignups.status === "ok" && k.newSignups.data.value).toBe(4);
      expect(k.newSignups.status === "ok" && k.newSignups.data.change).toBeCloseTo((4 - 2) / 2, 4);
      expect(k.kycCompleted.status === "ok" && k.kycCompleted.data.value).toBe(4); // all-time verified
      expect(k.activeUsers.status === "ok" && k.activeUsers.data.value).toBe(2); // u-new-1, u-old-1
    });

    it("transactions: settled only; volume, fees and change vs the previous window", async () => {
      const d = await build();
      expect(d.kpis.transactions.status === "ok" && d.kpis.transactions.data.value).toBe(3);
      expect(d.kpis.volume.status === "ok" && d.kpis.volume.data.value).toBe(170);
      expect(d.kpis.volume.status === "ok" && d.kpis.volume.data.change).toBeCloseTo((170 - 40) / 40, 4);
      expect(d.transactions.status === "ok" && d.transactions.data.fees).toBeCloseTo(1.7, 6);
      expect(d.transactions.status === "ok" && d.transactions.data.failed).toBe(1);
    });

    it("product filter narrows to one rail", async () => {
      const d = await build("lifi");
      expect(d.kpis.volume.status === "ok" && d.kpis.volume.data.value).toBe(70);
    });

    it("product usage: distinct settled users per rail", async () => {
      const d = await build();
      if (d.products.status !== "ok") throw new Error("products unavailable");
      expect(d.products.data.totalUsers).toBe(2);
      expect(d.products.data.items.find((i) => i.rail === "lifi")!.users).toBe(2);
    });

    it("cohort funnel; unrecorded stages are null, never invented", async () => {
      const d = await build();
      if (d.funnel.status !== "ok") throw new Error("funnel unavailable");
      const by = Object.fromEntries(d.funnel.data.stages.map((s) => [s.key, s]));
      expect(by.signup_started.count).toBeNull(); // no recorded starts
      expect(by.signup_complete.count).toBe(4);
      expect(by.kyc_started.count).toBe(3);
      expect(by.kyc_complete.count).toBe(2);
      if (mode === "sql") {
        expect(by.wallet_linked.count).toBe(1);
        expect(by.first_transaction.count).toBe(1); // u-new-2 only failed
      } else {
        expect(by.wallet_linked.count).toBeNull();
        expect(by.first_transaction.count).toBeNull();
        expect(by.first_transaction.note).toMatch(/0027/);
      }
    });

    it("never selects a personal column from any table", async () => {
      await build();
      expect(queries.length).toBeGreaterThan(5);
      for (const q of queries) {
        const select = /select=([^&]+)/.exec(q)?.[1] ?? "";
        expect(select, q).not.toMatch(/email|name|phone|tax_residency|safe_address|ip_address|details|google_sub|apple_sub|payer|recipient|address/);
        expect(select, q).not.toBe("*");
      }
    });

    it("row reads are bounded: aggregations by time AND rows, latest-N by a small limit", async () => {
      await build();
      const reads = queries.filter((q) => /limit=\d+/.test(q));
      expect(reads.length).toBeGreaterThan(2);
      for (const q of reads) {
        const limit = Number(/limit=(\d+)/.exec(q)?.[1]);
        if (/order=created_at\.desc/.test(q)) expect(limit, q).toBeLessThanOrEqual(200);
        else {
          expect(q, q).toMatch(/created_at=gte\./);
          expect(q, q).toMatch(/created_at=lt\./);
        }
      }
      if (mode === "sql") {
        // The aggregation path reads NO ledger or audit rows for metrics.
        expect(queries.some((q) => /^(ops_tx_events|audit_log)\?select=[^&]*&created_at=gte/.test(q))).toBe(false);
      }
    });
  });
}
