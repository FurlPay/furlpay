import { describe, expect, it } from "vitest";
// The importer's pure core (scripts/data/rwa-csv.mjs) — what decides whether a
// CSV is written at all.
// @ts-expect-error — plain .mjs module without type declarations
import { HEADER, normalizeMoney, parseCsv, sumMoney, summarize, validateRows } from "../../../../../scripts/data/rwa-csv.mjs";

const head = HEADER.join(",");
const opts = { asOf: "2026-10-06", source: "test" };
const csv = (...lines: string[]) => parseCsv([head, ...lines].join("\n"));

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, commas in fields, CRLF and a BOM", () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n');
    expect(rows).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
  });
});

describe("normalizeMoney — exact, never via float", () => {
  it("keeps plain decimals exactly (8-decimal column)", () => {
    expect(normalizeMoney("2810893623.835801")).toBe("2810893623.835801");
    expect(normalizeMoney("0")).toBe("0");
    expect(normalizeMoney("0.00000000")).toBe("0");
    expect(normalizeMoney("007.50")).toBe("7.5");
  });
  it("expands exponent notation by moving the point, then rounds half-up at 8 dp", () => {
    expect(normalizeMoney("1.5e3")).toBe("1500");
    expect(normalizeMoney("2.5e-9")).toBe("0"); // 0.0000000025 -> 0.00000000
    expect(normalizeMoney("5e-9")).toBe("0.00000001"); // half-up
    expect(normalizeMoney("1.23456789123e2")).toBe("123.45678912");
  });
  it("rounds half-up at the 8th decimal with carry", () => {
    expect(normalizeMoney("0.999999995")).toBe("1");
    expect(normalizeMoney("12.345678904")).toBe("12.3456789");
  });
  it("rejects negatives, text, NaN and absurd magnitudes", () => {
    for (const bad of ["-1", "abc", "NaN", "", "1,000", "1e40", "Infinity"]) expect(normalizeMoney(bad)).toBeNull();
  });
  it("sums exactly where floats would not", () => {
    expect(sumMoney(["0.1", "0.2"])).toBe("0.3");
    expect(sumMoney(["2810893623.835801", "1792614035.5856245"].map((v) => normalizeMoney(v)!))).toBe("4603507659.4214255");
  });
});

describe("validateRows", () => {
  it("accepts valid rows, including zero-value deployments and an empty symbol", () => {
    const { rows, errors } = validateRows(
      csv("Tether Gold,XAUT,ethereum,Tether,commodities,metals,2810893623.835801", "Dinari dShares,,base,Dinari,equities,equities_cash,0.0"),
      opts
    );
    expect(errors).toEqual([]);
    expect(rows[1]).toMatchObject({ token_symbol: "", market_cap_usd: "0", snapshot_date: "2026-10-06" });
  });

  it("rejects the whole file on ANY malformed row (caller writes nothing)", () => {
    const cases = [
      "X,X,Ethereum Mainnet,I,rates,metals,1", // chain shape
      "X,X,ethereum,I,Rates!,t,1", // asset_class
      "X,X,ethereum,I,rates,metals,-5", // negative
      "X,X,ethereum,I,rates,metals,abc", // not a number
      ",X,ethereum,I,rates,metals,1", // empty product
      "X,X,ethereum,,rates,metals,1", // empty issuer
      "X,X,ethereum,I,rates,t", // missing column
    ];
    for (const bad of cases) {
      const r = validateRows(csv("Good,G,base,I,rates,metals,1", bad), opts);
      expect(r.errors.length, bad).toBeGreaterThan(0);
    }
  });

  it("rejects a duplicate (chain, product, symbol) instead of merging it", () => {
    const r = validateRows(csv("P,S,base,I,rates,metals,1", "P,S,base,I,rates,metals,2"), opts);
    expect(r.errors).toEqual(["line 3: duplicate (chain, product, symbol)"]);
  });

  it("allows the same product+symbol on different chains (multi-chain deployments)", () => {
    const r = validateRows(csv("BUIDL Fund,BUIDL,ethereum,BlackRock,rates,metals,100", "BUIDL Fund,BUIDL,solana,BlackRock,rates,metals,250"), opts);
    expect(r.errors).toEqual([]);
    expect(summarize(r.rows)).toMatchObject({ rows: 2, products: 1, chains: 2, totalUsd: "350" });
  });

  it("rejects a wrong header", () => {
    expect(validateRows(parseCsv("name,symbol\nA,B"), opts).errors[0]).toMatch(/unexpected header/);
  });
});

describe("summarize", () => {
  it("counts zero vs non-zero and sums exactly", () => {
    const { rows } = validateRows(csv("A,A,base,I,rates,metals,0", "B,B,base,I,rates,metals,0.1", "C,C,solana,J,credit,metals,0.2"), opts);
    expect(summarize(rows)).toEqual({ rows: 3, nonzero: 2, zero: 1, emptySymbol: 0, totalUsd: "0.3", products: 3, issuers: 2, chains: 2 });
  });
});
