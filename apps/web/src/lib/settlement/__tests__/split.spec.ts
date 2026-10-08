import { describe, expect, it } from "vitest";
import { nextRulePercent, parsePercent, percentError, previewAmounts, summarize } from "../split";
import { settlementSchema } from "../onboarding";
import { settlement } from "./fixtures";

const rules = (...p: number[]) => p.map((percent) => ({ percent }));

describe("split editor arithmetic", () => {
  it("A: 80/15/5 is valid at 100%", () => {
    expect(summarize(rules(80, 15, 5))).toMatchObject({ total: 100, valid: true, remaining: 0, over: 0, ruleErrors: {} });
  });
  it("B: 80/15 is 95% with 5% remaining", () => {
    expect(summarize(rules(80, 15))).toMatchObject({ total: 95, valid: false, remaining: 5, over: 0 });
  });
  it("C: 80/30/5 is 115% with 15% over", () => {
    expect(summarize(rules(80, 30, 5))).toMatchObject({ total: 115, valid: false, remaining: 0, over: 15 });
  });
  it("D: a single 100% rule is valid", () => {
    expect(summarize(rules(100)).valid).toBe(true);
  });
  it("E: 0/100 is valid", () => {
    expect(summarize(rules(0, 100)).valid).toBe(true);
  });
  it("F: -1/101 is invalid even though it sums to 100", () => {
    const s = summarize(rules(-1, 101));
    expect(s.total).toBe(100);
    expect(s.valid).toBe(false);
    expect(s.ruleErrors).toEqual({ 0: "Percentages cannot be negative.", 1: "A rule cannot exceed 100%." });
  });
  it("G: NaN / empty input is invalid and never counted", () => {
    expect(parsePercent("")).toBeNaN();
    expect(parsePercent("  ")).toBeNaN();
    expect(parsePercent("abc")).toBeNaN();
    expect(parsePercent("1e2")).toBeNaN();
    const s = summarize([{ percent: Number.NaN }, { percent: 100 }]);
    expect(s).toMatchObject({ total: 100, valid: false, ruleErrors: { 0: "Enter a percentage." } });
    // a draft round-tripped through JSON turns NaN into null; still invalid
    expect(summarize(JSON.parse(JSON.stringify([{ percent: Number.NaN }, { percent: 100 }]))).valid).toBe(false);
  });
  it("decimals are kept as typed and flagged, not silently rounded", () => {
    expect(parsePercent("2.5")).toBe(2.5);
    expect(percentError(2.5)).toBe("Use whole percentages.");
    expect(summarize(rules(97.5, 2.5)).valid).toBe(false);
    expect(parsePercent("-3")).toBe(-3);
  });
  it("H: adding rules never pushes the total past 100", () => {
    let r = rules(80);
    r = [...r, { percent: nextRulePercent(r) }];
    expect(r.map((x) => x.percent)).toEqual([80, 20]);
    expect(summarize(r).valid).toBe(true);
    r = [...r, { percent: nextRulePercent(r) }];
    expect(r.at(-1)!.percent).toBe(0);
    expect(summarize(r).total).toBe(100);
    expect(nextRulePercent(rules(80, 30))).toBe(0); // already over: new rule adds nothing
    expect(nextRulePercent([{ percent: Number.NaN }])).toBe(100);
  });
  it("I: deleting a rule recalculates the total", () => {
    const r = rules(80, 15, 5);
    expect(summarize(r.filter((_, i) => i !== 2))).toMatchObject({ total: 95, remaining: 5 });
  });
  it("J: preview follows every edit; malformed rules contribute nothing", () => {
    expect(previewAmounts(rules(80, 15, 5), 1000)).toEqual([800, 150, 50]);
    expect(previewAmounts(rules(90, 15, 5), 1000)).toEqual([900, 150, 50]);
    expect(previewAmounts([{ percent: -1 }, { percent: Number.NaN }, { percent: 50 }], 1000)).toEqual([0, 0, 500]);
    expect(previewAmounts(rules(100), Number.NaN)).toEqual([0]);
  });
  it("repeated edits of one field are deterministic", () => {
    let r = rules(80, 15, 5);
    for (const v of ["8", "", "85", "80"]) r = r.map((x, i) => (i === 0 ? { percent: parsePercent(v) } : x));
    expect(summarize(r)).toMatchObject({ total: 100, valid: true });
  });
});

describe("server schema stays authoritative (K)", () => {
  const bad = (rulesPatch: unknown) => settlementSchema.safeParse({ ...settlement([80, 15, 5]), rules: rulesPatch }).success;
  const base = settlement([80, 15, 5]).rules;
  it("accepts 80/15/5 and 0/100", () => {
    expect(settlementSchema.safeParse(settlement([80, 15, 5])).success).toBe(true);
    expect(settlementSchema.safeParse(settlement([0, 100])).success).toBe(true);
  });
  it("rejects wrong totals, out-of-range, fractional, non-numeric and empty rules", () => {
    expect(bad(settlement([80, 30, 5]).rules)).toBe(false);
    expect(bad(settlement([80, 15]).rules)).toBe(false);
    expect(bad(settlement([-1, 101]).rules)).toBe(false);
    expect(bad([{ ...base[0], percent: 97.5 }, { ...base[1], percent: 2.5 }])).toBe(false);
    expect(bad([{ ...base[0], percent: "100" }])).toBe(false);
    expect(bad([{ ...base[0], percent: null }, { ...base[1], percent: 100 }])).toBe(false);
    expect(bad([])).toBe(false);
  });
  it("rejects injected destinations and extra fields", () => {
    expect(bad([{ ...base[0], percent: 100, destination: "attacker_wallet" }])).toBe(false);
    expect(bad([{ ...base[0], percent: 100, address: "0x000000000000000000000000000000000000dEaD" }])).toBe(false);
    expect(settlementSchema.safeParse({ ...settlement([100]), payoutAccount: "acct_x" }).success).toBe(false);
  });
});
