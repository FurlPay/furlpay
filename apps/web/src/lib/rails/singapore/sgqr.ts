import { z } from "zod";

// ---------------------------------------------------------------------------
// SGQR / PayNow — EMVCo Merchant-Presented Mode (MPM) codec.
//
// This is the wire format printed on the label at a Singapore hawker stall,
// cafe, or till: a single SGQR sticker carrying one or more payment schemes,
// each in its own Merchant Account Information template. PayNow is one of
// those schemes, identified by the GUID "SG.PAYNOW".
//
// Scope note — this file is DELIBERATELY only the codec. It parses and builds
// the QR string and nothing else. It does not quote FX, does not move money,
// and does not decide whether a payment may proceed. Those belong to the rails
// layer, which needs live partner credentials this module must never pretend
// to have.
//
// Format (EMVCo MPM): a flat sequence of TLV triples, where the tag and the
// length are each exactly two ASCII digits and the length counts CHARACTERS,
// not bytes:
//
//     ┌────┬────┬───────────────┐
//     │ ID │ LL │ value (LL ch) │   e.g. "5303702"  -> tag 53, len 03, "702"
//     └────┴────┴───────────────┘
//
// Templates (26-51, 62, 64, 80-99) nest the same structure inside their value.
//
// Tags this codec cares about:
//   00  Payload Format Indicator          always "01"
//   01  Point of Initiation Method        "11" static (reusable),
//                                         "12" dynamic (single use)
//   26-51 Merchant Account Information    scanned for the SG.PAYNOW GUID;
//                                         PayNow is conventionally at 26 but
//                                         the spec does not pin it there, and
//                                         a multi-scheme SGQR label moves it.
//   52  Merchant Category Code            ISO 18245
//   53  Transaction Currency              ISO 4217 NUMERIC — SGD is "702"
//   54  Transaction Amount                absent on an "enter the amount" QR
//   58  Country Code                      "SG"
//   59  Merchant Name
//   60  Merchant City
//   62  Additional Data Field Template    01 bill number, 05 reference label
//   63  CRC                               CRC-16/CCITT-FALSE, 4 hex chars
//
// Inside the SG.PAYNOW template:
//   00  GUID            "SG.PAYNOW"
//   01  Proxy type      "0" mobile number, "2" UEN
//   02  Proxy value     "+65XXXXXXXX" or the UEN
//   03  Amount editable "0" fixed, "1" payer may change it
//   04  Expiry date     "YYYYMMDD"
//
// FAIL-VISIBLY CONTRACT: every parse failure returns a typed error naming the
// tag that broke. A scanner that cannot prove where the money is going must
// refuse the scan rather than return a partial result — this is the code path
// between pointing a camera at a sticker and debiting a wallet.
// ---------------------------------------------------------------------------

/** ISO 4217 numeric for SGD. Tag 53 carries the numeric code, not "SGD". */
export const ISO4217_SGD = "702";

/** Application Identifier that marks a template as PayNow. */
export const PAYNOW_GUID = "SG.PAYNOW";

/** Application Identifier for the SGQR bookkeeping template (tag 51). */
export const SGQR_GUID = "SG.SGQR";

/** Merchant Account Information templates live in this inclusive tag range. */
const MERCHANT_ACCOUNT_TAG_MIN = 26;
const MERCHANT_ACCOUNT_TAG_MAX = 51;

/** Tags whose value is itself a TLV sequence. */
const TEMPLATE_TAGS = new Set<string>([
  ...range(MERCHANT_ACCOUNT_TAG_MIN, MERCHANT_ACCOUNT_TAG_MAX),
  "62", // Additional Data Field Template
  "64", // Merchant Information — Language Template
  ...range(80, 99), // Unreserved templates
]);

function range(lo: number, hi: number): string[] {
  const out: string[] = [];
  for (let i = lo; i <= hi; i += 1) out.push(String(i).padStart(2, "0"));
  return out;
}

// ---------------------------------------------------------------------------
// CRC-16/CCITT-FALSE
//
// Parameters: poly 0x1021, init 0xFFFF, no input reflection, no output
// reflection, no final XOR. The canonical check value for the ASCII string
// "123456789" is 0x29B1 — asserted in the test suite so a future "cleanup"
// cannot quietly swap in one of the many other CRC-16 variants. Getting this
// wrong does not throw: it produces a QR that scanners silently reject.
// ---------------------------------------------------------------------------
export function crc16CcittFalse(input: string): number {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i += 1) {
    crc ^= (input.charCodeAt(i) & 0xff) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

/** CRC as the 4 uppercase hex characters that go in tag 63. */
export function crcHex(input: string): string {
  return crc16CcittFalse(input).toString(16).toUpperCase().padStart(4, "0");
}

// ---------------------------------------------------------------------------
// TLV codec
// ---------------------------------------------------------------------------

export interface TlvNode {
  tag: string;
  value: string;
  /** Present only for template tags whose value parsed as a nested sequence. */
  children?: TlvNode[];
}

export class SgqrParseError extends Error {
  readonly tag?: string;
  constructor(message: string, tag?: string) {
    super(message);
    this.name = "SgqrParseError";
    this.tag = tag;
  }
}

/**
 * Parse a flat EMVCo TLV sequence, recursing into template tags.
 *
 * Strict by design: a truncated trailer, a non-numeric length, or a length
 * running past the end of the payload throws rather than returning what was
 * read so far. A partially-decoded payment instruction is worse than none.
 */
export function parseTlv(payload: string, depth = 0): TlvNode[] {
  const nodes: TlvNode[] = [];
  let i = 0;

  while (i < payload.length) {
    if (payload.length - i < 4) {
      throw new SgqrParseError(
        `Truncated TLV at offset ${i}: ${payload.length - i} characters left, need at least 4`,
      );
    }

    const tag = payload.slice(i, i + 2);
    const lengthRaw = payload.slice(i + 2, i + 4);

    if (!/^\d{2}$/.test(tag)) {
      throw new SgqrParseError(`Malformed tag "${tag}" at offset ${i}`, tag);
    }
    if (!/^\d{2}$/.test(lengthRaw)) {
      throw new SgqrParseError(`Malformed length "${lengthRaw}" for tag ${tag}`, tag);
    }

    const length = Number(lengthRaw);
    const start = i + 4;
    const end = start + length;
    if (end > payload.length) {
      throw new SgqrParseError(
        `Tag ${tag} declares ${length} characters but only ${payload.length - start} remain`,
        tag,
      );
    }

    const value = payload.slice(start, end);
    const node: TlvNode = { tag, value };

    // Recurse into templates. A template whose contents are not valid TLV is
    // left as an opaque string rather than failing the whole parse: issuers do
    // put proprietary blobs in the unreserved 80-99 range.
    if (depth < 4 && TEMPLATE_TAGS.has(tag) && value.length >= 4) {
      try {
        node.children = parseTlv(value, depth + 1);
      } catch {
        /* opaque value — keep the raw string */
      }
    }

    nodes.push(node);
    i = end;
  }

  return nodes;
}

/** Serialize one TLV triple, validating the 99-character length ceiling. */
export function encodeTlv(tag: string, value: string): string {
  if (!/^\d{2}$/.test(tag)) {
    throw new SgqrParseError(`Cannot encode malformed tag "${tag}"`, tag);
  }
  if (value.length > 99) {
    throw new SgqrParseError(
      `Value for tag ${tag} is ${value.length} characters; EMVCo length is 2 digits (max 99)`,
      tag,
    );
  }
  return `${tag}${String(value.length).padStart(2, "0")}${value}`;
}

function findTag(nodes: TlvNode[], tag: string): TlvNode | undefined {
  return nodes.find((n) => n.tag === tag);
}

function childValue(node: TlvNode | undefined, tag: string): string | undefined {
  return node?.children?.find((c) => c.tag === tag)?.value;
}

// ---------------------------------------------------------------------------
// CRC verification
// ---------------------------------------------------------------------------

export interface CrcCheck {
  ok: boolean;
  expected: string;
  found: string;
}

/**
 * Verify tag 63.
 *
 * The CRC covers everything from the start of the payload up to AND INCLUDING
 * the literal "6304" header of the CRC tag itself, but not the 4 hex digits
 * that follow. Comparison is case-insensitive: the spec says uppercase, real
 * printed labels are not always.
 */
export function verifyCrc(payload: string): CrcCheck {
  const marker = payload.lastIndexOf("6304");
  if (marker === -1 || marker + 8 !== payload.length) {
    return { ok: false, expected: "", found: "" };
  }
  const covered = payload.slice(0, marker + 4);
  const expected = crcHex(covered);
  const found = payload.slice(marker + 4);
  return { ok: expected.toUpperCase() === found.toUpperCase(), expected, found };
}

// ---------------------------------------------------------------------------
// Decoded payment instruction
// ---------------------------------------------------------------------------

export type PayNowProxyType = "mobile" | "uen";

export interface PayNowTarget {
  /** Tag index the PayNow template was actually found at (26-51). */
  templateTag: string;
  proxyType: PayNowProxyType;
  /** "+6591234567" for mobile, or the UEN string. As printed, uppercased for UEN. */
  proxyValue: string;
  /** True when the payer is allowed to change the amount (SG.PAYNOW tag 03). */
  amountEditable: boolean;
  /** "YYYYMMDD" as printed, when the label carries an expiry. */
  expiryDate?: string;
}

export interface SgqrPayment {
  /** "static" = reusable sticker, "dynamic" = single-use, till-generated. */
  initiation: "static" | "dynamic";
  /** ISO 4217 numeric, e.g. "702". Absent on some minimal static labels. */
  currencyNumeric?: string;
  /** Convenience flag — the only currency PayNow settles in. */
  isSgd: boolean;
  /** Exact minor units (cents). Absent when the payer enters the amount. */
  amountCents?: number;
  /** Amount exactly as printed in tag 54, for display and audit. */
  amountRaw?: string;
  merchantName?: string;
  merchantCity?: string;
  merchantCategoryCode?: string;
  countryCode?: string;
  billNumber?: string;
  referenceLabel?: string;
  /** The SGQR label identifier from the SG.SGQR template, when present. */
  sgqrId?: string;
  /** Null when the label carries no PayNow scheme (e.g. NETS-only). */
  payNow: PayNowTarget | null;
  crc: CrcCheck;
  /** Every decoded node, for debugging and for schemes this codec ignores. */
  nodes: TlvNode[];
}

/**
 * Amount parsing.
 *
 * Tag 54 is a decimal string with no thousands separators and at most two
 * fractional digits for SGD. It is converted to integer cents by string
 * manipulation rather than `Number(x) * 100`, because the float round-trip
 * turns "70.07" into 7006.999999999999 and then floors to 7006 — a one-cent
 * shortfall on a payment that would then be rejected by the receiving bank.
 */
export function parseAmountToCents(raw: string): number {
  const m = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(raw.trim());
  if (!m) {
    throw new SgqrParseError(`Tag 54 amount "${raw}" is not a valid EMVCo decimal amount`, "54");
  }
  const [, whole, frac = ""] = m;
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new SgqrParseError(`Tag 54 amount "${raw}" is out of range`, "54");
  }
  return cents;
}

/** Format integer cents back to the tag 54 representation. */
export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new SgqrParseError(`Amount ${cents} cents is not a positive integer`, "54");
  }
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/**
 * Decode a scanned SGQR / PayNow payload.
 *
 * Throws SgqrParseError on anything that would make the destination or the
 * amount ambiguous. CRC failure does NOT throw — it is reported on the result
 * so a caller can show "this label looks damaged" while still displaying who
 * the merchant claims to be. Callers that are about to move money MUST check
 * `payment.crc.ok` themselves; `assertPayable` below does it for them.
 */
export function parseSgqr(raw: string): SgqrPayment {
  const payload = raw.trim();
  if (payload.length < 8) {
    throw new SgqrParseError("Payload too short to be an EMVCo QR code");
  }

  const nodes = parseTlv(payload);

  const formatIndicator = findTag(nodes, "00")?.value;
  if (formatIndicator !== "01") {
    throw new SgqrParseError(
      `Payload Format Indicator is "${formatIndicator ?? "absent"}", expected "01" — not an EMVCo merchant QR`,
      "00",
    );
  }

  const initiationRaw = findTag(nodes, "01")?.value;
  // "11" static is the default the spec assigns when tag 01 is omitted.
  const initiation = initiationRaw === "12" ? "dynamic" : "static";

  const currencyNumeric = findTag(nodes, "53")?.value;
  const amountRaw = findTag(nodes, "54")?.value;
  const amountCents = amountRaw !== undefined ? parseAmountToCents(amountRaw) : undefined;

  const additional = findTag(nodes, "62");

  // Locate PayNow by GUID across the whole Merchant Account Information range
  // rather than assuming tag 26 — a multi-scheme SGQR label shifts it.
  let payNow: PayNowTarget | null = null;
  let sgqrId: string | undefined;

  for (const node of nodes) {
    const tagNum = Number(node.tag);
    if (!Number.isInteger(tagNum)) continue;
    if (tagNum < MERCHANT_ACCOUNT_TAG_MIN || tagNum > MERCHANT_ACCOUNT_TAG_MAX) continue;

    const guid = childValue(node, "00");
    if (guid === SGQR_GUID) {
      sgqrId = childValue(node, "01");
      continue;
    }
    if (guid !== PAYNOW_GUID) continue;

    const proxyTypeRaw = childValue(node, "01");
    const proxyValue = childValue(node, "02");

    if (proxyTypeRaw !== "0" && proxyTypeRaw !== "2") {
      throw new SgqrParseError(
        `PayNow proxy type "${proxyTypeRaw ?? "absent"}" is not recognised (expected "0" mobile or "2" UEN)`,
        node.tag,
      );
    }
    if (!proxyValue) {
      throw new SgqrParseError("PayNow template carries no proxy value (sub-tag 02)", node.tag);
    }

    const proxyType: PayNowProxyType = proxyTypeRaw === "0" ? "mobile" : "uen";
    payNow = {
      templateTag: node.tag,
      proxyType,
      proxyValue: proxyType === "uen" ? proxyValue.trim().toUpperCase() : proxyValue.trim(),
      // Spec default is not editable; only an explicit "1" opens the field.
      amountEditable: childValue(node, "03") === "1",
      expiryDate: childValue(node, "04"),
    };
  }

  return {
    initiation,
    currencyNumeric,
    isSgd: currencyNumeric === ISO4217_SGD,
    amountCents,
    amountRaw,
    merchantName: findTag(nodes, "59")?.value,
    merchantCity: findTag(nodes, "60")?.value,
    merchantCategoryCode: findTag(nodes, "52")?.value,
    countryCode: findTag(nodes, "58")?.value,
    billNumber: childValue(additional, "01"),
    referenceLabel: childValue(additional, "05"),
    sgqrId,
    payNow,
    crc: verifyCrc(payload),
    nodes,
  };
}

/**
 * Gate between "we decoded a label" and "we are about to debit a wallet".
 *
 * Refuses anything a payment path must not act on: a bad CRC (damaged or
 * tampered sticker), a non-PayNow label this rail cannot settle, a
 * non-SGD currency, or an expired dynamic QR. Returns the narrowed payment.
 *
 * `now` is injectable so expiry behaviour is testable without freezing clocks.
 */
export function assertPayable(
  payment: SgqrPayment,
  now: Date = new Date(),
): SgqrPayment & { payNow: PayNowTarget } {
  if (!payment.crc.ok) {
    throw new SgqrParseError(
      `QR checksum mismatch (expected ${payment.crc.expected || "?"}, label carries ${payment.crc.found || "?"}) — refusing to pay a code that may be damaged or tampered with`,
      "63",
    );
  }
  if (!payment.payNow) {
    throw new SgqrParseError("Label carries no PayNow scheme — this rail cannot settle it");
  }
  if (payment.currencyNumeric !== undefined && !payment.isSgd) {
    throw new SgqrParseError(
      `Label is denominated in ISO 4217 ${payment.currencyNumeric}; PayNow settles SGD (${ISO4217_SGD}) only`,
      "53",
    );
  }
  const expiry = payment.payNow.expiryDate;
  if (expiry) {
    if (!/^\d{8}$/.test(expiry)) {
      throw new SgqrParseError(`PayNow expiry "${expiry}" is not YYYYMMDD`, payment.payNow.templateTag);
    }
    // Expiry is a calendar date in Singapore (UTC+8) and the label is valid
    // through the end of that day. Compare against the SGT civil date rather
    // than UTC midnight, or a code expires eight hours early for a user in SG.
    const sgtToday = new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
    if (expiry < sgtToday) {
      throw new SgqrParseError(`PayNow code expired on ${expiry}`, payment.payNow.templateTag);
    }
  }
  return payment as SgqrPayment & { payNow: PayNowTarget };
}

// ---------------------------------------------------------------------------
// Generation — merchant-presented PayNow QR
// ---------------------------------------------------------------------------

/**
 * Singapore mobile proxies are carried with the +65 country code.
 * UEN structural shapes (ACRA): 9 characters "NNNNNNNNX" (business),
 * 10 characters "NNNNNNNNNX" (local company), or "TyyPQnnnnX" / "SyyPQnnnnX"
 * / "RyyPQnnnnX" (other entities). This validates the SHAPE only — it cannot
 * tell you the UEN is registered, and must not be presented as if it can.
 */
const SG_MOBILE_REGEX = /^\+65[689]\d{7}$/;
const UEN_REGEX = /^(?:\d{8}[A-Z]|\d{9}[A-Z]|[TSR]\d{2}[A-Z]{2}\d{4}[A-Z])$/;

export const PayNowQrSchema = z
  .object({
    proxyType: z.enum(["mobile", "uen"]),
    proxyValue: z.string().min(3).max(40),
    /** Integer cents. Omit for an "enter the amount" label. */
    amountCents: z.number().int().positive().max(20_000_000).optional(),
    /** Whether the payer may edit the amount. Forced true when no amount is set. */
    amountEditable: z.boolean().default(false),
    merchantName: z.string().min(1).max(25),
    merchantCity: z.string().min(1).max(15).default("Singapore"),
    /** ISO 18245 merchant category code. */
    merchantCategoryCode: z.string().regex(/^\d{4}$/).optional(),
    /** "YYYYMMDD". */
    expiryDate: z.string().regex(/^\d{8}$/).optional(),
    referenceLabel: z.string().max(25).optional(),
    billNumber: z.string().max(25).optional(),
    /** Static = reusable sticker; dynamic = one payment. */
    initiation: z.enum(["static", "dynamic"]).default("dynamic"),
  })
  .superRefine((v, ctx) => {
    if (v.proxyType === "mobile" && !SG_MOBILE_REGEX.test(v.proxyValue)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["proxyValue"],
        message: "Singapore mobile proxy must be +65 followed by 8 digits starting 6, 8 or 9",
      });
    }
    if (v.proxyType === "uen" && !UEN_REGEX.test(v.proxyValue.toUpperCase())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["proxyValue"],
        message: "UEN does not match any ACRA format (NNNNNNNNX, NNNNNNNNNX, or TyyPQnnnnX)",
      });
    }
  });

export type PayNowQrRequest = z.input<typeof PayNowQrSchema>;

/**
 * Build an EMVCo-compliant PayNow QR payload.
 *
 * Tag order follows ascending numeric order, which the spec recommends and
 * which every Singapore bank app in practice expects. The CRC is appended last
 * over the fully assembled string including its own "6304" header.
 */
export function buildPayNowQr(req: PayNowQrRequest): string {
  const v = PayNowQrSchema.parse(req);

  // A label with no fixed amount is by definition editable — encoding "0"
  // there produces a code that bank apps reject as having nothing to pay.
  const editable = v.amountCents === undefined ? true : v.amountEditable;

  const payNowTemplate = [
    encodeTlv("00", PAYNOW_GUID),
    encodeTlv("01", v.proxyType === "mobile" ? "0" : "2"),
    encodeTlv("02", v.proxyType === "uen" ? v.proxyValue.toUpperCase() : v.proxyValue),
    encodeTlv("03", editable ? "1" : "0"),
    ...(v.expiryDate ? [encodeTlv("04", v.expiryDate)] : []),
  ].join("");

  const additionalData = [
    ...(v.billNumber ? [encodeTlv("01", v.billNumber)] : []),
    ...(v.referenceLabel ? [encodeTlv("05", v.referenceLabel)] : []),
  ].join("");

  const body = [
    encodeTlv("00", "01"),
    encodeTlv("01", v.initiation === "dynamic" ? "12" : "11"),
    encodeTlv("26", payNowTemplate),
    ...(v.merchantCategoryCode ? [encodeTlv("52", v.merchantCategoryCode)] : []),
    encodeTlv("53", ISO4217_SGD),
    ...(v.amountCents !== undefined ? [encodeTlv("54", formatCents(v.amountCents))] : []),
    encodeTlv("58", "SG"),
    encodeTlv("59", v.merchantName),
    encodeTlv("60", v.merchantCity),
    ...(additionalData ? [encodeTlv("62", additionalData)] : []),
  ].join("");

  const withCrcHeader = `${body}6304`;
  return `${withCrcHeader}${crcHex(withCrcHeader)}`;
}
