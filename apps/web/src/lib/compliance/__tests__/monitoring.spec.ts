import { describe, expect, it } from "vitest";
import { evaluate, inWindow, RULES, type MonitoredTx } from "../monitoring";

const t0 = Date.parse("2026-10-01T00:00:00Z");
let n = 0;
const tx = (hours: number, amountUsd: number, status = "settled", direction: "in" | "out" = "out"): MonitoredTx => ({ id: `t${++n}`, direction, amountUsd, status, timestamp: new Date(t0 + hours * 3_600_000).toISOString() });

describe("rule catalogue", () => {
  it("rules are versioned; rules needing unrecorded data are disabled with the reason", () => {
    for (const r of RULES) expect(r.version).toBeGreaterThanOrEqual(1);
    const disabled = RULES.filter((r) => !r.enabled);
    expect(disabled.map((r) => r.id).sort()).toEqual(["counterparty_risk", "geographic_risk", "new_wallet_exposure"]);
    for (const r of disabled) expect(r.disabledReason).toMatch(/do not record|do not link/);
  });
});

describe("evaluation", () => {
  it("high value: at or above the threshold, settled/pending only", () => {
    const a = evaluate("u1", [tx(0, 10_000), tx(1, 9_999.99), tx(2, 50_000, "declined")]);
    expect(a.filter((x) => x.ruleId === "high_value").map((x) => x.amountUsd)).toEqual([10_000]);
  });
  it("structuring: three near-threshold payments inside 72h", () => {
    const a = evaluate("u1", [tx(0, 9_500), tx(10, 9_000), tx(30, 8_800), tx(200, 9_900)]);
    const s = a.filter((x) => x.ruleId === "structuring");
    expect(s).toHaveLength(1);
    expect(s[0].transactionIds).toHaveLength(3);
    expect(s[0].explanation).toMatch(/structuring v1|rule structuring v1/);
  });
  it("velocity: more than 20 transactions in 24h raises one alert, not one per window", () => {
    const rows = Array.from({ length: 25 }, (_, i) => tx(i * 0.5, 10));
    const v = evaluate("u1", rows).filter((x) => x.ruleId === "velocity");
    expect(v).toHaveLength(1);
    expect(v[0].transactionIds.length).toBeGreaterThan(20);
  });
  it("repeated failures: five declines in an hour", () => {
    const a = evaluate("u1", [tx(0, 5, "declined"), tx(0.1, 5, "declined"), tx(0.2, 5, "declined"), tx(0.3, 5, "declined"), tx(0.4, 5, "declined")]);
    expect(a.map((x) => x.ruleId)).toEqual(["failed_anomaly"]);
  });
  it("quiet history raises nothing", () => {
    expect(evaluate("u1", [tx(0, 50), tx(5, 120), tx(48, 300)])).toEqual([]);
  });
  it("deterministic and replay-safe: same input, same alert keys, regardless of order", () => {
    const rows = [tx(0, 9_500), tx(10, 9_000), tx(30, 8_800), tx(40, 12_000)];
    const a = evaluate("u1", rows).map((x) => x.key);
    const b = evaluate("u1", [...rows].reverse()).map((x) => x.key);
    expect(b).toEqual(a);
    expect(a.every((k) => k.startsWith("monitoring:u1:") && /@v\d+:/.test(k))).toBe(true);
  });
  it("malformed rows are ignored, never crash or count", () => {
    const bad = [{ id: "x", direction: "out", amountUsd: Number.NaN, status: "settled", timestamp: "2026-10-01T00:00:00Z" }, { id: "y", direction: "out", amountUsd: 20_000, status: "settled", timestamp: "not a date" }, { id: "z", direction: "out", amountUsd: -50_000, status: "settled", timestamp: "2026-10-01T00:00:00Z" }] as MonitoredTx[];
    expect(evaluate("u1", bad)).toEqual([]);
  });
  it("back-testing window", () => {
    const rows = [tx(0, 1), tx(24, 2), tx(48, 3)];
    expect(inWindow(rows, new Date(t0 + 12 * 3_600_000).toISOString(), new Date(t0 + 36 * 3_600_000).toISOString()).map((r) => r.amountUsd)).toEqual([2]);
  });
});
