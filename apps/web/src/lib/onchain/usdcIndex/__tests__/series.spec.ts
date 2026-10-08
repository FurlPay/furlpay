import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/rateLimit", () => ({ rateLimitOr429: async () => null }));
import { parseSeriesRange, toDecimal } from "../view";
import { GET as HOURLY } from "@/app/api/onchain/token/usdc/metrics/hourly/route";
import { GET as DAILY } from "@/app/api/onchain/token/usdc/metrics/daily/route";

const NOW = Date.parse("2026-10-08T15:20:00Z");

describe("toDecimal (6-decimal USDC, exact)", () => {
  it.each([
    ["0", "0"],
    ["1", "0.000001"],
    ["1000000", "1"],
    ["1234567", "1.234567"],
    ["340282366920938463463374607431768211455", "340282366920938463463374607431768.211455"],
    ["000120", "0.00012"],
  ])("%s → %s", (raw, out) => expect(toDecimal(raw)).toBe(out));
});

describe("parseSeriesRange", () => {
  it("defaults to the last 24 hours / 30 days, bucket-aligned", () => {
    const h = parseSeriesRange("hourly", null, null, NOW);
    expect("error" in h ? h.error : [h.from.toISOString(), h.to.toISOString()]).toEqual(["2026-10-07T16:00:00.000Z", "2026-10-08T16:00:00.000Z"]);
    const d = parseSeriesRange("daily", null, null, NOW);
    expect("error" in d ? d.error : (d.to.getTime() - d.from.getTime()) / 86_400_000).toBe(30);
  });
  it("accepts dates for daily and ISO datetimes for both", () => {
    const d = parseSeriesRange("daily", "2026-09-01", "2026-09-08", NOW);
    expect("error" in d ? d.error : [d.from.toISOString().slice(0, 10), d.to.toISOString().slice(0, 10)]).toEqual(["2026-09-01", "2026-09-08"]);
  });
  it("rejects malformed, inverted and oversized ranges", () => {
    for (const [g, f, t] of [
      ["hourly", "yesterday", null],
      ["hourly", "2026-10-08T10:00:00Z", "2026-10-08T09:00:00Z"],
      ["hourly", "2026-09-01T00:00:00Z", "2026-09-09T01:00:00Z"],
      ["daily", "2025-01-01", "2026-06-01"],
      ["daily", "2026-10-01'; drop table usdc_daily; --", null],
    ] as const)
      expect("error" in parseSeriesRange(g, f, t, NOW), `${g} ${f} ${t}`).toBe(true);
  });
});

describe("series routes", () => {
  const req = (path: string) => new NextRequest(`https://furlpay.com${path}`);
  it("400 on a bad range or chain; 503 index_unavailable (never an empty 200) without a store", async () => {
    expect((await HOURLY(req("/api/onchain/token/usdc/metrics/hourly?from=nope"))).status).toBe(400);
    expect((await DAILY(req("/api/onchain/token/usdc/metrics/daily?chain=base"))).status).toBe(400);
    const r = await HOURLY(req("/api/onchain/token/usdc/metrics/hourly"));
    expect(r.status).toBe(503);
    expect((await r.json()).error.code).toBe("index_unavailable");
  });
});
