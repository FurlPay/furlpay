// ---------------------------------------------------------------------------
// Pre-trip entry requirements: passport validity + indicative visa status.
//
// This is the "Visa & Immigration Center" the product had no backend for. It is
// deliberately SELF-CONTAINED — no Timatic/Sherpa API (those need paid
// accreditation we don't have, and a fabricated adapter would be worse than
// honest local data). Two tiers of confidence:
//
//   HIGH  — passport-validity math and same-country/free-movement logic are
//           deterministic and correct.
//   INDICATIVE — the visa matrix encodes well-known short-stay tourism policy
//           for the corridors in our airport directory. Rules change; every
//           result carries an advisory to confirm with the carrier/embassy
//           before travel, and unknown nationality→destination pairs resolve to
//           "check" rather than a fabricated "visa-free".
//
// Scope: the ~26 countries present in `airports.ts`. Everything else → "check".
// ---------------------------------------------------------------------------

import { AIRPORTS } from "./airports";

export type VisaStatus =
  | "domestic" // travelling within your own country
  | "free_movement" // EU/EEA/Schengen or GCC common-travel freedom
  | "visa_free" // short-stay visa exemption
  | "eta" // electronic pre-authorization (ESTA / UK ETA / ETIAS / eTA / K-ETA)
  | "visa_on_arrival"
  | "evisa"
  | "visa_required"
  | "check"; // no confident data — traveller must verify

export interface VisaOutcome {
  status: VisaStatus;
  maxStayDays?: number;
  label: string;
  detail?: string;
  actionUrl?: string;
}

export interface PassportCheck {
  /** Months of validity beyond the reference date the DESTINATION requires. */
  validityMonths: number;
  /** true/false once an expiry + reference date are supplied; undefined otherwise. */
  ok?: boolean;
  detail: string;
}

export interface EntryRequirement {
  nationality: string; // ISO-3166-1 alpha-2
  destination: string; // ISO-3166-1 alpha-2
  destinationName: string;
  visa: VisaOutcome;
  passport: PassportCheck;
  notes: string[];
  advisory: string;
  /** true when nothing is confidently known — the UI should lean on the advisory. */
  indicativeOnly: boolean;
  /** Version of the visa matrix this answer came from (see ENTRY_DATA_VERSION). */
  dataVersion: string;
}

const ADVISORY =
  "Indicative guidance only. Entry rules change frequently and depend on your exact " +
  "passport, itinerary and purpose of travel. Always confirm with the operating airline " +
  "or the destination's embassy (or IATA Timatic) before you book non-refundable travel.";

// Version stamp for the visa matrix so a stale answer is auditable and the UI
// can show how current the data is. Bump when the DEST table changes. YYYY-MM.
export const ENTRY_DATA_VERSION = "2026-07";

// --- country reference ------------------------------------------------------
// Country NAME (as it appears in airports.ts) → ISO-2. Lets callers pass either
// an ISO-2 code, a country name, or an IATA airport code as the destination.
const NAME_TO_ISO: Record<string, string> = {
  "united kingdom": "GB",
  "united states": "US",
  france: "FR",
  netherlands: "NL",
  germany: "DE",
  spain: "ES",
  italy: "IT",
  portugal: "PT",
  switzerland: "CH",
  "türkiye": "TR",
  turkey: "TR",
  "united arab emirates": "AE",
  qatar: "QA",
  india: "IN",
  singapore: "SG",
  thailand: "TH",
  "hong kong": "HK",
  japan: "JP",
  "south korea": "KR",
  australia: "AU",
  indonesia: "ID",
  brazil: "BR",
  mexico: "MX",
  canada: "CA",
  egypt: "EG",
  "south africa": "ZA",
  "costa rica": "CR",
};

const ISO_TO_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(NAME_TO_ISO).map(([name, iso]) => [iso, titleCase(name)]),
);
// Prefer the canonical display spellings.
Object.assign(ISO_TO_NAME, {
  GB: "United Kingdom",
  US: "United States",
  AE: "United Arab Emirates",
  KR: "South Korea",
  ZA: "South Africa",
  CR: "Costa Rica",
  HK: "Hong Kong",
  TR: "Türkiye",
});

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

const IATA_TO_ISO: Record<string, string> = Object.fromEntries(
  AIRPORTS.map((a) => [a.iata, NAME_TO_ISO[a.country.toLowerCase()] ?? ""]).filter(([, iso]) => iso),
);

/** Resolve an ISO-2 code from an ISO-2 code, a country name, or an IATA code. */
export function toIso2(input: string | undefined | null): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (/^[A-Za-z]{2}$/.test(raw)) {
    const up = raw.toUpperCase();
    if (ISO_TO_NAME[up]) return up;
  }
  if (/^[A-Za-z]{3}$/.test(raw)) {
    const iso = IATA_TO_ISO[raw.toUpperCase()];
    if (iso) return iso;
  }
  const byName = NAME_TO_ISO[raw.toLowerCase()];
  return byName ?? null;
}

export function countryName(iso: string): string {
  return ISO_TO_NAME[iso.toUpperCase()] ?? iso.toUpperCase();
}

/** Countries the engine has data for, for nationality/destination pickers. */
export const SUPPORTED_COUNTRIES: { iso: string; name: string }[] = Object.entries(ISO_TO_NAME)
  .map(([iso, name]) => ({ iso, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

// --- nationality groups (used to keep the destination table compact) --------
const FREE_MOVEMENT = ["FR", "DE", "ES", "IT", "PT", "NL", "CH"]; // Schengen + EFTA (subset in scope)
const WEST = ["US", "GB", "CA", "AU", "JP", "KR", "SG", "HK"]; // broadly visa-exempt "strong" passports
const LATAM = ["BR", "MX", "CR"];
const GCC = ["AE", "QA"];

// --- destination policies ---------------------------------------------------
// Ordered rules per destination; the first rule whose `nats` includes the
// traveller's nationality wins. `"*"` matches anyone (the fallback).
interface Rule {
  nats: string[] | "*";
  status: VisaStatus;
  days?: number;
  label: string;
  detail?: string;
  url?: string;
}
interface DestPolicy {
  passportMonths: number; // validity the destination requires beyond the reference date
  rules: Rule[];
}

const schengen = (): DestPolicy => ({
  passportMonths: 3,
  rules: [
    { nats: FREE_MOVEMENT, status: "free_movement", label: "Free movement — no visa", detail: "EU/EEA/Schengen freedom of movement." },
    {
      nats: ["US", "CA", "AU", "JP", "KR", "SG", "GB", "HK", "BR", "MX", "CR", "AE", "QA"],
      status: "visa_free",
      days: 90,
      label: "Visa-free (90 days / 180)",
      detail: "Short-stay exemption. ETIAS pre-authorization applies once the scheme is live.",
      url: "https://travel-europe.europa.eu/etias_en",
    },
    { nats: "*", status: "visa_required", label: "Schengen visa required", url: "https://www.schengenvisainfo.com/" },
  ],
});

const DEST: Record<string, DestPolicy> = {
  US: {
    passportMonths: 0,
    rules: [
      {
        nats: ["GB", "FR", "DE", "ES", "IT", "PT", "NL", "CH", "JP", "KR", "SG", "AU"],
        status: "eta",
        days: 90,
        label: "ESTA required (Visa Waiver Program)",
        detail: "Apply for an ESTA online before departure.",
        url: "https://esta.cbp.dhs.gov/",
      },
      { nats: ["CA"], status: "visa_free", days: 180, label: "Visa-free for Canadian citizens" },
      { nats: "*", status: "visa_required", label: "B-1/B-2 visitor visa required", url: "https://travel.state.gov/" },
    ],
  },
  GB: {
    passportMonths: 0,
    rules: [
      {
        nats: [...WEST.filter((c) => c !== "GB"), ...FREE_MOVEMENT, ...GCC, ...LATAM],
        status: "eta",
        days: 180,
        label: "UK ETA required",
        detail: "Apply for a UK Electronic Travel Authorisation before you travel.",
        url: "https://www.gov.uk/eta",
      },
      { nats: "*", status: "visa_required", label: "Standard Visitor visa required", url: "https://www.gov.uk/standard-visitor" },
    ],
  },
  FR: schengen(),
  DE: schengen(),
  ES: schengen(),
  IT: schengen(),
  PT: schengen(),
  NL: schengen(),
  CH: schengen(),
  AE: {
    passportMonths: 6,
    rules: [
      { nats: ["QA"], status: "free_movement", label: "GCC entry — national ID accepted" },
      { nats: [...WEST, ...FREE_MOVEMENT], status: "visa_free", days: 30, label: "Visa-free / visa on arrival (30 days)" },
      { nats: ["IN"], status: "visa_on_arrival", days: 14, label: "Visa on arrival (conditional)", detail: "On arrival if you hold a valid US/UK/EU/GCC visa or residence; otherwise apply for a UAE e-Visa.", url: "https://www.moi.gov.ae/" },
      { nats: "*", status: "evisa", label: "UAE e-Visa required", url: "https://www.moi.gov.ae/" },
    ],
  },
  QA: {
    passportMonths: 6,
    rules: [
      { nats: ["AE"], status: "free_movement", label: "GCC entry — national ID accepted" },
      { nats: [...WEST, ...FREE_MOVEMENT, "BR", "MX"], status: "visa_free", days: 30, label: "Visa waiver on arrival (30 days)" },
      { nats: "*", status: "evisa", label: "Qatar e-Visa / Hayya required", url: "https://www.visitqatar.com/" },
    ],
  },
  IN: {
    passportMonths: 6,
    rules: [
      {
        nats: [...WEST, ...FREE_MOVEMENT, ...LATAM, ...GCC, "TH", "ID", "TR", "EG", "ZA"],
        status: "evisa",
        days: 30,
        label: "India e-Visa required",
        detail: "Apply for an e-Tourist Visa online at least 4 days before travel.",
        url: "https://indianvisaonline.gov.in/evisa/",
      },
      { nats: "*", status: "evisa", label: "India e-Visa / visa required", url: "https://indianvisaonline.gov.in/evisa/" },
    ],
  },
  JP: {
    passportMonths: 0,
    rules: [
      { nats: [...WEST.filter((c) => c !== "JP"), ...FREE_MOVEMENT, "AE", ...LATAM, "TR"], status: "visa_free", days: 90, label: "Visa-free (90 days)" },
      { nats: ["TH"], status: "visa_free", days: 15, label: "Visa-free (15 days)" },
      { nats: ["ID"], status: "eta", days: 15, label: "Visa waiver — prior registration", detail: "e-passport holders register for a visa waiver before travel.", url: "https://www.mofa.go.jp/" },
      { nats: "*", status: "visa_required", label: "Visa required", url: "https://www.mofa.go.jp/" },
    ],
  },
  KR: {
    passportMonths: 0,
    rules: [
      { nats: [...WEST.filter((c) => c !== "KR"), ...FREE_MOVEMENT, ...LATAM, "AE", "TR", "ZA"], status: "eta", days: 90, label: "K-ETA required", detail: "Apply for a Korea Electronic Travel Authorisation before departure.", url: "https://www.k-eta.go.kr/" },
      { nats: "*", status: "visa_required", label: "Visa required", url: "https://www.k-eta.go.kr/" },
    ],
  },
  SG: {
    passportMonths: 6,
    rules: [
      { nats: [...WEST, ...FREE_MOVEMENT, ...GCC, ...LATAM, "TH", "ID", "ZA", "TR"], status: "visa_free", days: 30, label: "Visa-free (30–90 days)", detail: "Submit the SG Arrival Card before entry.", url: "https://eservices.ica.gov.sg/sgarrivalcard/" },
      { nats: "*", status: "evisa", label: "Visa required", url: "https://www.ica.gov.sg/" },
    ],
  },
  TH: {
    passportMonths: 6,
    rules: [
      { nats: [...WEST, ...FREE_MOVEMENT, ...GCC, ...LATAM, "IN", "ID", "ZA", "TR"], status: "visa_free", days: 60, label: "Visa exemption (60 days)", detail: "Complete the Thailand Digital Arrival Card before entry.", url: "https://www.thaievisa.go.th/" },
      { nats: "*", status: "visa_on_arrival", days: 15, label: "Visa on arrival / e-Visa", url: "https://www.thaievisa.go.th/" },
    ],
  },
  ID: {
    passportMonths: 6,
    rules: [
      { nats: [...WEST, ...FREE_MOVEMENT, ...GCC, ...LATAM, "IN", "TH", "ZA", "TR", "EG"], status: "visa_on_arrival", days: 30, label: "Visa on arrival / e-VoA (30 days)", detail: "Buy an e-VoA online or on arrival; extendable once.", url: "https://molina.imigrasi.go.id/" },
      { nats: "*", status: "visa_on_arrival", days: 30, label: "Visa on arrival / e-VoA", url: "https://molina.imigrasi.go.id/" },
    ],
  },
  AU: {
    passportMonths: 0,
    rules: [
      { nats: [...FREE_MOVEMENT, "GB"], status: "eta", days: 90, label: "eVisitor (subclass 651)", detail: "Free online authorisation for EU/UK nationals.", url: "https://immi.homeaffairs.gov.au/" },
      { nats: ["US", "CA", "JP", "KR", "SG", "HK", "BR", "MX"], status: "eta", days: 90, label: "ETA (subclass 601)", url: "https://immi.homeaffairs.gov.au/" },
      { nats: "*", status: "visa_required", label: "Visitor visa (subclass 600) required", url: "https://immi.homeaffairs.gov.au/" },
    ],
  },
  CA: {
    passportMonths: 0,
    rules: [
      { nats: ["US"], status: "visa_free", days: 180, label: "Visa-free for US citizens" },
      { nats: [...FREE_MOVEMENT, "GB", "JP", "KR", "AU", "HK", "BR", "MX"], status: "eta", days: 180, label: "Canada eTA required", detail: "Apply for an Electronic Travel Authorization before flying.", url: "https://www.canada.ca/eta" },
      { nats: "*", status: "visa_required", label: "Visitor visa (TRV) required", url: "https://www.canada.ca/" },
    ],
  },
  HK: {
    passportMonths: 1,
    rules: [
      { nats: ["IN"], status: "visa_free", days: 14, label: "Visa-free (14 days)" },
      { nats: [...WEST, ...FREE_MOVEMENT, ...GCC, ...LATAM, "TH", "ID", "ZA", "TR", "EG"], status: "visa_free", days: 30, label: "Visa-free (7–180 days by nationality)" },
      { nats: "*", status: "visa_free", days: 14, label: "Visa-free (duration varies)" },
    ],
  },
  BR: {
    passportMonths: 6,
    rules: [
      { nats: ["US", "CA", "AU"], status: "evisa", days: 90, label: "Brazil e-Visa required", detail: "e-Visa reintroduced for US/Canada/Australia in 2025.", url: "https://www.gov.br/mre/" },
      { nats: [...FREE_MOVEMENT, "GB", "JP", "KR", "SG", "HK", "MX", "CR", "AE", "QA", "ZA", "TR", "TH", "ID"], status: "visa_free", days: 90, label: "Visa-free (90 days)" },
      { nats: "*", status: "evisa", label: "Visa / e-Visa required", url: "https://www.gov.br/mre/" },
    ],
  },
  MX: {
    passportMonths: 0,
    rules: [
      { nats: [...WEST, ...FREE_MOVEMENT, ...GCC, "BR", "CR", "TR", "ZA"], status: "visa_free", days: 180, label: "Visa-free (up to 180 days)" },
      { nats: "*", status: "visa_required", label: "Visa required — or visa-free with a valid US visa", detail: "Holders of a valid US visa are exempt.", url: "https://www.gob.mx/inm" },
    ],
  },
  TR: {
    passportMonths: 6,
    rules: [
      { nats: ["IN", "EG", "ZA"], status: "evisa", days: 30, label: "Türkiye e-Visa required", url: "https://www.evisa.gov.tr/" },
      { nats: [...WEST, ...FREE_MOVEMENT, ...GCC, ...LATAM, "TH", "ID"], status: "visa_free", days: 90, label: "Visa-free (90 days / 180)" },
      { nats: "*", status: "evisa", label: "e-Visa / visa required", url: "https://www.evisa.gov.tr/" },
    ],
  },
  EG: {
    passportMonths: 6,
    rules: [
      { nats: GCC, status: "visa_free", days: 90, label: "Visa-free (GCC)" },
      { nats: [...WEST, ...FREE_MOVEMENT, ...LATAM, "TR", "ZA", "IN", "TH", "ID"], status: "evisa", days: 30, label: "e-Visa / visa on arrival (30 days)", url: "https://visa2egypt.gov.eg/" },
      { nats: "*", status: "evisa", label: "e-Visa required", url: "https://visa2egypt.gov.eg/" },
    ],
  },
  ZA: {
    passportMonths: 1,
    rules: [
      { nats: [...WEST, ...FREE_MOVEMENT, ...LATAM, "AE", "QA"], status: "visa_free", days: 90, label: "Visa-free (up to 90 days)", detail: "At least one blank passport page required." },
      { nats: "*", status: "visa_required", label: "Visitor visa required", detail: "A South Africa e-Visa is available for eligible nationalities.", url: "https://www.dha.gov.za/" },
    ],
  },
  CR: {
    passportMonths: 1,
    rules: [
      { nats: [...WEST, ...FREE_MOVEMENT, ...LATAM, ...GCC, "TR", "ZA"], status: "visa_free", days: 90, label: "Visa-free (90 days)", detail: "Proof of onward travel is required at entry." },
      { nats: "*", status: "check", label: "Verify visa requirement", url: "https://www.migracion.go.cr/" },
    ],
  },
};

function resolveVisa(nat: string, dest: string): { policy: DestPolicy | null; outcome: VisaOutcome } {
  if (nat === dest) {
    return { policy: null, outcome: { status: "domestic", label: "Domestic travel — no entry requirements" } };
  }
  const policy = DEST[dest];
  if (!policy) {
    return {
      policy: null,
      outcome: { status: "check", label: "No data for this destination — verify entry requirements" },
    };
  }
  const rule = policy.rules.find((r) => r.nats === "*" || (r.nats as string[]).includes(nat));
  const r: Rule = rule ?? { nats: "*", status: "check", label: "Verify visa requirement" };
  return {
    policy,
    outcome: { status: r.status, maxStayDays: r.days, label: r.label, detail: r.detail, actionUrl: r.url },
  };
}

// --- passport validity (deterministic) --------------------------------------
// All date math is in UTC. A "YYYY-MM-DD" string parses to UTC midnight, so the
// arithmetic must use UTC getters/setters too — mixing in local-time methods
// drifts by a day near month boundaries on servers not running in UTC.
function addMonths(d: Date, months: number): Date {
  const r = new Date(d.getTime());
  const day = r.getUTCDate();
  r.setUTCMonth(r.getUTCMonth() + months);
  // Guard month-length overflow (e.g. Aug 31 + 1mo → Oct 1): clamp to month end.
  if (r.getUTCDate() < day) r.setUTCDate(0);
  return r;
}

function checkPassport(
  validityMonths: number,
  passportExpiry: string | undefined,
  refDate: Date,
): PassportCheck {
  const rule =
    validityMonths === 0
      ? "Passport must be valid for the full duration of your stay."
      : `Passport must be valid for at least ${validityMonths} months beyond your travel dates.`;
  if (!passportExpiry) return { validityMonths, detail: rule };

  const expiry = new Date(passportExpiry);
  if (isNaN(expiry.getTime())) {
    return { validityMonths, ok: undefined, detail: `Unrecognized expiry date. ${rule}` };
  }
  const required = addMonths(refDate, validityMonths);
  const ok = expiry.getTime() >= required.getTime();
  const expiryStr = expiry.toISOString().slice(0, 10);
  return {
    validityMonths,
    ok,
    detail: ok
      ? `Passport (expires ${expiryStr}) meets the ${validityMonths === 0 ? "duration-of-stay" : `${validityMonths}-month`} rule.`
      : `Passport expires ${expiryStr} — too early. ${rule} Renew before you travel.`,
  };
}

export interface EntryRequirementInput {
  nationality: string; // ISO-2, country name, or (nonsensical) — resolved via toIso2
  destination: string; // ISO-2, country name, or IATA code
  passportExpiry?: string; // ISO date (YYYY-MM-DD)
  /** Latest date the passport must still be valid on: return date, else departure, else today. */
  departureDate?: string;
  returnDate?: string;
}

/**
 * Assess entry requirements for a nationality → destination trip.
 * Returns null only when the inputs can't be resolved to known countries.
 */
export function entryRequirements(input: EntryRequirementInput): EntryRequirement | null {
  const nat = toIso2(input.nationality);
  const dest = toIso2(input.destination);
  if (!nat || !dest) return null;

  const { policy, outcome } = resolveVisa(nat, dest);
  const validityMonths = policy?.passportMonths ?? (nat === dest ? 0 : 6);

  const ref =
    parseDate(input.returnDate) ?? parseDate(input.departureDate) ?? new Date();
  const passport =
    nat === dest ? { validityMonths: 0, detail: "Domestic travel — no passport validity rule." } : checkPassport(validityMonths, input.passportExpiry, ref);

  const notes: string[] = [];
  if (outcome.status === "visa_free" || outcome.status === "eta") {
    notes.push("Carry proof of onward or return travel and accommodation.");
  }
  if (["FR", "DE", "ES", "IT", "PT", "NL", "CH"].includes(dest) && outcome.status === "visa_free") {
    notes.push("Schengen 90/180 rule: max 90 days in any rolling 180-day period.");
  }
  if (outcome.status === "visa_required" || outcome.status === "evisa") {
    notes.push("Apply well ahead of travel — processing can take days to weeks.");
  }

  return {
    nationality: nat,
    destination: dest,
    destinationName: countryName(dest),
    visa: outcome,
    passport,
    notes,
    advisory: ADVISORY,
    indicativeOnly: outcome.status === "check",
    dataVersion: ENTRY_DATA_VERSION,
  };
}

function parseDate(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Human-readable one-liner for logs / compact UI. */
export function visaSummary(r: EntryRequirement): string {
  return `${r.visa.label}${r.visa.maxStayDays ? ` · up to ${r.visa.maxStayDays} days` : ""}`;
}
