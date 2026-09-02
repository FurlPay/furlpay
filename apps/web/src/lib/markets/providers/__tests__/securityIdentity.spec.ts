import { describe, it, expect } from "vitest";
import {
  classifyInstrument,
  resolveIdentifiers,
  FIGI_BATCH,
} from "../securityIdentity";

// ---------------------------------------------------------------------------
// The identity layer's job is to make issuer-name matching unnecessary. These
// tests pin the classification and the batching offline; the live coverage
// check at the bottom is opt-in.
// ---------------------------------------------------------------------------

describe("classifying an instrument", () => {
  it("separates equity from the things that are not equity", () => {
    // The three Strategy Inc identifiers in JPMorgan's Q2 2026 filing resolve
    // to three different instruments, which is the entire point: 594972408 is
    // the common stock a reader means by "MSTR", 594972887 is a perpetual
    // preferred, and 594972AJ0 is a convertible note quoted on TRACE.
    expect(classifyInstrument("Common Stock", "US")).toBe("equity");
    expect(classifyInstrument("PUBLIC", "NASDAQ/NGS")).toBe("other");
    expect(classifyInstrument("US DOMESTIC", "TRACE")).toBe("bond");
  });

  it("treats anything quoted on TRACE as debt whatever its type string says", () => {
    // TRACE is the bond reporting facility. The securityType strings on debt
    // are inconsistent ("US DOMESTIC", "GLOBAL"), the venue is not.
    expect(classifyInstrument("GLOBAL", "TRACE")).toBe("bond");
    expect(classifyInstrument("Common Stock", "TRACE")).toBe("bond");
  });

  it("recognises exchange-traded products", () => {
    // IBIT, ETHA, BSOL and GBTC all come back as ETP, and none of them is the
    // token it tracks.
    expect(classifyInstrument("ETP", "US")).toBe("etp");
    expect(classifyInstrument("Mutual Fund", "US")).toBe("etp");
  });

  it("recognises depositary receipts and REITs", () => {
    expect(classifyInstrument("ADR", "US")).toBe("adr");
    expect(classifyInstrument("REIT", "US")).toBe("reit");
    // ASML files as a New York registered share, which is an equity line.
    expect(classifyInstrument("NY Reg Shrs", "US")).toBe("equity");
  });

  it("falls back to 'other' rather than guessing equity", () => {
    // An unrecognised type must not default into the equity bucket, which is
    // the bucket every downstream screen reads.
    expect(classifyInstrument("SOMETHING NEW", "US")).toBe("other");
    expect(classifyInstrument("", null)).toBe("other");
  });
});

describe("resolving identifiers", () => {
  it("respects OpenFIGI's ten-job request limit", () => {
    // Exceeding it returns HTTP 413 and resolves nothing.
    expect(FIGI_BATCH).toBeLessThanOrEqual(10);
  });

  it("returns a null entry rather than dropping an unresolvable identifier", async () => {
    // Serving no network: every identifier must still appear in the map, with
    // null meaning "unresolved", so a caller cannot mistake absence for a miss
    // it never asked about.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    try {
      const out = await resolveIdentifiers(["46438R905", "67066G104"]);
      expect(out.size).toBe(2);
      expect(out.get("46438R905")).toBeNull();
      expect(out.get("67066G104")).toBeNull();
    } finally {
      globalThis.fetch = realFetch;
    }
  }, 30_000);

  it("normalises and de-duplicates the input", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    try {
      const out = await resolveIdentifiers([" 67066g104 ", "67066G104", ""]);
      // One security, however it was spelled, and no entry for the blank.
      expect(out.size).toBe(1);
      expect([...out.keys()]).toEqual(["67066G104"]);
    } finally {
      globalThis.fetch = realFetch;
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Live coverage. CHECK_FIGI=1 npx vitest run securityIdentity
// ---------------------------------------------------------------------------
const live = process.env.CHECK_FIGI === "1" ? describe : describe.skip;

live("against OpenFIGI", () => {
  it(
    "resolves CUSIPs and CINS identifiers, and refuses option CUSIPs",
    async () => {
      const out = await resolveIdentifiers([
        "67066G104", // NVIDIA — plain CUSIP
        "46438F101", // iShares Bitcoin Trust — ETP
        "46438R105", // iShares Ethereum Trust — ETP
        "17253J106", // Cipher Digital, the name search missed
        "594972408", // Strategy common
        "594972AJ0", // Strategy convertible note
        "G29183103", // Eaton, an Irish CINS
        "N07059210", // ASML, a Dutch CINS
        "Q4982L109", // IREN, the CINS that broke the earlier work
        "46438R905", // an option CUSIP — must NOT resolve
      ]);

      expect(out.get("67066G104")?.ticker).toBe("NVDA");
      expect(out.get("46438F101")?.ticker).toBe("IBIT");
      expect(out.get("46438R105")?.ticker).toBe("ETHA");
      expect(out.get("17253J106")?.ticker).toBe("CIFR");
      expect(out.get("594972408")?.ticker).toBe("MSTR");
      expect(out.get("594972408")?.instrument).toBe("equity");

      // The convertible note is not the common stock, and the resolver says so.
      expect(out.get("594972AJ0")?.instrument).toBe("bond");
      expect(out.get("594972AJ0")?.ticker).not.toBe("MSTR");

      // CINS identifiers, none of which ID_CUSIP alone resolves.
      expect(out.get("G29183103")?.ticker).toBe("ETN");
      expect(out.get("G29183103")?.via).toBe("cins");
      expect(out.get("N07059210")?.ticker).toBe("ASML");
      expect(out.get("Q4982L109")?.ticker).toBe("IREN");

      // A synthetic option CUSIP identifies no instrument. Resolving it to the
      // underlying would turn an option row into a share position.
      expect(out.get("46438R905")).toBeNull();

      // The ETFs are ETPs, never the assets they track.
      expect(out.get("46438F101")?.instrument).toBe("etp");
      expect(out.get("46438R105")?.instrument).toBe("etp");
    },
    180_000
  );

  it(
    "resolves Seagate to STX, the ticker this app already had to disambiguate",
    async () => {
      // G7997R103 is Seagate Technology Holdings plc. STX is also the ticker
      // for the Stacks token, which is the collision the catalog documents.
      // A CUSIP resolves it unambiguously; a name or ticker never could.
      const out = await resolveIdentifiers(["G7997R103"]);
      const stx = out.get("G7997R103");
      expect(stx?.ticker).toBe("STX");
      expect(stx?.instrument).toBe("equity");
      expect(stx?.via).toBe("cins");
    },
    120_000
  );
});
