import { describe, it, expect, vi, afterEach } from "vitest";
import { getHkBranches, getHkAtms, getHsbcGroupBranches, HSBC_GROUP_BANKS } from "@/lib/hkma";

/**
 * HKMA public open-data client.
 *
 * The contract under test is FAIL-CLOSED. `lib/hsbc.ts` shipped hardcoded FX
 * rates stamped with a fresh timestamp because its fallback was
 * indistinguishable from a successful call at the call site. This client must
 * never do that: on any failure it returns an empty list AND an `error`, so a
 * caller cannot mistake a broken upstream for "no branches here".
 *
 * Shapes below are taken from the real payload, verified live 22 Jul 2026:
 * 200 OK, header.success true, 1,051 records across 20 banks.
 */

const envelope = (records: unknown[]) => ({
  header: { success: true, err_code: "0000", err_msg: "No error found" },
  result: { datasize: records.length, records },
});

const BRANCH = {
  district: "Central and Western",
  bank_name: "The Hongkong and Shanghai Banking Corporation Limited",
  branch_name: "Head Office",
  address: "1 Queen's Road Central",
  service_hours: "Mon-Fri 09:00-17:00",
  latitude: "22.280412",
  longitude: "114.159893",
  "barrier-free_access": "Yes",
};

const mockFetch = (body: unknown, ok = true, status = 200) =>
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, status, json: async () => body })));

afterEach(() => vi.unstubAllGlobals());

describe("hkma client — success path", () => {
  it("maps the real record shape into camelCase with numeric coordinates", async () => {
    mockFetch(envelope([BRANCH]));
    const r = await getHkBranches();
    expect(r.error).toBeUndefined();
    expect(r.source).toBe("hkma_live");
    expect(r.records[0]).toMatchObject({
      bankName: "The Hongkong and Shanghai Banking Corporation Limited",
      branchName: "Head Office",
      barrierFreeAccess: "Yes",
    });
    // Coordinates arrive as strings and must be usable as numbers by any map UI.
    expect(r.records[0].latitude).toBeCloseTo(22.280412, 5);
    expect(typeof r.records[0].longitude).toBe("number");
  });

  it("returns null coordinates rather than NaN when the registry omits them", async () => {
    mockFetch(envelope([{ ...BRANCH, latitude: "", longitude: undefined }]));
    const r = await getHkBranches();
    expect(r.records[0].latitude).toBeNull();
    expect(r.records[0].longitude).toBeNull();
  });

  /* The API's own bank_name parameter was tested against production and does
     NOT filter — it returned ICBC and Bank of Communications for an HSBC
     query. Filtering therefore happens client-side, and must tolerate the
     double spaces the registry actually contains. */
  it("filters by bank client-side, case- and whitespace-insensitively", async () => {
    mockFetch(envelope([BRANCH, { ...BRANCH, bank_name: "Bank of  Communications (Hong Kong) Limited" }]));
    const r = await getHkBranches({ bank: "bank of communications" });
    expect(r.records).toHaveLength(1);
    expect(r.records[0].bankName).toMatch(/Communications/);
    // `returned` reports the pre-filter count so a caller can see the corpus size.
    expect(r.returned).toBe(2);
  });

  it("filters by district", async () => {
    mockFetch(envelope([BRANCH, { ...BRANCH, district: "Yuen Long" }]));
    expect((await getHkBranches({ district: "yuen long" })).records).toHaveLength(1);
  });

  it("selects HSBC and Hang Seng together as one group", async () => {
    mockFetch(envelope([BRANCH, { ...BRANCH, bank_name: "Hang Seng Bank Limited" }, { ...BRANCH, bank_name: "DBS Bank (Hong Kong) Limited" }]));
    const r = await getHsbcGroupBranches();
    expect(r.records).toHaveLength(2);
    expect(HSBC_GROUP_BANKS).toContain("Hang Seng Bank");
  });

  it("maps the richer ATM fields", async () => {
    mockFetch(envelope([{ ...BRANCH, type_of_machine: "ATM", function: "Cash Withdrawal", currencies_supported: "HKD, CNY", network: "JETCO" }]));
    const r = await getHkAtms();
    expect(r.records[0]).toMatchObject({ typeOfMachine: "ATM", currenciesSupported: "HKD, CNY", network: "JETCO" });
  });
});

describe("hkma client — fail closed", () => {
  it("reports an error on non-200 and returns NO records", async () => {
    mockFetch({}, false, 503);
    const r = await getHkBranches();
    expect(r.records).toEqual([]);
    expect(r.error).toMatch(/503/);
  });

  /* THE CASE A STATUS CODE DOES NOT CATCH. HKMA returns HTTP 200 with
     header.success false on a bad query. Reading only res.ok would score that
     as an empty result set. */
  it("treats 200 with header.success=false as a failure, not an empty result", async () => {
    mockFetch({ header: { success: false, err_code: "1001", err_msg: "Invalid parameter" }, result: { records: [] } });
    const r = await getHkBranches();
    expect(r.records).toEqual([]);
    expect(r.error).toMatch(/1001|Invalid parameter/);
  });

  it("reports an error when the upstream is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const r = await getHkBranches();
    expect(r.records).toEqual([]);
    expect(r.error).toMatch(/unreachable|ECONNREFUSED/);
  });

  it("never substitutes fabricated records for a failure", async () => {
    mockFetch({}, false, 500);
    const r = await getHkAtms();
    expect(r.records).toHaveLength(0);
    expect(r.error).toBeTruthy();
  });

  it("tolerates a malformed envelope without throwing", async () => {
    mockFetch({ header: { success: true }, result: null });
    const r = await getHkBranches();
    expect(r.records).toEqual([]);
    expect(r.error).toBeUndefined();
  });
});
