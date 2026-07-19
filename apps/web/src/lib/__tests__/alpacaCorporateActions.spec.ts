// ---------------------------------------------------------------------------
// Alpaca corporate-actions ingestion. Covers the PURE normalizer (the mapping
// from Alpaca's typed arrays → the canonical CorporateAction model) against
// fixtures shaped like the real GET /v1/corporate-actions response, plus the
// end-to-end chain into projectDividends, plus the ingest/lots route auth gates.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { normalizeAlpacaCorporateActions } from "@/lib/corporateActions/alpaca";
import { projectDividends, recordBuy } from "@/lib/corporateActions/projector";
import { POST as ingestPOST } from "@/app/api/investing/corporate-actions/ingest/route";
import { GET as lotsGET } from "@/app/api/investing/lots/route";

// A payload shaped like the real Alpaca /v1/corporate-actions response.
const PAYLOAD = {
  corporate_actions: {
    forward_splits: [
      { id: "ca_fs_1", symbol: "AAPL", old_rate: 1, new_rate: 4, ex_date: "2020-08-31", record_date: "2020-08-24", payable_date: "2020-08-28", process_date: "2020-08-31" },
      { id: "ca_fs_bad", symbol: "BAD", old_rate: 0, new_rate: 4, ex_date: "2020-08-31" }, // unusable ratio → dropped
    ],
    reverse_splits: [
      { id: "ca_rs_1", symbol: "XYZ", old_rate: 10, new_rate: 1, ex_date: "2026-01-10", record_date: "2026-01-05", payable_date: "2026-01-09", new_symbol: "XYZN" },
    ],
    cash_dividends: [
      { id: "ca_cd_1", symbol: "AAPL", rate: 0.25, ex_date: "2026-05-08", record_date: "2026-05-12", payable_date: "2026-05-15", special: false, sub_type: "regular" },
      { id: "ca_cd_bad", symbol: "AAPL", ex_date: "2026-05-08" }, // no rate → dropped
    ],
    name_changes: [
      { id: "ca_nc_1", old_symbol: "FB", new_symbol: "META", process_date: "2022-06-09" },
    ],
  },
  next_page_token: null,
};

describe("normalizeAlpacaCorporateActions", () => {
  const norm = normalizeAlpacaCorporateActions(PAYLOAD);
  const byId = (id: string) => norm.find((n) => n.action.id === id)?.action;

  it("drops rows missing the fields their type needs", () => {
    // 4 valid: one forward split, one reverse split, one dividend, one rename.
    expect(norm).toHaveLength(4);
    expect(byId("ca_fs_bad")).toBeUndefined();
    expect(byId("ca_cd_bad")).toBeUndefined();
  });

  it("maps a forward split with ratio = new_rate/old_rate on the ex-date", () => {
    expect(byId("ca_fs_1")).toMatchObject({
      symbol: "AAPL",
      type: "stock_split",
      ratio: 4,
      effectiveDate: "2020-08-31",
      recordDate: "2020-08-24",
      paymentDate: "2020-08-28",
      source: "alpaca",
    });
  });

  it("maps a reverse split (ratio < 1) and carries the new symbol", () => {
    expect(byId("ca_rs_1")).toMatchObject({ type: "reverse_split", ratio: 0.1, newSymbol: "XYZN" });
  });

  it("maps a cash dividend's rate to amountPerShare", () => {
    expect(byId("ca_cd_1")).toMatchObject({ type: "cash_dividend", amountPerShare: 0.25, effectiveDate: "2026-05-08", recordDate: "2026-05-12" });
  });

  it("maps a name change to a symbol_change on the process date", () => {
    expect(byId("ca_nc_1")).toMatchObject({ type: "symbol_change", symbol: "FB", newSymbol: "META", effectiveDate: "2022-06-09" });
  });

  it("carries the raw provider payload for reconciliation", () => {
    const entry = norm.find((n) => n.action.id === "ca_cd_1")!;
    expect((entry.raw as { sub_type?: string }).sub_type).toBe("regular");
  });

  it("uses Alpaca's id as the action id (the upsert idempotency key)", () => {
    expect(norm.map((n) => n.action.id).sort()).toEqual(["ca_cd_1", "ca_fs_1", "ca_nc_1", "ca_rs_1"]);
  });

  it("tolerates an empty / malformed payload", () => {
    expect(normalizeAlpacaCorporateActions({})).toEqual([]);
    expect(normalizeAlpacaCorporateActions({ corporate_actions: {} })).toEqual([]);
  });
});

describe("ingest → projectDividends (the whole chain)", () => {
  it("an ingested dividend produces a real entitlement from the ledger", () => {
    const actions = normalizeAlpacaCorporateActions(PAYLOAD).map((n) => n.action);
    const lots = [recordBuy({ id: "l1", userId: "u1", symbol: "AAPL", quantity: 100, costBasis: 15_000, acquiredAt: "2026-01-01T00:00:00Z" })];
    const dividends = projectDividends(lots, actions);
    const aapl = dividends.find((d) => d.symbol === "AAPL")!;
    expect(aapl.sharesHeld).toBe(100);
    expect(aapl.grossAmount).toBe(25); // 100 × $0.25
  });
});

function noAuth(url: string, method: "GET" | "POST") {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": `10.7.${Math.floor(Math.random() * 255)}.1` },
    ...(method === "POST" ? { body: "{}" } : {}),
  });
}

describe("route auth gates", () => {
  it("ingest refuses an unauthenticated caller", async () => {
    const res = await ingestPOST(noAuth("https://furlpay.com/api/investing/corporate-actions/ingest", "POST"));
    expect([401, 403]).toContain(res.status);
  });

  it("lots refuses an unauthenticated caller", async () => {
    const res = await lotsGET(noAuth("https://furlpay.com/api/investing/lots", "GET"));
    expect([401, 403]).toContain(res.status);
  });
});
