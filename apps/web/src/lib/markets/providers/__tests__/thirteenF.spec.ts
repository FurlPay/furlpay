import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseInformationTable,
  parsePrimaryDoc,
  positionsByIssuer,
  shareTotal,
  reportedTotal,
} from "../thirteenF";

// ---------------------------------------------------------------------------
// The fixture is REAL. Five rows lifted unmodified from JPMorgan's Q2 2026
// 13F-HR (CIK 0000019617, accession 0000019617-26-000325, period 2026-06-30) —
// a share line, a call, a put, and an issuer whose name carries an XML entity.
//
// Hand-written fixtures would defeat the purpose. Every failure this parser
// exists to prevent comes from the filings' actual shape: option rows that
// look like share rows, contracts that look like shares, and issuer names that
// break naive matching. A fixture invented to match the parser proves nothing.
// ---------------------------------------------------------------------------

const XML = readFileSync(join(__dirname, "fixtures", "jpm-13f-sample.xml"), "utf8");

describe("information table parsing", () => {
  const rows = parseInformationTable(XML);

  it("reads every row", () => {
    expect(rows).toHaveLength(5);
  });

  it("separates option rows from share rows", () => {
    // The single most consequential distinction in the whole format. A summary
    // that missed it reported an ETF position of "1.17M shares" for a manager
    // whose filing showed zero shares and 1.2M contracts.
    const byType = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.type] = (acc[r.type] ?? 0) + 1;
      return acc;
    }, {});
    expect(byType).toEqual({ share: 3, call: 1, put: 1 });
  });

  it("reads the real values exactly", () => {
    const nvda = rows.find((r) => r.issuer.startsWith("NVIDIA"))!;
    expect(nvda.value).toBe(11_889_466);
    expect(nvda.amount).toBe(60_981);
    expect(nvda.type).toBe("share");
    expect(nvda.amountType).toBe("SH");
  });

  it("decodes XML entities in issuer names", () => {
    // "JOHNSON &amp; JOHNSON" rendered raw would show the entity to a reader
    // and break any exact-name comparison.
    expect(rows.some((r) => r.issuer === "JOHNSON & JOHNSON")).toBe(true);
    expect(rows.every((r) => !r.issuer.includes("&amp;"))).toBe(true);
  });

  it("captures a CUSIP for every row", () => {
    for (const r of rows) expect(r.cusip).toMatch(/^[A-Z0-9]{9}$/);
  });

  it("never treats an unrecognised putCall as a share line", () => {
    const weird = XML.replace("<putCall>Call</putCall>", "<putCall>WARRANT</putCall>");
    const parsed = parseInformationTable(weird);
    // Anything not put/call is classified share ONLY when the field is absent.
    // A populated-but-unknown value is a derivative we do not model, and the
    // safe reading is "not a share", so it must not inflate the share total.
    const bitcoinShares = positionsByIssuer(parsed).find((p) => p.cusip6 === "46438F")!;
    expect(bitcoinShares.shares).toBe(341_532);
  });
});

describe("aggregation keeps shares and derivatives apart", () => {
  const rows = parseInformationTable(XML);
  const positions = positionsByIssuer(rows);

  it("collapses one issuer's three rows into one position", () => {
    const ibit = positions.find((p) => p.cusip6 === "46438F")!;
    expect(ibit.shares).toBe(341_532);
    expect(ibit.shareValue).toBe(11_673_582);
    expect(ibit.callContracts).toBe(3_945_000);
    expect(ibit.putContracts).toBe(3_495_800);
  });

  it("never folds notional into the share value", () => {
    // $11.6M of shares alongside $254M of option notional. Adding them makes
    // the position look 22x larger than the manager's actual share holding.
    const ibit = positions.find((p) => p.cusip6 === "46438F")!;
    expect(ibit.shareValue).toBeLessThan(ibit.callValue + ibit.putValue);
    expect(ibit.shareValue).toBe(11_673_582);
  });

  it("groups an option with the security it is written on", () => {
    // The rows carry DIFFERENT full CUSIPs: 46438F101 shares, 46438F901 call,
    // 46438F951 put. Keying on the full CUSIP would file the options as three
    // unrelated securities; the 6-character issuer prefix is what unites them.
    const ibit = positions.find((p) => p.cusip6 === "46438F")!;
    expect(ibit.cusip).toBe("46438F101");
    expect(ibit.callContracts).toBe(3_945_000);
    expect(positions).toHaveLength(3);
  });

  it("keys on CUSIP, not issuer name", () => {
    // Name matching is how "RIOT" finds MARRIOTT and "MARA" finds MARATHON
    // PETROLEUM — both real errors we made before switching to CUSIP.
    expect(new Set(positions.map((p) => p.cusip6)).size).toBe(positions.length);
  });

  it("totals differ by exactly the derivative notional", () => {
    const shares = shareTotal(rows);
    const all = reportedTotal(rows);
    const derivatives = rows
      .filter((r) => r.type !== "share")
      .reduce((s, r) => s + r.value, 0);
    expect(all - shares).toBe(derivatives);
    expect(shares).toBe(11_889_466 + 11_673_582 + 1_699_445);
  });

  it("sorts by share value so the largest real position leads", () => {
    const vals = positions.map((p) => p.shareValue);
    expect(vals).toEqual([...vals].sort((a, b) => b - a));
  });
});

describe("primary document parsing", () => {
  const PRIMARY = `<?xml version="1.0"?>
<edgarSubmission>
  <formData>
    <coverPage>
      <reportCalendarOrQuarter>06-30-2026</reportCalendarOrQuarter>
      <filingManager><name>JPMORGAN CHASE &amp; CO</name></filingManager>
      <otherManagers2Info>
        <otherManager2><otherManager><name>J.P. MORGAN SECURITIES LLC</name></otherManager></otherManager2>
        <otherManager2><otherManager><name>JPMORGAN INVESTMENT MANAGEMENT INC.</name></otherManager></otherManager2>
      </otherManagers2Info>
    </coverPage>
    <summaryPage>
      <tableEntryTotal>34064</tableEntryTotal>
      <tableValueTotal>1807041234839</tableValueTotal>
    </summaryPage>
  </formData>
</edgarSubmission>`;

  const meta = parsePrimaryDoc(PRIMARY);

  it("normalises the quarter to an ISO date", () => {
    // Filed as MM-DD-YYYY, which sorts and compares wrongly as a string.
    expect(meta.periodOfReport).toBe("2026-06-30");
  });

  it("reads the filer's own totals", () => {
    expect(meta.reportedValueTotal).toBe(1_807_041_234_839);
    expect(meta.reportedEntryTotal).toBe(34_064);
  });

  it("surfaces the other included managers", () => {
    // A large filer's 13F is a combination report covering many entities. A
    // surface that calls this "the bank's portfolio" is describing something
    // that does not exist, so the list has to travel with the data.
    expect(meta.otherIncludedManagers).toEqual([
      "J.P. MORGAN SECURITIES LLC",
      "JPMORGAN INVESTMENT MANAGEMENT INC.",
    ]);
  });

  it("decodes the manager name", () => {
    expect(meta.managerName).toBe("JPMORGAN CHASE & CO");
  });

  it("survives a filing with no other managers", () => {
    const solo = PRIMARY.replace(/<otherManagers2Info>[\s\S]*?<\/otherManagers2Info>/, "");
    expect(parsePrimaryDoc(solo).otherIncludedManagers).toEqual([]);
  });
});

describe("namespace tolerance", () => {
  it("parses prefixed tags", () => {
    // Filers vary: ns1:, n1:, or none at all. A parser that assumes one shape
    // silently returns zero holdings for the others.
    // The real fixture already carries ns1:. Strip the prefix to prove the
    // parser handles the unprefixed shape too.
    const prefixed = XML.replace(/ns1:/g, "");
    const rows = parseInformationTable(prefixed);
    expect(rows).toHaveLength(5);
    expect(rows.find((r) => r.issuer.startsWith("NVIDIA"))?.value).toBe(11_889_466);
  });

  it("returns nothing rather than guessing on unrelated XML", () => {
    expect(parseInformationTable("<html><body>not a filing</body></html>")).toEqual([]);
  });
});
