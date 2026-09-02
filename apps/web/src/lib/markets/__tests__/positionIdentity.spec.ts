import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canonicalIdentifierFor,
  enrichPositions,
  marketDataKindFor,
  marketDataTargetFor,
  type EnrichedPosition,
} from "../positionIdentity";
import {
  parseInformationTable,
  positionsByIssuer,
  shareTotal,
  debtTotal,
  optionTotals,
  reportedTotal,
  type Holding,
} from "../providers/thirteenF";

// ---------------------------------------------------------------------------
// Tests at the integration boundary: where 13F positions acquire a canonical
// identity. The resolver has its own unit tests; these cover the join.
// ---------------------------------------------------------------------------

const XML = readFileSync(
  join(__dirname, "..", "providers", "__tests__", "fixtures", "jpm-13f-sample.xml"),
  "utf8"
);

const share = (cusip: string, issuer: string, shares: number, value: number): Holding => ({
  issuer, cusip, titleOfClass: "COMMON", value, amount: shares, amountType: "SH", type: "share",
});
const bond = (cusip: string, issuer: string, principal: number, value: number): Holding => ({
  issuer, cusip, titleOfClass: "BOND", value, amount: principal, amountType: "PRN", type: "share",
});
const call = (cusip: string, issuer: string, under: number, value: number): Holding => ({
  issuer, cusip, titleOfClass: "OPTION", value, amount: under, amountType: "SH", type: "call",
});

/** Run enrichment with a stubbed OpenFIGI, so the join is tested without a
 *  network and without pinning live vendor data into unit tests. */
async function withFigi(
  table: Record<string, { ticker: string; securityType: string; exchCode: string } | null>,
  run: () => Promise<void>
) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
    const jobs = JSON.parse(String(init?.body ?? "[]")) as { idValue: string }[];
    const body = jobs.map((j) => {
      const hit = table[j.idValue];
      return hit ? { data: [{ ...hit, figi: "BBG" + j.idValue }] } : { warning: "No identifier found." };
    });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = real;
  }
}

describe("choosing the identifier that represents a position", () => {
  it("prefers the share line", () => {
    const c = canonicalIdentifierFor({ cusip: "67066G104", debtCusip: "67066GAA1" });
    expect(c).toEqual({ identifier: "67066G104", basis: "share" });
  });

  it("falls back to the debt line when there is no equity", () => {
    // JPMorgan holds IREN convertible notes under 46270C with no IREN equity
    // under that prefix. A debt-only position is real and should resolve to
    // the bond rather than disappear.
    const c = canonicalIdentifierFor({ cusip: null, debtCusip: "46270CAB5" });
    expect(c).toEqual({ identifier: "46270CAB5", basis: "debt" });
  });

  it("returns nothing for an options-only position", () => {
    // The guard that matters. Option CUSIPs are built from the underlying's, so
    // an options-only row must not borrow the underlying's identity.
    expect(canonicalIdentifierFor({ cusip: null, debtCusip: null })).toBeNull();
  });
});

describe("enriching positions", () => {
  it("resolves an ordinary CUSIP to its ticker", async () => {
    await withFigi(
      { "67066G104": { ticker: "NVDA", securityType: "Common Stock", exchCode: "US" } },
      async () => {
        const [p] = await enrichPositions(
          positionsByIssuer([share("67066G104", "NVIDIA CORPORATION", 100, 19_497)])
        );
        expect(p!.ticker).toBe("NVDA");
        expect(p!.instrumentType).toBe("equity");
        expect(p!.identityBasis).toBe("share");
        expect(p!.resolvedVia).toBe("cusip");
      }
    );
  });

  it("resolves a CINS through the fallback, and records that it did", async () => {
    // G7997R103 is Seagate. ID_CUSIP does not resolve CINS identifiers; the
    // second pass does. The ticker is STX — which this app already had to
    // disambiguate from the Stacks token, and which no name match could.
    let cusipCalls = 0;
    const real = globalThis.fetch;
    globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
      const parsed = JSON.parse(String(init?.body ?? "[]")) as { idType: string; idValue: string }[];
      if (parsed[0]?.idType === "ID_CUSIP") {
        cusipCalls++;
        return new Response(JSON.stringify(parsed.map(() => ({ warning: "No identifier found." }))), { status: 200 });
      }
      return new Response(
        JSON.stringify(parsed.map(() => ({ data: [{ ticker: "STX", securityType: "Common Stock", exchCode: "US", figi: "BBG1" }] }))),
        { status: 200 }
      );
    }) as unknown as typeof fetch;
    try {
      const [p] = await enrichPositions(
        positionsByIssuer([share("G7997R103", "SEAGATE TECHNOLOGY HLDNGS PL", 10, 336)])
      );
      expect(cusipCalls).toBe(1);
      expect(p!.ticker).toBe("STX");
      expect(p!.resolvedVia).toBe("cins");
      expect(p!.instrumentType).toBe("equity");
    } finally {
      globalThis.fetch = real;
    }
  });

  it("leaves an unresolvable identifier with a null ticker", async () => {
    await withFigi({}, async () => {
      const [p] = await enrichPositions(
        positionsByIssuer([share("999999999", "SOMETHING PRIVATE", 5, 100)])
      );
      // Not the issuer name, not a guess, not the closest match.
      expect(p!.ticker).toBeNull();
      expect(p!.instrumentType).toBeNull();
      expect(p!.identifier).toBe("999999999");
    });
  });

  it("never resolves an options-only position to the underlying", async () => {
    // The underlying IS resolvable and IS in the table. The position still must
    // not acquire its ticker, because the filing reports no shares.
    await withFigi(
      { "46438R105": { ticker: "ETHA", securityType: "ETP", exchCode: "US" } },
      async () => {
        const [p] = await enrichPositions(
          positionsByIssuer([call("46438R905", "ISHARES ETHEREUM TR", 600_000, 7_344_000)])
        );
        expect(p!.shares).toBe(0);
        expect(p!.callShares).toBe(600_000);
        expect(p!.ticker).toBeNull();
        expect(p!.identityBasis).toBe("none");
        expect(marketDataTargetFor(p!)).toBeNull();
      }
    );
  });

  it("keeps an issuer's equity and its debt as different instruments", async () => {
    // Strategy Inc: 594972408 is the common stock, 594972AJ0 is a convertible
    // note on TRACE. Same issuer prefix, two instruments, and only one of them
    // is what a reader means by "MSTR".
    await withFigi(
      {
        "594972408": { ticker: "MSTR", securityType: "Common Stock", exchCode: "US" },
        "594972AJ0": { ticker: "MSTR 0.625 03/15/30", securityType: "US DOMESTIC", exchCode: "TRACE" },
      },
      async () => {
        const equity = positionsByIssuer([share("594972408", "STRATEGY INC", 624_387, 57_868_282)]);
        const debtOnly = positionsByIssuer([bond("594972AJ0", "STRATEGY INC", 3_200_000, 2_817_868)]);
        const [eq] = await enrichPositions(equity);
        const [db] = await enrichPositions(debtOnly);

        expect(eq!.ticker).toBe("MSTR");
        expect(eq!.instrumentType).toBe("equity");
        expect(marketDataTargetFor(eq!)).toEqual({ ticker: "MSTR", kind: "stock" });

        expect(db!.identityBasis).toBe("debt");
        expect(db!.instrumentType).toBe("bond");
        expect(db!.ticker).not.toBe("MSTR");
        // A bond is not priced as the common. Null, not the equity's quote.
        expect(marketDataTargetFor(db!)).toBeNull();
      }
    );
  });

  it("collapses rows only when the canonical identity is genuinely the same", async () => {
    // Three issuers whose names all contain "IREN" and which are not the same
    // company. Aggregation is on the identifier, so they stay three.
    await withFigi(
      {
        "Q4982L109": { ticker: "IREN", securityType: "Common Stock", exchCode: "US" },
        "G4939F107": { ticker: "IRAC", securityType: "Common Stock", exchCode: "US" },
        "98585L100": { ticker: "YRD", securityType: "ADR", exchCode: "US" },
      },
      async () => {
        const out = await enrichPositions(
          positionsByIssuer([
            share("Q4982L109", "IREN LIMITED", 2_699_785, 123_947_214),
            share("Q4982L109", "IREN LIMITED", 1, 46),
            share("G4939F107", "IRENIC ACQUISITION CORP", 122_730, 1_223_618),
            share("98585L100", "YIREN DIGITAL LTD", 415, 457),
          ])
        );
        expect(out).toHaveLength(3);
        const iren = out.find((p) => p.ticker === "IREN");
        // The two IREN rows share one identifier and are one position.
        expect(iren!.shares).toBe(2_699_786);
        expect(new Set(out.map((p) => p.ticker)).size).toBe(3);
      }
    );
  });
});

describe("the market-data adapter", () => {
  it("maps instruments onto the kind the existing provider takes", () => {
    expect(marketDataKindFor("equity")).toBe("stock");
    expect(marketDataKindFor("adr")).toBe("stock");
    expect(marketDataKindFor("reit")).toBe("stock");
    expect(marketDataKindFor("etp")).toBe("etf");
  });

  it("refuses to price debt, preferreds and unresolved securities as equity", () => {
    // Each of these has a price somewhere; none of them has the common's price.
    expect(marketDataKindFor("bond")).toBeNull();
    expect(marketDataKindFor("preferred")).toBeNull();
    expect(marketDataKindFor("other")).toBeNull();
    expect(marketDataKindFor(null)).toBeNull();
  });
});

describe("enrichment does not change the filing", () => {
  it("preserves every economic total on the real fixture", async () => {
    // The invariant that makes this layer safe: identity is additive. If any
    // total moves, enrichment has done arithmetic it had no business doing.
    const rows = parseInformationTable(XML);
    const before = positionsByIssuer(rows);

    const totals = (ps: readonly { shares: number; shareValue: number; debtValue: number; debtPrincipal: number; callValue: number; callShares: number; putValue: number; putShares: number }[]) =>
      ps.reduce(
        (a, p) => ({
          shares: a.shares + p.shares,
          shareValue: a.shareValue + p.shareValue,
          debtValue: a.debtValue + p.debtValue,
          debtPrincipal: a.debtPrincipal + p.debtPrincipal,
          callValue: a.callValue + p.callValue,
          callShares: a.callShares + p.callShares,
          putValue: a.putValue + p.putValue,
          putShares: a.putShares + p.putShares,
        }),
        { shares: 0, shareValue: 0, debtValue: 0, debtPrincipal: 0, callValue: 0, callShares: 0, putValue: 0, putShares: 0 }
      );

    let after: EnrichedPosition[] = [];
    await withFigi({}, async () => {
      after = await enrichPositions(before);
    });

    expect(after).toHaveLength(before.length);
    expect(totals(after)).toEqual(totals(before));

    // And the four buckets still reconcile to the filing's reported total.
    const o = optionTotals(rows);
    expect(shareTotal(rows) + debtTotal(rows) + o.callValue + o.putValue).toBe(reportedTotal(rows));
  });
});
