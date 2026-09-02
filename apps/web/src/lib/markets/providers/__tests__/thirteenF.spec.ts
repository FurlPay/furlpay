import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseInformationTable,
  parsePrimaryDoc,
  positionsByIssuer,
  shareTotal,
  reportedTotal,
  latestFiling,
  detectValueUnit,
  toDollars,
  debtTotal,
  optionTotals,
  type Holding,
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
    expect(ibit.callShares).toBe(3_945_000);
    expect(ibit.putShares).toBe(3_495_800);
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
    expect(ibit.callShares).toBe(3_945_000);
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

// ---------------------------------------------------------------------------
// A notice for a later quarter means the holdings report is not current.
//
// The fixture is the real filing index for The Vanguard Group (CIK 0000102909),
// which stopped filing its own holdings report after 2025-12-31 and has filed
// 13F-NT for the two quarters since. Walking to the newest 13F-HR and stopping
// there returns a book that is three quarters old with nothing marking it, so
// the notice is carried back to the caller instead.
// ---------------------------------------------------------------------------
describe("a superseding notice", () => {
  const SUBMISSIONS = readFileSync(
    join(__dirname, "fixtures", "vanguard-submissions.json"),
    "utf8"
  );

  /** Serve one canned submissions body for any URL.
   *
   * Each case passes a DIFFERENT cik, because `latestFiling` caches on it —
   * reusing one key across cases replays the first case's answer whatever the
   * stub returns, which is how the last three of these first passed while
   * asserting nothing. */
  function withSubmissions(body: string, run: () => Promise<void>) {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(body, { status: 200 })) as unknown as typeof fetch;
    return run().finally(() => {
      globalThis.fetch = realFetch;
    });
  }

  it("reports the notice that covers a later quarter than the holdings", async () => {
    await withSubmissions(SUBMISSIONS, async () => {
      const ref = await latestFiling("0000102909");
      expect(ref).not.toBeNull();
      // The newest HOLDINGS report, not the newest filing.
      expect(ref?.periodOfReport).toBe("2025-12-31");
      expect(ref?.accession).toBe("0000102909-26-000031");
      // ...and the reason it is not the newest filing.
      expect(ref?.supersededBy).toEqual({
        form: "13F-NT",
        periodOfReport: "2026-06-30",
        filedAt: "2026-08-13",
      });
    });
  });

  it("leaves supersededBy null when the holdings report is the newest filing", async () => {
    // The same index with the two notices removed: the ordinary case, and the
    // one where a false "stale" badge would be its own kind of wrong.
    const parsed = JSON.parse(SUBMISSIONS) as {
      filings: { recent: Record<string, string[]> };
    };
    const r = parsed.filings.recent;
    for (const k of Object.keys(r)) r[k] = r[k].slice(2);

    await withSubmissions(JSON.stringify(parsed), async () => {
      const ref = await latestFiling("0000000002");
      expect(ref?.periodOfReport).toBe("2025-12-31");
      expect(ref?.supersededBy).toBeNull();
    });
  });

  it("does not treat a notice for the SAME quarter as superseding", async () => {
    // A manager can file both for one period — routine housekeeping, and no
    // statement at all about whether the holdings are current.
    const parsed = JSON.parse(SUBMISSIONS) as {
      filings: { recent: Record<string, string[]> };
    };
    const r = parsed.filings.recent;
    for (const k of Object.keys(r)) r[k] = r[k].slice(1);
    r.reportDate[0] = "2025-12-31"; // notice now covers the same quarter

    await withSubmissions(JSON.stringify(parsed), async () => {
      const ref = await latestFiling("0000000003");
      expect(ref?.periodOfReport).toBe("2025-12-31");
      expect(ref?.supersededBy).toBeNull();
    });
  });

  it("accepts an amended holdings report as a holdings report", async () => {
    // 13F-HR/A is the filer correcting their own numbers. Skipping it would
    // serve the superseded original in preference to the correction.
    const parsed = JSON.parse(SUBMISSIONS) as {
      filings: { recent: Record<string, string[]> };
    };
    const r = parsed.filings.recent;
    for (const k of Object.keys(r)) r[k] = r[k].slice(2);
    r.form[0] = "13F-HR/A";

    await withSubmissions(JSON.stringify(parsed), async () => {
      const ref = await latestFiling("0000000004");
      expect(ref?.accession).toBe("0000102909-26-000031");
      expect(ref?.periodOfReport).toBe("2025-12-31");
    });
  });

  it("returns null when the manager has only ever filed notices", async () => {
    const parsed = JSON.parse(SUBMISSIONS) as {
      filings: { recent: Record<string, string[]> };
    };
    const r = parsed.filings.recent;
    for (const k of Object.keys(r)) r[k] = r[k].slice(0, 2);

    await withSubmissions(JSON.stringify(parsed), async () => {
      // Honest absence. An empty portfolio would read as "holds nothing".
      expect(await latestFiling("0000000005")).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// An amendment is not automatically a portfolio.
//
// The fixture is Berkshire Hathaway's real 13F-HR/A for 2025-03-31 (accession
// 0000950123-25-008361): amendment number one, type NEW HOLDINGS, four entries
// totalling $1,106,550,356. Their actual book that quarter was around $259bn.
//
// The SEC's Form 13F FAQ is explicit that the two amendment kinds differ this
// way — a restatement "resubmit[s] your entire filing, as corrected", while an
// amendment adding holdings "must list only the holdings for which
// confidential treatment was denied", with totals "limited to the information
// contained in the amendment itself". Both arrive as form 13F-HR/A and are
// indistinguishable in the filing index.
// ---------------------------------------------------------------------------
describe("amendment types", () => {
  const AMENDMENT = readFileSync(
    join(__dirname, "fixtures", "brk-13fhra-new-holdings.xml"),
    "utf8"
  );

  it("reads a NEW HOLDINGS amendment as what it is", () => {
    const meta = parsePrimaryDoc(AMENDMENT);
    expect(meta.isAmendment).toBe(true);
    expect(meta.amendmentNo).toBe(1);
    expect(meta.amendmentType).toBe("NEW HOLDINGS");
    // Four entries. Anything that treats this as a portfolio has deleted 99.6%
    // of the manager's book and will reconcile perfectly while doing so.
    expect(meta.reportedEntryTotal).toBe(4);
    expect(meta.reportedValueTotal).toBe(1_106_550_356);
  });

  it("reads the confidential-omission flag the filer sets", () => {
    // False here, but the field is the filer's own statement that positions
    // are missing from the report. When true, no total on it is the whole book.
    expect(parsePrimaryDoc(AMENDMENT).isConfidentialOmitted).toBe(false);
  });

  it("does not call an ordinary report an amendment", () => {
    // A plain 13F-HR carries no amendment block at all, and absence must read
    // as "not an amendment" rather than as an unknown one.
    const plain = `<?xml version="1.0"?>
<edgarSubmission><formData>
  <coverPage>
    <reportCalendarOrQuarter>06-30-2026</reportCalendarOrQuarter>
    <filingManager><name>BERKSHIRE HATHAWAY INC</name></filingManager>
  </coverPage>
  <summaryPage>
    <tableEntryTotal>114</tableEntryTotal>
    <tableValueTotal>257521776925</tableValueTotal>
    <isConfidentialOmitted>false</isConfidentialOmitted>
  </summaryPage>
</formData></edgarSubmission>`;
    const meta = parsePrimaryDoc(plain);
    expect(meta.isAmendment).toBe(false);
    expect(meta.amendmentType).toBeNull();
    expect(meta.amendmentNo).toBeNull();
  });

  it("treats an unreadable amendment type as partial, not as a restatement", () => {
    // The two mistakes are not symmetric. Guessing "restatement" on an
    // amendment we cannot classify swaps a portfolio for a fragment; guessing
    // "partial" costs one extra fetch and shows the correct book.
    const mangled = AMENDMENT.replace(
      /<amendmentType>[^<]*<\/amendmentType>/,
      "<amendmentType>SOMETHING NEW</amendmentType>"
    );
    expect(parsePrimaryDoc(mangled).amendmentType).toBe("UNKNOWN");
  });
});

// ---------------------------------------------------------------------------
// Dollars or thousands.
//
// The SEC has required whole dollars since January 2023 and filers still submit
// in thousands, with nothing in the form to say which. Measured across this
// app's 35 registered filers on 2026-09-02: 33 produced a median implied price
// per share between $22.27 and $357.37, and two — Baupost and Duquesne — came
// in at $0.127 and $0.089. Reading those two as dollars reports a $5.2bn book
// as $5.2m.
// ---------------------------------------------------------------------------
describe("value units", () => {
  const share = (value: number, amount: number): Holding => ({
    issuer: "X",
    cusip: "000000000",
    titleOfClass: "COM",
    value,
    amount,
    amountType: "SH",
    type: "share",
  });

  it("reads an ordinary dollar-denominated filing as dollars", () => {
    // Berkshire's real implied prices: Apple $289.36, Coca-Cola $81.27.
    const rows = [
      share(23_341_172_315, 80_664_820),
      share(22_976_876_186, 282_722_729),
      share(17_595_909_185, 308_808_515),
      ...Array.from({ length: 6 }, () => share(1_000_000, 10_000)), // $100/sh
    ];
    const u = detectValueUnit(rows);
    expect(u.unit).toBe("dollars");
    expect(u.medianPricePerShare).toBeGreaterThan(1);
  });

  it("detects a thousands-denominated filing", () => {
    // Duquesne's real rows: Amazon 541,600 shares at a stated 129,085.
    const rows = [
      share(129_085, 541_600),
      share(281_613, 589_680),
      share(151_900, 1_424_690),
      share(142_726, 3_138_897),
      share(864_923, 3_186_306),
      share(232_375, 3_102_880),
      share(50_000, 500_000),
      share(60_000, 600_000),
    ];
    const u = detectValueUnit(rows);
    expect(u.unit).toBe("thousands");
    expect(u.medianPricePerShare).toBeLessThan(1);
  });

  it("restates a thousands filing into whole dollars, and leaves shares alone", () => {
    const rows = [share(129_085, 541_600)];
    const [out] = toDollars(rows, "thousands");
    expect(out!.value).toBe(129_085_000);
    // The share count was never in thousands. Scaling it too would be a second
    // and larger error than the one being corrected.
    expect(out!.amount).toBe(541_600);
  });

  it("leaves a dollar filing untouched", () => {
    const rows = [share(23_341_172_315, 80_664_820)];
    expect(toDollars(rows, "dollars")[0]!.value).toBe(23_341_172_315);
  });

  it("ignores option rows when inferring the unit", () => {
    // sshPrnamt counts CONTRACTS on an option row and value is the notional of
    // the underlying, so value/amount is not a price and would skew the median.
    const opts: Holding[] = Array.from({ length: 20 }, () => ({
      issuer: "X", cusip: "000000000", titleOfClass: "CALL",
      value: 1_000_000, amount: 50_000_000, amountType: "SH", type: "call",
    }));
    const rows = [...opts, ...Array.from({ length: 8 }, () => share(1_000_000, 10_000))];
    expect(detectValueUnit(rows).unit).toBe("dollars");
    expect(detectValueUnit(rows).sampled).toBe(8);
  });

  it("does not guess from too small a sample", () => {
    // A handful of penny-priced rows is not evidence about a whole filing, and
    // dollars is the mandated unit — so ambiguity resolves there.
    const u = detectValueUnit([share(1, 1000), share(2, 3000)]);
    expect(u.unit).toBe("dollars");
    expect(u.medianPricePerShare).toBeNull();
  });

  it("is not fooled by a minority of genuinely penny-priced rows", () => {
    // Warrants, rights and units really do imply prices in cents. A median over
    // the whole filing is unmoved by them; a mean would not be.
    const rows = [
      ...Array.from({ length: 4 }, () => share(1_000, 100_000)), // $0.01/sh
      ...Array.from({ length: 10 }, () => share(5_000_000, 50_000)), // $100/sh
    ];
    expect(detectValueUnit(rows).unit).toBe("dollars");
  });
});

// ---------------------------------------------------------------------------
// An option row is denominated in the UNDERLYING security.
//
// This is the check that would have caught a wrong assumption this module
// shipped with, and that a blog post repeated: that an option row's amount is a
// count of contracts. Per the SEC's Form 13F FAQ on Column 5, "most of the
// column entries for an option refer to the underlying security, rather than to
// the option itself", and the filings agree — value divided by amount is the
// same price on an option row as on the issuer's share row.
//
// If the amount were a contract count, the implied price would come out ~100x
// the share row's. Across JPMorgan's Q2 2026 filing, 869 issuers carry both
// kinds of row and not one shows that ratio.
// ---------------------------------------------------------------------------
describe("option rows describe the underlying", () => {
  it("implies the same price per unit as the issuer's share rows", () => {
    const rows = parseInformationTable(XML);
    const [ibit] = positionsByIssuer(rows).filter((p) => p.shares > 0 && p.callShares > 0);
    expect(ibit).toBeDefined();
    if (!ibit) return;
    const sharePx = ibit.shareValue / ibit.shares;
    const callPx = ibit.callValue / ibit.callShares;
    // Equal to the cent. A contract count would put callPx near 100x sharePx.
    expect(callPx).toBeCloseTo(sharePx, 2);
    expect(callPx / sharePx).toBeGreaterThan(0.5);
    expect(callPx / sharePx).toBeLessThan(2);
  });

  it("never folds underlying-share counts into the share position", () => {
    // A right over shares is not ownership of them. The share count must come
    // from share rows alone, whatever the option lines carry.
    const rows = parseInformationTable(XML);
    const [ibit] = positionsByIssuer(rows).filter((p) => p.callShares > 0);
    expect(ibit).toBeDefined();
    if (!ibit) return;
    const shareRowTotal = rows
      .filter((r) => r.type === "share" && r.cusip.startsWith(ibit.cusip6))
      .reduce((s, r) => s + r.amount, 0);
    expect(ibit.shares).toBe(shareRowTotal);
  });
});

// ---------------------------------------------------------------------------
// Convertible debt is not equity, and PRN is not a share count.
//
// sshPrnamtType is SH for shares and PRN for a principal amount. Convertible
// bonds sit on the same information table as stock, and because they are not
// options, every "is this an option?" test waves them straight into the share
// bucket. JPMorgan's Q2 2026 filing carries 447 such rows worth $1,724,173,261.
// IREN alone reports $1,294,000 of principal that reads as 1.29m extra
// "shares" if the type field is ignored — which is how this article's first
// draft reported IREN at 3,993,785 shares instead of 2,699,785.
// ---------------------------------------------------------------------------
describe("principal amounts are not shares", () => {
  const bond = (value: number, principal: number): Holding => ({
    issuer: "IREN LIMITED", cusip: "46270CAB5", titleOfClass: "BOND",
    value, amount: principal, amountType: "PRN", type: "share",
  });
  const stock = (value: number, shares: number): Holding => ({
    issuer: "IREN LIMITED", cusip: "46270C109", titleOfClass: "COMMON",
    value, amount: shares, amountType: "SH", type: "share",
  });

  it("keeps debt principal out of the share count", () => {
    const [p] = positionsByIssuer([stock(123_947_214, 2_699_785), bond(4_080_452, 1_294_000)]);
    expect(p).toBeDefined();
    if (!p) return;
    expect(p.shares).toBe(2_699_785);
    expect(p.shareValue).toBe(123_947_214);
    expect(p.debtPrincipal).toBe(1_294_000);
    expect(p.debtValue).toBe(4_080_452);
  });

  it("excludes debt from the share total but still counts it as money", () => {
    const rows = [stock(123_947_214, 2_699_785), bond(4_080_452, 1_294_000)];
    expect(shareTotal(rows)).toBe(123_947_214);
    expect(debtTotal(rows)).toBe(4_080_452);
    // Both are real reported value; the point is that they are different kinds.
    expect(reportedTotal(rows)).toBe(128_027_666);
  });

  it("does not let a bond's price-per-dollar skew the unit inference", () => {
    // A bond trades near par, so value/principal is about 1 — squarely under
    // the $1 threshold that means "this filing is denominated in thousands".
    // Enough of them would flip a dollar filing to thousands and divide a real
    // book by a thousand.
    const rows = [
      ...Array.from({ length: 12 }, () => bond(1_000_000, 1_010_000)),
      ...Array.from({ length: 10 }, () => stock(5_000_000, 50_000)), // $100/sh
    ];
    expect(detectValueUnit(rows).unit).toBe("dollars");
    expect(detectValueUnit(rows).sampled).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// The classification identity.
//
// Every row in an information table is exactly one of four things: an ordinary
// share line, a principal amount of debt, a long call, or a long put. If the
// classification is right, those four buckets sum to the filer's own stated
// total — and if any row is being counted twice or dropped, they do not.
//
// This is the check that would have caught BOTH downstream bugs at once. It is
// stronger than testing each bucket separately, because a row miscounted from
// one bucket into another leaves each individual total looking plausible.
// ---------------------------------------------------------------------------
describe("every row lands in exactly one bucket", () => {
  it("shares + debt + calls + puts equals the reported total", () => {
    const rows = parseInformationTable(XML);
    const opts = optionTotals(rows);
    const sum = shareTotal(rows) + debtTotal(rows) + opts.callValue + opts.putValue;
    expect(sum).toBe(reportedTotal(rows));
  });

  it("holds when debt is present", () => {
    // The fixture has no PRN row, so the identity is proved on one built to
    // contain all four kinds at once.
    const mixed: Holding[] = [
      { issuer: "A", cusip: "111111101", titleOfClass: "COMMON", value: 1000, amount: 10, amountType: "SH", type: "share" },
      { issuer: "A", cusip: "111111AB5", titleOfClass: "BOND", value: 500, amount: 400, amountType: "PRN", type: "share" },
      { issuer: "A", cusip: "111111901", titleOfClass: "OPTION", value: 300, amount: 3, amountType: "SH", type: "call" },
      { issuer: "A", cusip: "111111951", titleOfClass: "OPTION", value: 200, amount: 2, amountType: "SH", type: "put" },
    ];
    const o = optionTotals(mixed);
    expect(shareTotal(mixed)).toBe(1000);
    expect(debtTotal(mixed)).toBe(500);
    expect(o.callValue).toBe(300);
    expect(o.putValue).toBe(200);
    expect(shareTotal(mixed) + debtTotal(mixed) + o.callValue + o.putValue).toBe(reportedTotal(mixed));
  });

  it("keeps an issuer's debt, equity and options on one issuer row without merging them", () => {
    // Same issuer prefix 111111, four different full CUSIPs. They belong to one
    // issuer and to four different instruments, and both facts must survive.
    const mixed: Holding[] = [
      { issuer: "A", cusip: "111111101", titleOfClass: "COMMON", value: 1000, amount: 10, amountType: "SH", type: "share" },
      { issuer: "A", cusip: "111111AB5", titleOfClass: "BOND", value: 500, amount: 400, amountType: "PRN", type: "share" },
      { issuer: "A", cusip: "111111901", titleOfClass: "OPTION", value: 300, amount: 3, amountType: "SH", type: "call" },
    ];
    const [p] = positionsByIssuer(mixed);
    expect(p).toBeDefined();
    if (!p) return;
    expect(p.shares).toBe(10);
    expect(p.debtPrincipal).toBe(400);
    expect(p.callShares).toBe(3);
    // The canonical CUSIP is the share line's, never the bond's or the option's.
    expect(p.cusip).toBe("111111101");
  });

  it("does not merge two issuers that merely share a name fragment", () => {
    // IREN LIMITED, IRENIC ACQUISITION CORP and YIREN DIGITAL LTD all appear in
    // JPMorgan's filing and all match a substring search for "IREN". Only the
    // identifier separates them.
    const rows: Holding[] = [
      { issuer: "IREN LIMITED", cusip: "Q4982L109", titleOfClass: "COMMON", value: 123_947_214, amount: 2_699_785, amountType: "SH", type: "share" },
      { issuer: "IRENIC ACQUISITION CORP", cusip: "G4939F107", titleOfClass: "COMMON", value: 1_223_618, amount: 122_730, amountType: "SH", type: "share" },
      { issuer: "YIREN DIGITAL LTD", cusip: "98585L100", titleOfClass: "ADR", value: 457, amount: 415, amountType: "SH", type: "share" },
    ];
    const out = positionsByIssuer(rows);
    expect(out).toHaveLength(3);
    expect(out[0]!.shares).toBe(2_699_785);
    expect(out[0]!.shareValue).toBe(123_947_214);
  });
});

// ---------------------------------------------------------------------------
// Quarter-over-quarter change.
//
// A single filing says what was held. Two filings say what was done, and only
// the second is behaviour. The classification is decided on the SHARE count,
// never on value, because value moves when the price moves — ARK's AMD line
// between Q1 and Q2 2026 has a share count DOWN 1,296,411 and a reported value
// UP $270,950,159, and calling that "added" would report a price rally as a
// purchase.
// ---------------------------------------------------------------------------
describe("classifying a position change", () => {
  const pos = (cusip6: string, shares: number, value: number): Holding => ({
    issuer: "A", cusip: cusip6 + "101", titleOfClass: "COMMON",
    value, amount: shares, amountType: "SH", type: "share",
  });

  /** The pure half of quarterComparison: how a pair of positions is labelled. */
  const classify = (before: number, after: number) =>
    before === 0 && after > 0 ? "new"
      : after === 0 && before > 0 ? "exited"
        : after > before ? "added"
          : after < before ? "reduced"
            : "unchanged";

  it("labels the four kinds of move on the share count", () => {
    expect(classify(0, 100)).toBe("new");
    expect(classify(100, 0)).toBe("exited");
    expect(classify(100, 150)).toBe("added");
    expect(classify(150, 100)).toBe("reduced");
    expect(classify(100, 100)).toBe("unchanged");
  });

  it("calls a share reduction 'reduced' even when its value rose", () => {
    // The real case: ARK held fewer AMD shares at 30 June than at 31 March and
    // the line was worth more, because AMD rallied. Value-based classification
    // would report that as buying.
    const before = positionsByIssuer([pos("007903", 5_000_000, 2_000_000_000)])[0]!;
    const after = positionsByIssuer([pos("007903", 3_703_589, 2_270_950_159)])[0]!;
    expect(after.shareValue).toBeGreaterThan(before.shareValue);
    expect(classify(before.shares, after.shares)).toBe("reduced");
  });

  it("reports no percentage change when there was no prior position", () => {
    // A new position is not an infinite percentage increase. Null forces the
    // caller to render "new" rather than a number.
    const pct = (b: number, change: number) => (b > 0 ? (change / b) * 100 : null);
    expect(pct(0, 1_169_431)).toBeNull();
    expect(pct(266_734, 902_697)).toBeCloseTo(338.43, 1);
  });

  it("separates a share delta from a value delta", () => {
    // IBIT, Q1 to Q2 2026: shares +25.4%, reported value +13.7%, because the
    // ETF's quarter-end price fell. One number is a decision, the other is a
    // decision plus a price move.
    const sharePct = ((10_407_635 - 8_302_691) / 8_302_691) * 100;
    const valuePct = ((355_732_983 - 312_845_416) / 312_845_416) * 100;
    expect(sharePct).toBeCloseTo(25.35, 1);
    expect(valuePct).toBeCloseTo(13.71, 1);
    expect(sharePct).toBeGreaterThan(valuePct);
  });
});
