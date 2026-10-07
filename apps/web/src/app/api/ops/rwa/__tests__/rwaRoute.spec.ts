import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const state = { admin: true, rpcArgs: [] as Record<string, unknown>[], missing: false };

vi.mock("@/lib/ops/respond", async (orig) => ({
  ...(await orig<typeof import("@/lib/ops/respond")>()),
  requireOpsAdmin: vi.fn(async () =>
    state.admin ? { ok: true, account: { user: { id: "admin-1" } } } : { ok: false, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  ),
}));
vi.mock("@/lib/rateLimit", async (orig) => ({ ...(await orig<typeof import("@/lib/rateLimit")>()), rateLimitOr429: vi.fn(async () => null) }));
vi.mock("@/lib/supabase", async (orig) => {
  const real = await orig<typeof import("@/lib/supabase")>();
  return {
    ...real,
    supabaseBackend: "supabase",
    sbRpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      if (state.missing) throw new real.SupabaseFunctionMissing(fn);
      state.rpcArgs.push({ fn, ...args });
      if (fn === "rwa_search") return { total: 1, total_usd: "2810893623.835801", rows: [{ product_name: "Tether Gold", token_symbol: "XAUT", chain: "ethereum", issuer_name: "Tether", asset_class: "commodities", asset_type: "metals", market_cap_usd: "2810893623.835801" }] };
      return {
        snapshot_date: "2026-10-06", snapshots: ["2026-10-06"], total_usd: "32090000000", deployments: 33338, live_deployments: 7770, products: 344, issuers: 101, chains: 26,
        by_class: [{ asset_class: "rates", market_cap_usd: "16030000000", deployments: 221, products: 90 }],
        by_type: [], by_chain: [], by_issuer: [], top_products: [],
      };
    }),
  };
});

import { GET } from "../route";

const req = (qs: string) => new NextRequest(`https://furlpay.com/api/ops/rwa?${qs}`);

beforeEach(() => {
  state.admin = true;
  state.missing = false;
  state.rpcArgs = [];
});

describe("GET /api/ops/rwa", () => {
  it("is admin-only: a non-admin learns nothing and no query runs", async () => {
    state.admin = false;
    expect((await GET(req("view=summary"))).status).toBe(401);
    expect((await GET(req("view=search&q=x"))).status).toBe(401);
    expect(state.rpcArgs).toHaveLength(0);
  });

  it("serves the summary with numbers parsed", async () => {
    const body = await (await GET(req("view=summary"))).json();
    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({ snapshot_date: "2026-10-06", total_usd: 32090000000, products: 344 });
  });

  it("maps validated search filters onto rwa_search parameters", async () => {
    const res = await GET(req("view=search&q=gold&assetClass=commodities&chain=ethereum&minUsd=1000000&sort=name&limit=25&offset=50"));
    expect(res.status).toBe(200);
    expect(state.rpcArgs.at(-1)).toEqual({
      fn: "rwa_search", p_q: "gold", p_asset_class: "commodities", p_chain: "ethereum", p_issuer: null, p_min_usd: 1000000, p_sort: "name", p_limit: 25, p_offset: 50,
    });
    expect((await res.json()).data.rows[0].market_cap_usd).toBe(2810893623.835801);
  });

  it("rejects malformed filters before querying", async () => {
    for (const qs of ["view=search&chain=Ethereum Mainnet", "view=search&limit=5000", "view=search&assetClass=DROP%20TABLE", "view=search&minUsd=-1", "view=search&sort=evil", "view=bogus"]) {
      expect((await GET(req(qs))).status).toBe(400);
    }
    expect(state.rpcArgs).toHaveLength(0);
  });

  it("says plainly when the migration is not applied", async () => {
    state.missing = true;
    const res = await GET(req("view=summary"));
    expect(res.status).toBe(503);
    expect((await res.json()).error.message).toMatch(/0033_rwa_asset_snapshots\.sql is not applied/);
  });
});
