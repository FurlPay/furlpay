import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rows: [] as Record<string, string>[], rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabaseBackend: "supabase", sbSelect: vi.fn(async () => h.rows), sbRpc: h.rpc }));

import { reconcileOpenBvnkRecords } from "../reconcile";
import { BvnkNotConfigured } from "../config";

const doc = (name: string) => JSON.parse(readFileSync(join(__dirname, "fixtures", `response-${name}.json`), "utf8"));
const ENV = { BVNK_ENVIRONMENT: "sandbox", BVNK_HAWK_AUTH_ID: "id", BVNK_HAWK_AUTH_KEY: "key" } as unknown as NodeJS.ProcessEnv;
const TID = "d4a904e0-b040-4132-a6d3-ed7d03cdfce7";
const PID = "f5a879ec-9dcd-11f0-95d7-89347b196078";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  h.rows = [];
  h.rpc.mockReset().mockResolvedValue("updated");
});

describe("BVNK reconciliation", () => {
  it("re-reads only open transfers and payouts and records the API's answer", async () => {
    h.rows = [
      { kind: "transfer", provider_id: TID, direction: "OUT", status: "PROCESSING", provider_updated_at: "2026-01-01T00:00:00Z" },
      { kind: "transfer", provider_id: "11111111-1111-4111-8111-111111111111", direction: "OUT", status: "COMPLETED", provider_updated_at: "2026-01-01T00:00:00Z" },
      { kind: "payout", provider_id: PID, direction: "OUT", status: "ON_HOLD", provider_updated_at: "2026-01-01T00:00:00Z" },
    ];
    const fetch = vi.fn(async (url: string) => (url.includes("/transfers/") ? json(200, doc("transfer-read-v-3")) : json(200, doc("payout-get-v-2"))));
    const r = await reconcileOpenBvnkRecords({ deps: { fetch: fetch as unknown as typeof globalThis.fetch, env: ENV, sleep: async () => {} } });
    expect(r).toEqual({ checked: 2, updated: 2, unchanged: 0, notFound: 0, failed: 0 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.every(([, init]) => (init as RequestInit).method === "GET")).toBe(true);
    expect(h.rpc.mock.calls.map((c) => c[1].p.source)).toEqual(["api", "api"]);
  });

  it("counts 404 and failures without throwing, and records nothing for them", async () => {
    h.rows = [
      { kind: "transfer", provider_id: TID, direction: "OUT", status: "PROCESSING", provider_updated_at: "2026-01-01T00:00:00Z" },
      { kind: "payout", provider_id: PID, direction: "OUT", status: "PENDING", provider_updated_at: "2026-01-01T00:00:00Z" },
    ];
    const fetch = vi.fn(async (url: string) => (url.includes("/transfers/") ? json(404, {}) : json(500, {})));
    const r = await reconcileOpenBvnkRecords({ deps: { fetch: fetch as unknown as typeof globalThis.fetch, env: ENV, sleep: async () => {} } });
    expect(r).toMatchObject({ checked: 2, notFound: 1, failed: 1, updated: 0 });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("does nothing without BVNK credentials", async () => {
    h.rows = [{ kind: "transfer", provider_id: TID, direction: "OUT", status: "PROCESSING", provider_updated_at: "2026-01-01T00:00:00Z" }];
    const fetch = vi.fn();
    await expect(reconcileOpenBvnkRecords({ deps: { fetch: fetch as unknown as typeof globalThis.fetch, env: {} as NodeJS.ProcessEnv } })).rejects.toBeInstanceOf(BvnkNotConfigured);
    expect(fetch).not.toHaveBeenCalled();
  });
});
