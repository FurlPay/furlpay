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

/**
 * Schema version, baked into every cache key. Bump it whenever the SHAPE of a
 * cached value changes.
 *
 * The filing data is immutable, so the cache holds it for a week — which means
 * a deploy that adds a field keeps serving weeks-old objects without it. The
 * symptom is not a missing field; it is `filing.partialAmendments.length`
 * throwing on a page that typechecked perfectly, for as long as the TTL runs.
 * Observed exactly that way: two filers cached before this field existed came
 * back shaped like the old code while a third, fetched fresh, was correct.
 *
 * A version in the key makes a shape change a cache miss instead of a
 * type-safe lie.
 */
const SCHEMA = "v2";

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
  /** "13F-HR", or "13F-HR/A" when the complete report is itself a restatement. */
  form: string;
  isAmendment: boolean;
  amendmentNo: number | null;
  /**
   * The filer states this report omits holdings for which they requested
   * confidential treatment. The filing is then incomplete by design, and no
   * total on it is the manager's whole book — those positions appear on a
   * later amendment, sometimes quarters later.
   */
  confidentialOmitted: boolean;
  /**
   * Amendments filed AFTER this report that add holdings rather than restate
   * them — typically positions released from confidential treatment. They are
   * not merged into `holdings`: merging would produce a total that is ours
   * rather than the filer's and would break reconciliation. Newest first.
   */
  partialAmendments: PartialAmendment[];
  /**
   * Set when this manager has since filed a 13F-NT for a LATER quarter, i.e.
   * the holdings below are not their most recent word. A surface that shows
   * this data must say so; see `SupersedingNotice`.
   */
  supersededBy: SupersedingNotice | null;
  sourceUrl: string;
}

/** An amendment that adds holdings rather than restating the report. */
export interface PartialAmendment {
  accession: string;
  filedAt: string;
  periodOfReport: string;
  amendmentType: AmendmentType;
  amendmentNo: number | null;
  /** Rows the amendment itself carries — NOT a portfolio size. */
  entries: number;
  /** Value of those rows only. */
  value: number;
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

/** How an amendment relates to the report it amends.
 *
 * The distinction is not cosmetic and it is not optional. Per the SEC's own
 * Form 13F FAQ, a RESTATEMENT "resubmit[s] your entire filing, as corrected",
 * while an amendment adding new holdings "must list ONLY the holdings for
 * which confidential treatment was denied" — and its entry and value totals
 * are "limited to the information contained in the amendment itself".
 *
 * So the two look identical in the filing index and differ by orders of
 * magnitude in meaning. Berkshire Hathaway's 13F-HR/A for 2025-03-31
 * (accession 0000950123-25-008361) is a NEW HOLDINGS amendment reporting FOUR
 * entries totalling $1,106,550,356. Their actual book that quarter was around
 * $259bn. Treating that amendment as a portfolio does not produce a slightly
 * wrong number; it produces a different company. */
export type AmendmentType = "RESTATEMENT" | "NEW HOLDINGS" | "UNKNOWN";

export function parsePrimaryDoc(xml: string): {
  managerName: string;
  periodOfReport: string;
  reportedValueTotal: number;
  reportedEntryTotal: number;
  otherIncludedManagers: string[];
  isAmendment: boolean;
  amendmentNo: number | null;
  amendmentType: AmendmentType | null;
  /** The filer's own answer to "does this report omit positions for which we
   *  requested confidential treatment?" A true here means the filing is
   *  incomplete BY DESIGN and no total on it is the whole book. */
  isConfidentialOmitted: boolean;
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

  const isAmendment = /^true$/i.test(tag(xml, "isAmendment"));
  const rawType = tag(xml, "amendmentType").toUpperCase();
  const amendmentNo = isAmendment ? num(tag(xml, "amendmentNo")) || null : null;

  return {
    managerName: decode(tag(xml, "name")),
    periodOfReport,
    reportedValueTotal: num(tag(xml, "tableValueTotal")),
    reportedEntryTotal: num(tag(xml, "tableEntryTotal")),
    otherIncludedManagers: others,
    isAmendment,
    amendmentNo,
    // An amendment whose type we cannot read is UNKNOWN rather than assumed to
    // be a restatement. The assumption is the dangerous direction: it would
    // let a four-line confidential-treatment amendment through as a portfolio.
    amendmentType: !isAmendment
      ? null
      : rawType === "RESTATEMENT"
        ? "RESTATEMENT"
        : rawType === "NEW HOLDINGS"
          ? "NEW HOLDINGS"
          : "UNKNOWN",
    isConfidentialOmitted: /^true$/i.test(tag(xml, "isConfidentialOmitted")),
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

/** A notice filing that covers a LATER quarter than the holdings we found. */
export interface SupersedingNotice {
  /** "13F-NT", or "13F-NT/A" for an amended notice. */
  form: string;
  periodOfReport: string;
  filedAt: string;
}

export interface FilingRef {
  /** "13F-HR" or "13F-HR/A". */
  form: string;
  accession: string;
  filedAt: string;
  periodOfReport: string;
  /**
   * Set when the manager's most recent 13F is a NOTICE for a later quarter
   * than the holdings report we are about to return.
   *
   * A 13F-NT says "our holdings are reported on someone else's filing". It has
   * no information table, so it cannot be shown as a portfolio — but ignoring
   * it entirely is worse than it sounds. The Vanguard Group (CIK 0000102909)
   * filed 13F-NT for both 2026-03-31 and 2026-06-30 after restructuring its
   * reporting onto subsidiary advisers; scanning for the newest 13F-HR and
   * stopping there returns their 2025-12-31 book and nothing anywhere says it
   * is three quarters stale.
   *
   * Null is the ordinary case: the newest 13F is the holdings report itself.
   */
  supersededBy: SupersedingNotice | null;
}

/** Every holdings-bearing 13F for this manager, newest first.
 *
 * "Holdings-bearing" means 13F-HR or 13F-HR/A. Which of those actually carries
 * a complete portfolio cannot be decided here: the amendment type lives inside
 * primary_doc.xml, not in the filing index, so it costs a fetch to learn. This
 * returns the candidates and `latestThirteenF` walks them.
 *
 * Capped, because the caller only ever needs the newest complete report and a
 * manager with 60 quarters of history should not produce a 60-element array to
 * find it. */
async function holdingsFilings(cik: string, max = 6): Promise<FilingRef[]> {
  const one = await latestFilingChain(cik);
  return one.slice(0, max);
}

/** The manager's most recent holdings report, or null when they have none.
 *
 * `recent` is ordered newest first, so the first 13F-HR encountered is the
 * latest one. Any 13F-NT seen BEFORE it is therefore for a later quarter, and
 * is reported back through `supersededBy` rather than skipped in silence. */
export async function latestFiling(cik: string): Promise<FilingRef | null> {
  return (await latestFilingChain(cik))[0] ?? null;
}

async function latestFilingChain(cik: string): Promise<FilingRef[]> {
  const padded = cik.padStart(10, "0");
  const chain = await cachedJson<FilingRef[]>(
    `13f:${SCHEMA}:chain:${padded}`,
    TTL_FILING_INDEX,
    async () => {
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

      // The newest notice seen while walking towards the newest holdings
      // report. Only the first one matters: it is the newest by construction.
      let notice: SupersedingNotice | null = null;
      const out: FilingRef[] = [];

      for (let i = 0; i < r.form.length; i++) {
        const form = r.form[i] ?? "";

        // 13F-NT and 13F-NT/A carry no information table. Remember the first
        // (newest) one and keep walking — it only matters if a holdings report
        // turns up behind it.
        if (form.startsWith("13F-NT")) {
          notice ??= {
            form,
            periodOfReport: r.reportDate?.[i] ?? "",
            filedAt: r.filingDate?.[i] ?? "",
          };
          continue;
        }

        // 13F-HR/A is a candidate, not an answer: it may be a restatement of
        // the whole book or four lines released from confidential treatment.
        // `latestThirteenF` reads its type before using it.
        if (form !== "13F-HR" && form !== "13F-HR/A") continue;

        const periodOfReport = r.reportDate?.[i] ?? "";
        out.push({
          form,
          accession: r.accessionNumber?.[i] ?? "",
          filedAt: r.filingDate?.[i] ?? "",
          periodOfReport,
          // Only a notice for a genuinely LATER quarter supersedes. A notice
          // filed for the same period as a holdings report is routine
          // housekeeping and says nothing about staleness.
          supersededBy:
            notice && notice.periodOfReport > periodOfReport ? notice : null,
        });
        // Enough history to walk past a run of amendments, and no more.
        if (out.length >= 12) break;
      }
      return out.length > 0 ? out : null;
    }
  );
  return chain ?? [];
}

interface DirectoryIndex {
  directory?: { item?: { name?: string }[] };
}

/** Fetch and parse a manager's latest 13F-HR.
 *
 * Returns null rather than throwing on every failure path: an EDGAR outage
 * must blank one section of a page, never take the request down with it.
 */
/** One filing fetched and parsed, with no judgement about completeness. */
async function fetchFiling(
  padded: string,
  ref: FilingRef
): Promise<{
  meta: ReturnType<typeof parsePrimaryDoc>;
  holdings: Holding[];
  sourceUrl: string;
} | null> {
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

  const holdings = parseInformationTable(tableXml);
  if (holdings.length === 0) return null;

  return {
    meta: parsePrimaryDoc(primaryXml),
    holdings,
    sourceUrl: `${base}/${primaryName}`,
  };
}

/**
 * Fetch and parse a manager's most recent COMPLETE 13F holdings report.
 *
 * "Complete" is the load-bearing word. A 13F-HR/A that adds new holdings is a
 * holdings report by form type and a fragment by content — the SEC instructs
 * filers that such an amendment "must list only the holdings for which
 * confidential treatment was denied", with entry and value totals "limited to
 * the information contained in the amendment itself". Berkshire Hathaway's
 * amendment for 2025-03-31 is four lines and $1.1bn against a book of roughly
 * $259bn. Serving whichever holdings-bearing filing happens to be newest would
 * therefore, on the day such an amendment lands, replace a manager's portfolio
 * with a rounding error and reconcile perfectly while doing it.
 *
 * So the filing index gives candidates and this walks them newest-first,
 * reading each one's amendment type and taking the first that is a full
 * report. Partial amendments passed on the way are not discarded — they are
 * returned in `partialAmendments`, because "these positions were released from
 * confidential treatment" is information, just not a portfolio.
 *
 * Returns null rather than throwing on every failure path: an EDGAR outage
 * must blank one section of a page, never take the request down with it.
 */
export async function latestThirteenF(cik: string): Promise<ThirteenF | null> {
  const padded = cik.padStart(10, "0");
  const candidates = await holdingsFilings(padded);
  if (candidates.length === 0) return null;

  return cachedJson(
    `13f:${SCHEMA}:holdings:${padded}:${candidates[0]!.accession}`,
    TTL_HOLDINGS,
    async () => {
      const partialAmendments: PartialAmendment[] = [];

      for (const ref of candidates) {
        if (!ref.accession) continue;
        const got = await fetchFiling(padded, ref);
        if (!got) continue;
        const { meta, holdings, sourceUrl } = got;

        // A partial amendment is not a portfolio. Record what it added and
        // keep walking back for the report it amends.
        //
        // UNKNOWN is treated as partial too. An amendment whose type we cannot
        // read might be a restatement, and might be four lines; the two
        // failure modes are not symmetric, and only one of them silently
        // deletes 99% of a manager's book.
        if (meta.isAmendment && meta.amendmentType !== "RESTATEMENT") {
          partialAmendments.push({
            accession: ref.accession,
            filedAt: ref.filedAt,
            periodOfReport: meta.periodOfReport || ref.periodOfReport,
            amendmentType: meta.amendmentType ?? "UNKNOWN",
            amendmentNo: meta.amendmentNo,
            entries: holdings.length,
            value: reportedTotal(holdings),
          });
          continue;
        }

        // Reconciliation is the point of parsing the source ourselves: if our
        // sum does not equal the filer's stated total, our parse is wrong and
        // the flag says so rather than shipping a plausible number.
        const reconciled =
          reportedTotal(holdings) === meta.reportedValueTotal &&
          holdings.length === meta.reportedEntryTotal;

        return {
          cik: padded,
          managerName: meta.managerName,
          periodOfReport: meta.periodOfReport || ref.periodOfReport,
          filedAt: ref.filedAt,
          accession: ref.accession,
          form: ref.form,
          isAmendment: meta.isAmendment,
          amendmentNo: meta.amendmentNo,
          reportedValueTotal: meta.reportedValueTotal,
          reportedEntryTotal: meta.reportedEntryTotal,
          otherIncludedManagers: meta.otherIncludedManagers,
          holdings,
          reconciled,
          // The filer's own statement that this report omits positions under
          // confidential treatment. When true the totals are not the book.
          confidentialOmitted: meta.isConfidentialOmitted,
          // Newest first, and only those filed AFTER the report being served.
          partialAmendments,
          supersededBy: ref.supersededBy,
          sourceUrl,
        };
      }

      // Every candidate was a fragment or unreadable. An honest nothing.
      return null;
    }
  );
}
