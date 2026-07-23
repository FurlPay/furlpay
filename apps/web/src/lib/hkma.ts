/**
 * HKMA Public Open Data API — REAL, LIVE, NO CREDENTIALS.
 *
 * Verified live on 22 Jul 2026 against the production endpoint:
 *
 *   GET https://api.hkma.gov.hk/public/bank-svf-info/banks-branch-locator?lang=en
 *   -> 200, header.success=true, err_code "0000"
 *   -> 1,051 branch records across 20 licensed banks
 *   -> 247 of them HSBC + Hang Seng
 *
 * WHY THIS EXISTS. `lib/hsbc.ts` ships a hardcoded three-branch "locator" behind
 * an HSBC sandbox base URL that is not an API host at all: developer.hsbc.com.hk
 * serves S3 static content, and every path returns AWS API Gateway's
 * `{"Message":"Missing Authentication Token"}` — the response for an unmatched
 * route, not for a bad credential. Those endpoints do not exist.
 *
 * This module is the opposite: an endpoint that provably answers, published by
 * the regulator rather than by one bank, covering every licensed institution.
 * It needs no client ID, no secret, no partnership and no approval.
 *
 * NO FALLBACK DATA, DELIBERATELY. When the call fails this returns an empty
 * list and an `error`. It does not substitute invented branches. The mock-rates
 * defect that prompted this file existed precisely because a fallback was
 * indistinguishable from a success at the call site.
 */

export interface HkmaBranch {
  district: string;
  bankName: string;
  branchName: string;
  address: string;
  serviceHours: string;
  latitude: number | null;
  longitude: number | null;
  barrierFreeAccess: string;
}

export interface HkmaAtm {
  district: string;
  bankName: string;
  typeOfMachine: string;
  function: string;
  currenciesSupported: string;
  network: string;
  address: string;
  serviceHours: string;
  latitude: number | null;
  longitude: number | null;
}

export interface HkmaResult<T> {
  records: T[];
  /** Total the API reported for the query, before client-side filtering. */
  returned: number;
  /** Present only on failure. Callers must surface it rather than show an empty list as "no branches". */
  error?: string;
  source: "hkma_live";
  fetchedAt: string;
}

const HKMA_BASE = "https://api.hkma.gov.hk/public/bank-svf-info";

/** The API caps a page; 5,000 comfortably covers the full 1,051-row branch set. */
const PAGE_SIZE = 5000;

/** Six hours. The registry changes when a branch opens or closes, not intraday. */
const REVALIDATE_SECONDS = 21_600;

type HkmaEnvelope<R> = {
  header?: { success?: boolean; err_code?: string; err_msg?: string };
  result?: { datasize?: number; records?: R[] };
};

async function fetchHkma<R>(path: string, lang: "en" | "tc" | "sc"): Promise<{ records: R[]; error?: string }> {
  const url = `${HKMA_BASE}/${path}?lang=${lang}&pagesize=${PAGE_SIZE}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!res.ok) return { records: [], error: `HKMA ${path} returned HTTP ${res.status}` };

    const body = (await res.json()) as HkmaEnvelope<R>;
    // The envelope carries its own success flag; a 200 with success=false is a
    // failure and must not be read as an empty result set.
    if (body.header?.success !== true) {
      return { records: [], error: `HKMA ${path}: ${body.header?.err_code ?? "?"} ${body.header?.err_msg ?? "unknown error"}` };
    }
    return { records: Array.isArray(body.result?.records) ? body.result!.records! : [] };
  } catch (err) {
    return { records: [], error: `HKMA ${path} unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Coordinates arrive as strings and are occasionally blank. */
function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
}

const str = (v: unknown): string => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();

/**
 * Match a bank by substring, case-insensitively, tolerant of the double spaces
 * the registry contains ("Bank of  Communications").
 *
 * The API's own `bank_name` query parameter was tested and does NOT filter —
 * passing it returns unrelated banks — so filtering happens here.
 */
function matchesBank(recordName: string, needle?: string): boolean {
  if (!needle) return true;
  return str(recordName).toLowerCase().includes(needle.replace(/\s+/g, " ").trim().toLowerCase());
}

export async function getHkBranches(
  opts: { bank?: string; district?: string; lang?: "en" | "tc" | "sc" } = {}
): Promise<HkmaResult<HkmaBranch>> {
  const { records, error } = await fetchHkma<Record<string, unknown>>("banks-branch-locator", opts.lang ?? "en");
  const fetchedAt = new Date().toISOString();
  if (error) return { records: [], returned: 0, error, source: "hkma_live", fetchedAt };

  const mapped = records
    .filter((r) => matchesBank(str(r.bank_name), opts.bank))
    .filter((r) => !opts.district || str(r.district).toLowerCase() === opts.district.toLowerCase())
    .map<HkmaBranch>((r) => ({
      district: str(r.district),
      bankName: str(r.bank_name),
      branchName: str(r.branch_name),
      address: str(r.address),
      serviceHours: str(r.service_hours),
      latitude: num(r.latitude),
      longitude: num(r.longitude),
      barrierFreeAccess: str(r["barrier-free_access"]),
    }));

  return { records: mapped, returned: records.length, source: "hkma_live", fetchedAt };
}

export async function getHkAtms(
  opts: { bank?: string; district?: string; lang?: "en" | "tc" | "sc" } = {}
): Promise<HkmaResult<HkmaAtm>> {
  const { records, error } = await fetchHkma<Record<string, unknown>>("banks-atm-locator", opts.lang ?? "en");
  const fetchedAt = new Date().toISOString();
  if (error) return { records: [], returned: 0, error, source: "hkma_live", fetchedAt };

  const mapped = records
    .filter((r) => matchesBank(str(r.bank_name), opts.bank))
    .filter((r) => !opts.district || str(r.district).toLowerCase() === opts.district.toLowerCase())
    .map<HkmaAtm>((r) => ({
      district: str(r.district),
      bankName: str(r.bank_name),
      typeOfMachine: str(r.type_of_machine),
      function: str(r.function),
      currenciesSupported: str(r.currencies_supported),
      network: str(r.network),
      address: str(r.address),
      serviceHours: str(r.service_hours),
      latitude: num(r.latitude),
      longitude: num(r.longitude),
    }));

  return { records: mapped, returned: records.length, source: "hkma_live", fetchedAt };
}

/** Substring used to select HSBC and its Hang Seng subsidiary from the registry. */
export const HSBC_GROUP_BANKS = ["Hongkong and Shanghai Banking", "Hang Seng Bank"] as const;

export async function getHsbcGroupBranches(): Promise<HkmaResult<HkmaBranch>> {
  const all = await getHkBranches();
  if (all.error) return all;
  const records = all.records.filter((b) =>
    HSBC_GROUP_BANKS.some((n) => b.bankName.toLowerCase().includes(n.toLowerCase()))
  );
  return { ...all, records };
}
