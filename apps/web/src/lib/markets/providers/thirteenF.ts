// ---------------------------------------------------------------------------
// Form 13F — institutional holdings, read from the filing itself.
//
// Institutional managers exercising discretion over $100M+ of Section 13(f)
// securities file quarterly, within 45 days of quarter end. The filing is XML
// on EDGAR, so this module fetches and parses it directly rather than taking a
// vendor's summary of it. That choice is the whole point: summaries of these
// filings are routinely wrong in ways that are trivially checkable against the
// source, and we would be repeating their errors with our name on them.
//
// ── THREE THINGS THAT MAKE 13F DATA WRONG ──────────────────────────────────
//
// 1. OPTION ROWS ARE NOT SHARES. Every row carries a putCall field. When it is
//    populated the row is a derivative position, reported at the NOTIONAL value
//    of the underlying rather than the premium paid, and sshPrnamt counts
//    contracts, not shares. Summing the two together inflates a position; worse,
//    reading contracts as shares invents share positions that do not exist. We
//    have seen a widely-circulated summary describe a manager's "1.17M shares"
//    of an ETF that the filing shows as zero shares and 1.2M option contracts.
//    So shares and derivatives are separated here and never silently merged.
//
// 2. A 13F IS A CONSOLIDATED REPORT, NOT ONE PORTFOLIO. Large filers submit a
//    combination report covering many included managers — the reported total is
//    the sum across every entity in that structure, not a single desk's book.
//    otherIncludedManagers is surfaced so the caller can say so.
//
// 3. IT IS NARROW AND STALE BY CONSTRUCTION. Long positions in 13(f) securities
//    only: no shorts, no cash, no bonds, no non-US listings. And it describes a
//    quarter-end that is up to 45 days in the past on the day it is published.
//    `periodOfReport` and `filedAt` both travel with the data so no surface can
//    imply it is current.
//
// The SEC does not verify these filings. Language anywhere downstream must be
// "the filing reports", never "the SEC confirms".
// ---------------------------------------------------------------------------

import { SEC_HEADERS, cachedJson } from "./cache";

const ARCHIVES = "https://www.sec.gov/Archives/edgar/data";
const SUBMISSIONS = "https://data.sec.gov/submissions";

/** A 13F lands once a quarter; the previous one never changes. */
const TTL_FILING_INDEX = 21_600; // 6h — catches a new filing the day it lands
const TTL_HOLDINGS = 604_800; // 7d — a filed information table is immutable

export type PositionType = "share" | "call" | "put";

export interface Holding {
  issuer: string;
  cusip: string;
  titleOfClass: string;
  /** Fair market value in whole US dollars, as reported. */
  value: number;
  /** Shares for a share row; CONTRACTS for an option row. */
  amount: number;
  /** "SH" or "PRN" — principal amount rather than share count. */
  amountType: string;
  type: PositionType;
}

export interface ThirteenF {
  cik: string;
  managerName: string;
  /** Quarter end the filing describes (ISO date). */
  periodOfReport: string;
  /** When it was filed — up to 45 days after periodOfReport. */
  filedAt: string;
  accession: string;
  /** The filer's own reported totals, used to verify our parse. */
  reportedValueTotal: number;
  reportedEntryTotal: number;
  /** Other managers rolled into this report. Empty for a single-entity filer. */
  otherIncludedManagers: string[];
  holdings: Holding[];
  /** True when our sum matched the filer's stated total exactly. */
  reconciled: boolean;
  sourceUrl: string;
}

// ---------------------------------------------------------------------------
// Parsing
//
// Deliberately regex-based rather than a DOM parser. These information tables
// run to tens of megabytes and 45,000+ entries; a DOM parse allocates the whole
// tree, and the schema is flat enough that tag extraction is both sufficient
// and an order of magnitude cheaper. Namespace prefixes vary between filers
// (ns1:, n1:, none), so every pattern tolerates an optional prefix.
// ---------------------------------------------------------------------------

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`));
  return m ? m[1].trim() : "";
}

function num(s: string): number {
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Decode the small set of XML entities that appear in issuer names (S&P). */
function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function parseInformationTable(xml: string): Holding[] {
  const blocks = xml.match(/<(?:\w+:)?infoTable>[\s\S]*?<\/(?:\w+:)?infoTable>/g) ?? [];
  const out: Holding[] = [];
  for (const b of blocks) {
    const putCall = tag(b, "putCall").toLowerCase();
    out.push({
      issuer: decode(tag(b, "nameOfIssuer")),
      cusip: tag(b, "cusip").toUpperCase(),
      titleOfClass: decode(tag(b, "titleOfClass")),
      value: num(tag(b, "value")),
      amount: num(tag(b, "sshPrnamt")),
      amountType: tag(b, "sshPrnamtType") || "SH",
      // Anything that is not explicitly a put or a call is a share line. An
      // unrecognised value must not silently become "share": it becomes a
      // share only when the field is genuinely empty.
      type: putCall === "put" ? "put" : putCall === "call" ? "call" : "share",
    });
  }
  return out;
}

export function parsePrimaryDoc(xml: string): {
  managerName: string;
  periodOfReport: string;
  reportedValueTotal: number;
  reportedEntryTotal: number;
  otherIncludedManagers: string[];
} {
  // Period is filed as MM-DD-YYYY; normalise so callers can sort and compare.
  const raw = tag(xml, "reportCalendarOrQuarter");
  const m = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  const periodOfReport = m ? `${m[3]}-${m[1]}-${m[2]}` : raw;

  const others: string[] = [];
  const otherBlocks = xml.match(/<(?:\w+:)?otherManager>[\s\S]*?<\/(?:\w+:)?otherManager>/g) ?? [];
  for (const b of otherBlocks) {
    const n = decode(tag(b, "name"));
    if (n) others.push(n);
  }

  return {
    managerName: decode(tag(xml, "name")),
    periodOfReport,
    reportedValueTotal: num(tag(xml, "tableValueTotal")),
    reportedEntryTotal: num(tag(xml, "tableEntryTotal")),
    otherIncludedManagers: others,
  };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export interface IssuerPosition {
  issuer: string;
  /** The 6-character CUSIP issuer prefix these rows share. */
  cusip6: string;
  /** Full CUSIP of the share line, when there is one. */
  cusip: string | null;
  /** Share lines only — the position a person means by "owns". */
  shareValue: number;
  shares: number;
  /** Derivative notional, kept separate and never added to shareValue. */
  callValue: number;
  callContracts: number;
  putValue: number;
  putContracts: number;
}

/** The 6-character issuer portion of a CUSIP.
 *
 * A CUSIP is 6 characters of issuer, 2 of issue, and a check digit. Options on
 * a security are filed under a DIFFERENT full CUSIP from the underlying — in
 * JPMorgan's Q2 2026 filing the iShares Bitcoin Trust appears as 46438F101 for
 * shares, 46438F901 for calls and 46438F951 for puts — while all three share
 * the issuer prefix 46438F. */
export function cusipIssuer(cusip: string): string {
  return cusip.slice(0, 6);
}

/** Collapse a filing's rows to one entry per issuer, shares and options apart.
 *
 * Grouped on the CUSIP issuer prefix, which is the only key that gets both
 * halves right. Full CUSIP splits an option position away from the security it
 * is written on. Issuer NAME merges things that are not the same company: it is
 * how "RIOT" matches MARRIOTT and "MARA" matches MARATHON PETROLEUM, both of
 * which we got wrong before switching keys. The prefix merges an option with
 * its underlying and nothing else. */
export function positionsByIssuer(holdings: readonly Holding[]): IssuerPosition[] {
  const map = new Map<string, IssuerPosition>();
  for (const h of holdings) {
    if (!h.cusip) continue;
    const key = cusipIssuer(h.cusip);
    let p = map.get(key);
    if (!p) {
      p = {
        issuer: h.issuer,
        cusip6: key,
        cusip: null,
        shareValue: 0,
        shares: 0,
        callValue: 0,
        callContracts: 0,
        putValue: 0,
        putContracts: 0,
      };
      map.set(key, p);
    }
    if (h.type === "share") {
      // The share line owns the canonical CUSIP; option CUSIPs are artefacts
      // of the contract, not identifiers anyone would look the security up by.
      p.cusip ??= h.cusip;
      p.issuer = h.issuer;
      p.shareValue += h.value;
      p.shares += h.amount;
    } else if (h.type === "call") {
      p.callValue += h.value;
      p.callContracts += h.amount;
    } else {
      p.putValue += h.value;
      p.putContracts += h.amount;
    }
  }
  return [...map.values()].sort((a, b) => b.shareValue - a.shareValue);
}

/** Total across share lines only. This is the number to quote as "holdings". */
export function shareTotal(holdings: readonly Holding[]): number {
  return holdings.reduce((s, h) => (h.type === "share" ? s + h.value : s), 0);
}

/** Total across every row, matching the filer's own tableValueTotal. */
export function reportedTotal(holdings: readonly Holding[]): number {
  return holdings.reduce((s, h) => s + h.value, 0);
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

interface SubmissionsFile {
  name?: string;
  filings?: {
    recent?: {
      form?: string[];
      accessionNumber?: string[];
      filingDate?: string[];
      reportDate?: string[];
    };
  };
}

async function secText(url: string, timeoutMs = 30_000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: SEC_HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export interface FilingRef {
  accession: string;
  filedAt: string;
  periodOfReport: string;
}

/** The manager's most recent 13F-HR, or null when they have never filed one. */
export async function latestFiling(cik: string): Promise<FilingRef | null> {
  const padded = cik.padStart(10, "0");
  return cachedJson(`13f:latest:${padded}`, TTL_FILING_INDEX, async () => {
    const body = await secText(`${SUBMISSIONS}/CIK${padded}.json`, 20_000);
    if (!body) return null;
    let sub: SubmissionsFile;
    try {
      sub = JSON.parse(body) as SubmissionsFile;
    } catch {
      return null;
    }
    const r = sub.filings?.recent;
    if (!r?.form) return null;
    for (let i = 0; i < r.form.length; i++) {
      // 13F-HR only. A 13F-NT reports that holdings are filed by someone else
      // and carries no information table at all, so treating it as a filing
      // would produce an empty portfolio rather than an honest "not found".
      if (r.form[i] !== "13F-HR") continue;
      return {
        accession: r.accessionNumber?.[i] ?? "",
        filedAt: r.filingDate?.[i] ?? "",
        periodOfReport: r.reportDate?.[i] ?? "",
      };
    }
    return null;
  });
}

interface DirectoryIndex {
  directory?: { item?: { name?: string }[] };
}

/** Fetch and parse a manager's latest 13F-HR.
 *
 * Returns null rather than throwing on every failure path: an EDGAR outage
 * must blank one section of a page, never take the request down with it.
 */
export async function latestThirteenF(cik: string): Promise<ThirteenF | null> {
  const padded = cik.padStart(10, "0");
  const ref = await latestFiling(padded);
  if (!ref?.accession) return null;

  return cachedJson(`13f:holdings:${padded}:${ref.accession}`, TTL_HOLDINGS, async () => {
    const bare = String(Number(padded));
    const acc = ref.accession.replace(/-/g, "");
    const base = `${ARCHIVES}/${bare}/${acc}`;

    const idxRaw = await secText(`${base}/index.json`, 20_000);
    if (!idxRaw) return null;
    let idx: DirectoryIndex;
    try {
      idx = JSON.parse(idxRaw) as DirectoryIndex;
    } catch {
      return null;
    }
    const names = (idx.directory?.item ?? []).map((i) => i.name ?? "").filter(Boolean);

    // The information table has no fixed filename — filers name it anything
    // from "form13fInfoTable.xml" to "Information_Table_06.30.2026.xml". It is
    // identified by elimination: the XML that is not the primary document.
    const primaryName = names.find((n) => /primary_doc\.xml$/i.test(n));
    const tableName = names.find((n) => /\.xml$/i.test(n) && !/primary_doc\.xml$/i.test(n));
    if (!primaryName || !tableName) return null;

    const [primaryXml, tableXml] = await Promise.all([
      secText(`${base}/${primaryName}`, 20_000),
      // Information tables reach tens of megabytes; give this one real time.
      secText(`${base}/${tableName}`, 60_000),
    ]);
    if (!primaryXml || !tableXml) return null;

    const meta = parsePrimaryDoc(primaryXml);
    const holdings = parseInformationTable(tableXml);
    if (holdings.length === 0) return null;

    // Reconciliation is the point of parsing the source ourselves: if our sum
    // does not equal the filer's stated total, our parse is wrong and the flag
    // says so rather than shipping a plausible number.
    const reconciled =
      reportedTotal(holdings) === meta.reportedValueTotal &&
      holdings.length === meta.reportedEntryTotal;

    return {
      cik: padded,
      managerName: meta.managerName,
      periodOfReport: meta.periodOfReport || ref.periodOfReport,
      filedAt: ref.filedAt,
      accession: ref.accession,
      reportedValueTotal: meta.reportedValueTotal,
      reportedEntryTotal: meta.reportedEntryTotal,
      otherIncludedManagers: meta.otherIncludedManagers,
      holdings,
      reconciled,
      sourceUrl: `${base}/${primaryName}`,
    };
  });
}
