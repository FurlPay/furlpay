import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDuffelFlightSearch } from "@/lib/travel/duffel";

// Outcome classification for the flight search: the UI shows different states
// for "no supplier", "airlines had nothing", and "the supplier failed".

const REQ = { from: "DEL", to: "SFO", departDate: "2026-10-20", returnDate: "2026-10-25", adults: 2 };

const offer = (id: string, amount = "900.00") => ({
  id,
  total_amount: amount,
  total_currency: "USD",
  owner: { name: "Air India", iata_code: "AI" },
  slices: [
    { duration: "PT16H0M", segments: [{ origin: { iata_code: "DEL" }, destination: { iata_code: "SFO" }, departing_at: "2026-10-20T02:00:00", arriving_at: "2026-10-20T07:30:00", duration: "PT16H0M", marketing_carrier: { name: "Air India", iata_code: "AI" }, marketing_carrier_flight_number: "173" }] },
    { duration: "PT17H0M", segments: [{ origin: { iata_code: "SFO" }, destination: { iata_code: "DEL" }, departing_at: "2026-10-25T11:00:00", arriving_at: "2026-10-26T15:30:00", duration: "PT17H0M", marketing_carrier: { name: "Air India", iata_code: "AI" }, marketing_carrier_flight_number: "174" }] },
  ],
});

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv("DUFFEL_API_KEY", "duffel_test_unit_fixture");
  vi.stubEnv("NODE_ENV", "test");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("runDuffelFlightSearch", () => {
  it("no key → no_provider, and Duffel is never called", async () => {
    vi.stubEnv("DUFFEL_API_KEY", "");
    expect(await runDuffelFlightSearch(REQ)).toEqual({ ok: false, reason: "no_provider" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends two slices and every passenger for a round trip", async () => {
    fetchMock.mockResolvedValue(json({ data: { offers: [offer("off_1")] } }));
    await runDuffelFlightSearch({ ...REQ, childAges: [4] });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.data.slices).toEqual([
      { origin: "DEL", destination: "SFO", departure_date: "2026-10-20" },
      { origin: "SFO", destination: "DEL", departure_date: "2026-10-25" },
    ]);
    expect(body.data.passengers).toEqual([{ type: "adult" }, { type: "adult" }, { age: 4 }]);
    expect(fetchMock.mock.calls[0][0]).toMatch(/supplier_timeout=15000/);
  });

  it("one way sends exactly one slice", async () => {
    fetchMock.mockResolvedValue(json({ data: { offers: [] } }));
    await runDuffelFlightSearch({ ...REQ, returnDate: undefined });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).data.slices).toHaveLength(1);
  });

  it("HTTP error → supplier_error (not 'no flights')", async () => {
    fetchMock.mockResolvedValue(json({ errors: [{ title: "boom" }] }, 500));
    expect(await runDuffelFlightSearch(REQ)).toEqual({ ok: false, reason: "supplier_error" });
  });

  it("our deadline → timeout", async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));
    expect(await runDuffelFlightSearch(REQ)).toEqual({ ok: false, reason: "timeout" });
  });

  it("zero offers is a successful empty result", async () => {
    fetchMock.mockResolvedValue(json({ data: { offers: [] } }));
    expect(await runDuffelFlightSearch(REQ)).toEqual({ ok: true, offers: [], skipped: 0 });
  });

  it("malformed offers are skipped, good ones kept", async () => {
    fetchMock.mockResolvedValue(json({ data: { offers: [offer("off_good"), { id: "off_noprice", slices: offer("x").slices }, null, { id: "off_bad", total_amount: "10", slices: "nope" }] } }));
    const r = await runDuffelFlightSearch(REQ);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.offers.map((o) => o.id)).toEqual(["off_good"]);
      expect(r.skipped).toBe(3);
      expect(r.offers[0].legs).toHaveLength(2); // the return slice survives
    }
  });

  it("a non-JSON or shapeless body does not throw", async () => {
    fetchMock.mockResolvedValue(json({ data: { offers: "not-an-array" } }));
    expect(await runDuffelFlightSearch(REQ)).toEqual({ ok: true, offers: [], skipped: 0 });
  });
});
