// ---------------------------------------------------------------------------
// Real-time OFAC SDN name list fetcher.
//
// Same pattern as aml.ts: a bundled snapshot ships so the module works offline
// and in tests; `fetchOfacSdnNames()` refreshes from the live U.S. Treasury
// source at runtime.
//
// OFAC publishes the SDN list in multiple formats. We use two CSV files:
//   sdn.csv   — main entries (entity number, name, type, program, remarks)
//   alt.csv   — alternate names / aliases (keyed by entity number)
//
// The CSV parser is deliberately inline (zero-dependency, AGENTS.md rule 11).
// OFAC CSVs follow RFC 4180: fields may be quoted, embedded commas and quotes
// are escaped by doubling the quote character.
//
// Privacy note: the SDN list is U.S. government public data, published
// specifically for compliance screening. Including and distributing it is both
// legal and expected — every compliance library does this.
// ---------------------------------------------------------------------------

import type { WatchlistName } from "./nameScreening";
import { OFAC_SDN_NAMES } from "./data/ofacSdnNames";

const SDN_CSV_URL = "https://www.treasury.gov/ofac/downloads/sdn.csv";
const ALT_CSV_URL = "https://www.treasury.gov/ofac/downloads/alt.csv";

// ── CSV parser (RFC 4180, zero deps) ──────────────────────────────────────

/**
 * Parse an RFC-4180 CSV line. OFAC CSVs quote fields that contain commas;
 * embedded quotes are doubled (""). This handles both.
 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (i === line.length) { fields.push(""); break; }
    if (line[i] === '"') {
      // Quoted field
      let val = "";
      i++; // skip opening quote
      while (i < line.length) {
        if (line[i] === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            val += '"'; i += 2; // escaped quote
          } else {
            i++; // closing quote
            break;
          }
        } else {
          val += line[i]; i++;
        }
      }
      fields.push(val.trim());
      if (i < line.length && line[i] === ',') i++; // skip delimiter
    } else {
      // Unquoted field
      const next = line.indexOf(',', i);
      if (next === -1) {
        fields.push(line.slice(i).trim());
        break;
      }
      fields.push(line.slice(i, next).trim());
      i = next + 1;
    }
  }
  return fields;
}

function parseCSV(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map(parseCSVLine);
}

// ── SDN type mapping ──────────────────────────────────────────────────────

function mapEntityType(raw: string): WatchlistName["entityType"] {
  const t = raw.trim().toLowerCase();
  if (t === "individual") return "individual";
  if (t === "entity") return "entity";
  if (t === "vessel") return "vessel";
  if (t === "aircraft") return "aircraft";
  return "entity"; // default for unknown
}

// ── DOB extraction from Remarks ───────────────────────────────────────────

const DOB_RE = /DOB\s+(\d{2}\s+\w{3}\s+\d{4})/i;
const DOB_ISO_RE = /DOB\s+(\d{4}-\d{2}-\d{2})/i;
const NATIONALITY_RE = /nationality\s+([A-Za-z\s]+?)(?:[;,.]|$)/gi;

const MONTH_MAP: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function extractDOB(remarks: string): string | undefined {
  // Try ISO format first
  const isoM = DOB_ISO_RE.exec(remarks);
  if (isoM) return isoM[1];
  // Try "DD Mon YYYY"
  const m = DOB_RE.exec(remarks);
  if (!m) return undefined;
  const parts = m[1].split(/\s+/);
  if (parts.length !== 3) return undefined;
  const [day, mon, year] = parts;
  const mm = MONTH_MAP[mon.toLowerCase().slice(0, 3)];
  if (!mm) return undefined;
  return `${year}-${mm}-${day.padStart(2, "0")}`;
}

function extractNationality(remarks: string): string[] {
  const results: string[] = [];
  let match: RegExpExecArray | null;
  NATIONALITY_RE.lastIndex = 0;
  while ((match = NATIONALITY_RE.exec(remarks)) !== null) {
    results.push(match[1].trim());
  }
  return results;
}

// ── Public API ─────────────────────────────────────────────────────────────

let cachedList: WatchlistName[] | null = null;
let lastFetchedAt: number | null = null;

/**
 * Return the bundled OFAC SDN snapshot (real entries, not synthetic).
 * Always available, even offline. Use `fetchOfacSdnNames()` for live data.
 */
export function getOfacSdnSnapshot(): readonly WatchlistName[] {
  return OFAC_SDN_NAMES;
}

/** Introspection for the trust/compliance page. */
export function getOfacSdnMeta(): {
  snapshotCount: number;
  liveCount: number | null;
  lastFetchedAt: number | null;
  source: "snapshot" | "live";
} {
  return {
    snapshotCount: OFAC_SDN_NAMES.length,
    liveCount: cachedList?.length ?? null,
    lastFetchedAt,
    source: cachedList ? "live" : "snapshot",
  };
}

/**
 * Fetch the OFAC SDN name list from the live U.S. Treasury source.
 *
 * Parses sdn.csv for main entries and alt.csv for aliases, joining on the
 * entity number. Returns a full `WatchlistName[]` ready for `screenName()`.
 *
 * Throws on network failure — the caller must decide whether to fall back
 * to the snapshot or fail closed.
 */
export async function fetchOfacSdnNames(): Promise<WatchlistName[]> {
  const [sdnRes, altRes] = await Promise.all([
    fetch(SDN_CSV_URL),
    fetch(ALT_CSV_URL),
  ]);

  if (!sdnRes.ok) throw new Error(`OFAC SDN fetch failed: ${sdnRes.status} ${sdnRes.statusText}`);
  if (!altRes.ok) throw new Error(`OFAC ALT fetch failed: ${altRes.status} ${altRes.statusText}`);

  const sdnText = await sdnRes.text();
  const altText = await altRes.text();

  const sdnRows = parseCSV(sdnText);
  const altRows = parseCSV(altText);

  // Build alias map: entNum → string[]
  const aliasMap = new Map<string, string[]>();
  for (const row of altRows) {
    // alt.csv columns: ent_num, alt_num, alt_type, alt_name, alt_remarks
    if (row.length < 4) continue;
    const entNum = row[0];
    const altName = row[3];
    if (!entNum || !altName || altName === "-0-") continue;
    const existing = aliasMap.get(entNum) ?? [];
    existing.push(altName);
    aliasMap.set(entNum, existing);
  }

  // Parse SDN entries
  // sdn.csv columns: ent_num, SDN_Name, SDN_Type, Program, Title, Call_Sign,
  //                   Vess_type, Tonnage, GRT, Vess_flag, Vess_owner, Remarks
  const entries: WatchlistName[] = [];
  for (const row of sdnRows) {
    if (row.length < 4) continue;
    const entNum = row[0];
    const name = row[1];
    const type = row[2];
    const program = row[3];
    const remarks = row.length >= 12 ? row[11] : "";

    if (!entNum || !name || name === "-0-") continue;

    entries.push({
      entryId: `OFAC-${entNum}`,
      listSource: "OFAC_SDN",
      entityType: mapEntityType(type),
      primaryName: name,
      aliases: aliasMap.get(entNum) ?? [],
      dateOfBirth: extractDOB(remarks),
      nationality: extractNationality(remarks),
      programs: program ? program.split(";").map((p) => p.trim()).filter(Boolean) : [],
    });
  }

  cachedList = entries;
  lastFetchedAt = Date.now();
  return entries;
}

/**
 * Get the best available watchlist: live-fetched if available, otherwise the
 * bundled snapshot. This is the recommended entry point for production screening.
 */
export function getOfacSdnList(): readonly WatchlistName[] {
  return cachedList ?? OFAC_SDN_NAMES;
}
