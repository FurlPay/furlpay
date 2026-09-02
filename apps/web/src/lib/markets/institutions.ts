// ---------------------------------------------------------------------------
// The 13F filers this app can show — a registry of CIKs, nothing more.
//
// A 13F is filed BY A MANAGER, not by a security, so a surface that reads one
// needs a manager to read. This file is that list. It deliberately holds the
// smallest thing that works: the SEC's own identifier for the filing entity,
// a slug for the URL, and the name EDGAR itself uses for it.
//
// ── WHAT IS AND IS NOT ASSERTED HERE ───────────────────────────────────────
//
// Nothing in this file is a claim about a portfolio. No holdings, no totals,
// no rankings, no "top investor" labels. Every number a reader eventually sees
// is parsed from the filing at request time by `providers/thirteenF.ts`. What
// is recorded here is the durable part — that this entity exists, that it
// files 13F-HR, and which CIK it files under — because that is the part that
// does not go stale between quarters.
//
// `name` is EDGAR's conformed name for the CIK, copied verbatim, which is why
// it is shouty and inconsistently punctuated ("ICAHN CARL C", "Invesco Ltd.").
// It is not tidied up: the point of showing it is that a reader can search
// EDGAR for the same string and land on the same filer. `label` carries the
// readable form for headings, and the two are shown together.
//
// ── HOW THIS LIST WAS BUILT ────────────────────────────────────────────────
//
// Every CIK below was resolved against live EDGAR on 2026-09-02 and kept only
// if the submissions index showed a real 13F-HR. That check was not a
// formality — it rejected seven candidates, several of which look completely
// plausible written down:
//
//   0000029440  "DODGE & COX FUNDS"      the fund registrant, not the adviser;
//                                        files no 13F at all. The adviser is
//                                        0000200217, which is what is listed.
//   0001113169  "PRICE T ROWE GROUP INC" the listed holding company; the 13F
//                                        is filed by the advisory subsidiaries.
//   0001056188   —                       not a CIK. 404s.
//   0001006249  "BlackRock Fund Advisors"    last 13F-HR 2016-12-31.
//   0001364742  "BlackRock Finance, Inc."    last 13F-HR 2024-06-30.
//   0001079114  "GREENLIGHT CAPITAL INC"     last 13F-HR 2023-12-31.
//   0000102909  "VANGUARD GROUP INC"         see below — the interesting one.
//
// The Vanguard Group has filed 13F-NT, not 13F-HR, for every quarter since
// 2025-12-31: a notice saying its holdings are reported on someone else's
// filing. Listing it would have shown a book three quarters stale under a
// name every reader recognises. Its advisory subsidiary VANGUARD ADVISERS INC
// (0000947529) files the holdings report and is what appears here.
//
// A test walks this list against EDGAR and fails when an entry stops filing,
// so the next entity to restructure the way Vanguard did is caught rather than
// quietly served as current.
// ---------------------------------------------------------------------------

export type InstitutionKind =
  /** A bank or broker-dealer. Most of what it reports is market-making and
   *  client facilitation inventory rather than a house view. */
  | "bank"
  /** Index and mutual fund managers — they hold nearly everything, nearly
   *  always, which is why their filings say little about conviction. */
  | "asset-manager"
  /** Discretionary and systematic funds. */
  | "hedge-fund"
  /** Operating companies and family offices that file for their own account. */
  | "other";

export interface Institution {
  /** URL segment. Stable — it is linkable. */
  slug: string;
  /** SEC Central Index Key, zero-padded to 10. The only durable identifier. */
  cik: string;
  /** EDGAR's conformed name for this CIK, verbatim. */
  name: string;
  /** The same filer, spelled for a heading. */
  label: string;
  kind: InstitutionKind;
}

/** Verified against EDGAR on 2026-09-02: each CIK resolves and has a 13F-HR. */
export const INSTITUTIONS: Institution[] = [
  // ---- Banks and broker-dealers ----
  { slug: "jpmorgan-chase", cik: "0000019617", name: "JPMORGAN CHASE & CO", label: "JPMorgan Chase & Co.", kind: "bank" },
  { slug: "goldman-sachs", cik: "0000886982", name: "GOLDMAN SACHS GROUP INC", label: "The Goldman Sachs Group, Inc.", kind: "bank" },
  { slug: "morgan-stanley", cik: "0000895421", name: "MORGAN STANLEY", label: "Morgan Stanley", kind: "bank" },
  { slug: "bank-of-america", cik: "0000070858", name: "BANK OF AMERICA CORP /DE/", label: "Bank of America Corporation", kind: "bank" },
  { slug: "wells-fargo", cik: "0000072971", name: "WELLS FARGO & COMPANY/MN", label: "Wells Fargo & Company", kind: "bank" },
  { slug: "state-street", cik: "0000093751", name: "STATE STREET CORP", label: "State Street Corporation", kind: "bank" },
  { slug: "northern-trust", cik: "0000073124", name: "NORTHERN TRUST CORP", label: "Northern Trust Corporation", kind: "bank" },

  // ---- Asset managers ----
  // Vanguard appears as its advisory subsidiary: the parent files notices now.
  { slug: "vanguard-advisers", cik: "0000947529", name: "VANGUARD ADVISERS INC", label: "Vanguard Advisers, Inc.", kind: "asset-manager" },
  { slug: "fmr-fidelity", cik: "0000315066", name: "FMR LLC", label: "FMR LLC (Fidelity)", kind: "asset-manager" },
  { slug: "geode-capital", cik: "0001214717", name: "GEODE CAPITAL MANAGEMENT, LLC", label: "Geode Capital Management, LLC", kind: "asset-manager" },
  { slug: "wellington-management", cik: "0000902219", name: "WELLINGTON MANAGEMENT GROUP LLP", label: "Wellington Management Group LLP", kind: "asset-manager" },
  { slug: "capital-research-global", cik: "0001422848", name: "Capital Research Global Investors", label: "Capital Research Global Investors", kind: "asset-manager" },
  { slug: "invesco", cik: "0000914208", name: "Invesco Ltd.", label: "Invesco Ltd.", kind: "asset-manager" },
  { slug: "dodge-and-cox", cik: "0000200217", name: "DODGE & COX", label: "Dodge & Cox", kind: "asset-manager" },
  { slug: "ark-invest", cik: "0001697748", name: "ARK Investment Management LLC", label: "ARK Investment Management LLC", kind: "asset-manager" },

  // ---- Hedge funds ----
  { slug: "bridgewater", cik: "0001350694", name: "Bridgewater Associates, LP", label: "Bridgewater Associates, LP", kind: "hedge-fund" },
  { slug: "renaissance-technologies", cik: "0001037389", name: "RENAISSANCE TECHNOLOGIES LLC", label: "Renaissance Technologies LLC", kind: "hedge-fund" },
  { slug: "citadel-advisors", cik: "0001423053", name: "CITADEL ADVISORS LLC", label: "Citadel Advisors LLC", kind: "hedge-fund" },
  { slug: "millennium-management", cik: "0001273087", name: "MILLENNIUM MANAGEMENT LLC", label: "Millennium Management LLC", kind: "hedge-fund" },
  { slug: "two-sigma", cik: "0001179392", name: "TWO SIGMA INVESTMENTS, LP", label: "Two Sigma Investments, LP", kind: "hedge-fund" },
  { slug: "de-shaw", cik: "0001009207", name: "D. E. Shaw & Co., Inc.", label: "D. E. Shaw & Co., Inc.", kind: "hedge-fund" },
  { slug: "aqr-capital", cik: "0001167557", name: "AQR CAPITAL MANAGEMENT LLC", label: "AQR Capital Management LLC", kind: "hedge-fund" },
  { slug: "point72", cik: "0001603466", name: "Point72 Asset Management, L.P.", label: "Point72 Asset Management, L.P.", kind: "hedge-fund" },
  { slug: "elliott-management", cik: "0001791786", name: "Elliott Investment Management L.P.", label: "Elliott Investment Management L.P.", kind: "hedge-fund" },
  { slug: "tiger-global", cik: "0001167483", name: "TIGER GLOBAL MANAGEMENT LLC", label: "Tiger Global Management LLC", kind: "hedge-fund" },
  { slug: "coatue-management", cik: "0001135730", name: "COATUE MANAGEMENT LLC", label: "Coatue Management LLC", kind: "hedge-fund" },
  { slug: "lone-pine-capital", cik: "0001061165", name: "LONE PINE CAPITAL LLC", label: "Lone Pine Capital LLC", kind: "hedge-fund" },
  { slug: "viking-global", cik: "0001103804", name: "VIKING GLOBAL INVESTORS LP", label: "Viking Global Investors LP", kind: "hedge-fund" },
  { slug: "third-point", cik: "0001040273", name: "Third Point LLC", label: "Third Point LLC", kind: "hedge-fund" },
  { slug: "baupost-group", cik: "0001061768", name: "BAUPOST GROUP LLC/MA", label: "The Baupost Group, LLC", kind: "hedge-fund" },
  { slug: "pershing-square", cik: "0002026053", name: "PERSHING SQUARE INC.", label: "Pershing Square, Inc.", kind: "hedge-fund" },
  { slug: "soros-fund-management", cik: "0001029160", name: "SOROS FUND MANAGEMENT LLC", label: "Soros Fund Management LLC", kind: "hedge-fund" },

  // ---- Operating companies and family offices ----
  { slug: "berkshire-hathaway", cik: "0001067983", name: "BERKSHIRE HATHAWAY INC", label: "Berkshire Hathaway Inc.", kind: "other" },
  { slug: "duquesne-family-office", cik: "0001536411", name: "Duquesne Family Office LLC", label: "Duquesne Family Office LLC", kind: "other" },
  { slug: "icahn", cik: "0000921669", name: "ICAHN CARL C", label: "Carl C. Icahn", kind: "other" },
];

const bySlugMap = new Map(INSTITUTIONS.map((i) => [i.slug, i]));
const byCikMap = new Map(INSTITUTIONS.map((i) => [i.cik, i]));

export function institutionBySlug(slug: string): Institution | null {
  return bySlugMap.get(slug.toLowerCase()) ?? null;
}

/** Zero-pad a CIK to the 10 digits EDGAR's own URLs use.
 *
 * Callers write it every way there is: 19617, 0000019617, CIK0000019617. They
 * are the same filer, and a lookup that treats them as three is a 404 on a
 * link a reader typed correctly. */
export function normalizeCik(cik: string): string {
  const digits = cik.replace(/\D/g, "");
  return digits === "" ? "" : digits.padStart(10, "0");
}

/** Look up by CIK in any spelling — bare, padded, or "CIK0000019617". */
export function institutionByCik(cik: string): Institution | null {
  return byCikMap.get(normalizeCik(cik)) ?? null;
}

/** Resolve a URL segment that may be either a slug or a CIK. */
export function resolveInstitution(segment: string): Institution | null {
  return institutionBySlug(segment) ?? institutionByCik(segment);
}
