// ---------------------------------------------------------------------------
// SGQR / PayNow — EMVCo Merchant-Presented Mode (MPM) decoder.
//
// ⚠️ DELIBERATE DUPLICATE of apps/web/src/lib/rails/singapore/sgqr.ts.
//
// native-app is NOT part of the turborepo workspace (see the root package.json
// `workspaces` list) and its tsconfig resolves only `@/*`, so it cannot import
// the web copy. Adding it to the workspace means reconfiguring Metro for a
// monorepo, which is a build-breaking change that cannot be verified without a
// full Expo build.
//
// TWO COPIES OF MONEY-PARSING LOGIC IS A REAL RISK, so the divergence is made
// detectable rather than hidden: `lib/__tests__/sgqr.test.ts` pins this
// implementation against the SAME canonical vectors as the web suite —
// including the published CRC-16/CCITT-FALSE check value 0x29B1 for
// "123456789". If the two ever drift, both suites cannot stay green.
//
// This is the DECODER ONLY. The app scans merchant labels; it does not print
// them, so the builder half is deliberately not ported. Less surface, less to
// keep in sync.
//
// Format recap — a flat sequence of TLV triples where tag and length are each
// two ASCII digits and the length counts CHARACTERS:
//
//     "5303702"  ->  tag 53, length 03, value "702"
//
// PayNow lives in a Merchant Account Information template (tags 26-51),
// identified by the GUID "SG.PAYNOW" — NOT pinned to tag 26, because a
// multi-scheme SGQR sticker moves it.
// ---------------------------------------------------------------------------

export const ISO4217_SGD = "702";
export const PAYNOW_GUID = "SG.PAYNOW";
export const SGQR_GUID = "SG.SGQR";

const MERCHANT_ACCOUNT_TAG_MIN = 26;
const MERCHANT_ACCOUNT_TAG_MAX = 51;

function range(lo: number, hi: number): string[] {
  const out: string[] = [];
  for (let i = lo; i <= hi; i += 1) out.push(String(i).padStart(2, "0"));
  return out;
}

const TEMPLATE_TAGS = new Set<string>([
  ...range(MERCHANT_ACCOUNT_TAG_MIN, MERCHANT_ACCOUNT_TAG_MAX),
  "62",
  "64",
  ...range(80, 99),
]);

/**
 * CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflection, no final XOR.
 * Canonical check value for "123456789" is 0x29B1 — asserted in the tests so a
 * future edit cannot quietly swap in a different CRC-16 variant. A wrong CRC
 * does not throw; it silently produces codes every bank app rejects.
 */
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

export function crcHex(input: string): string {
  return crc16CcittFalse(input).toString(16).toUpperCase().padStart(4, "0");
}

export interface TlvNode {
  tag: string;
  value: string;
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

export function parseTlv(payload: string, depth = 0): TlvNode[] {
  const nodes: TlvNode[] = [];
  let i = 0;

  while (i < payload.length) {
    if (payload.length - i < 4) {
      throw new SgqrParseError(`Truncated TLV at offset ${i}`);
    }
    const tag = payload.slice(i, i + 2);
    const lengthRaw = payload.slice(i + 2, i + 4);
    if (!/^\d{2}$/.test(tag)) throw new SgqrParseError(`Malformed tag "${tag}"`, tag);
    if (!/^\d{2}$/.test(lengthRaw)) throw new SgqrParseError(`Malformed length "${lengthRaw}"`, tag);

    const length = Number(lengthRaw);
    const start = i + 4;
    const end = start + length;
    if (end > payload.length) {
      throw new SgqrParseError(`Tag ${tag} declares ${length} characters but fewer remain`, tag);
    }

    const value = payload.slice(start, end);
    const node: TlvNode = { tag, value };
    if (depth < 4 && TEMPLATE_TAGS.has(tag) && value.length >= 4) {
      try {
        node.children = parseTlv(value, depth + 1);
      } catch {
        /* opaque proprietary value — keep the raw string */
      }
    }
    nodes.push(node);
    i = end;
  }
  return nodes;
}

export interface CrcCheck {
  ok: boolean;
  expected: string;
  found: string;
}

/**
 * Verify tag 63. The CRC covers everything up to AND INCLUDING the literal
 * "6304" header, but not the four hex digits after it.
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

export type PayNowProxyType = "mobile" | "uen";

export interface PayNowTarget {
  templateTag: string;
  proxyType: PayNowProxyType;
  proxyValue: string;
  amountEditable: boolean;
  expiryDate?: string;
}

export interface SgqrPayment {
  initiation: "static" | "dynamic";
  currencyNumeric?: string;
  isSgd: boolean;
  amountCents?: number;
  amountRaw?: string;
  merchantName?: string;
  merchantCity?: string;
  countryCode?: string;
  billNumber?: string;
  referenceLabel?: string;
  sgqrId?: string;
  payNow: PayNowTarget | null;
  crc: CrcCheck;
}

/**
 * Integer cents by string manipulation, never `Number(x) * 100` — that turns
 * "70.07" into 7006.999999999999 and floors to a one-cent shortfall the
 * receiving bank then rejects.
 */
export function parseAmountToCents(raw: string): number {
  const m = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(raw.trim());
  if (!m) throw new SgqrParseError(`Tag 54 amount "${raw}" is not a valid EMVCo amount`, "54");
  const [, whole, frac = ""] = m;
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new SgqrParseError(`Tag 54 amount "${raw}" is out of range`, "54");
  }
  return cents;
}

function findTag(nodes: TlvNode[], tag: string): TlvNode | undefined {
  return nodes.find((n) => n.tag === tag);
}
function childValue(node: TlvNode | undefined, tag: string): string | undefined {
  return node?.children?.find((c) => c.tag === tag)?.value;
}

/**
 * Cheap pre-check for the scanner's hot path.
 *
 * Every EMVCo merchant QR starts with the Payload Format Indicator "000201".
 * Checked before the full parse so a crypto address or a WalletConnect URI
 * costs nothing.
 */
export function looksLikeSgqr(raw: string): boolean {
  return raw.trim().startsWith("000201");
}

/**
 * Decode a scanned SGQR / PayNow label.
 *
 * A bad CRC is REPORTED, not thrown, so the UI can say "this label looks
 * damaged" while still showing who the merchant claims to be. Anything that
 * makes the destination or amount ambiguous throws.
 */
export function parseSgqr(raw: string): SgqrPayment {
  const payload = raw.trim();
  if (payload.length < 8) throw new SgqrParseError("Payload too short to be an EMVCo QR");

  const nodes = parseTlv(payload);

  const formatIndicator = findTag(nodes, "00")?.value;
  if (formatIndicator !== "01") {
    throw new SgqrParseError(
      `Payload Format Indicator is "${formatIndicator ?? "absent"}", expected "01"`,
      "00",
    );
  }

  const initiation = findTag(nodes, "01")?.value === "12" ? "dynamic" : "static";
  const currencyNumeric = findTag(nodes, "53")?.value;
  const amountRaw = findTag(nodes, "54")?.value;
  const amountCents = amountRaw !== undefined ? parseAmountToCents(amountRaw) : undefined;
  const additional = findTag(nodes, "62");

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
        `PayNow proxy type "${proxyTypeRaw ?? "absent"}" is not recognised`,
        node.tag,
      );
    }
    if (!proxyValue) {
      throw new SgqrParseError("PayNow template carries no proxy value", node.tag);
    }
    const proxyType: PayNowProxyType = proxyTypeRaw === "0" ? "mobile" : "uen";
    payNow = {
      templateTag: node.tag,
      proxyType,
      proxyValue: proxyType === "uen" ? proxyValue.trim().toUpperCase() : proxyValue.trim(),
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
    countryCode: findTag(nodes, "58")?.value,
    billNumber: childValue(additional, "01"),
    referenceLabel: childValue(additional, "05"),
    sgqrId,
    payNow,
    crc: verifyCrc(payload),
  };
}

/**
 * Scanner-friendly wrapper: never throws.
 *
 * Distinguishes "not an EMVCo QR at all" (fall through to the next parser)
 * from "an EMVCo QR this rail cannot pay" (tell the user why). Collapsing
 * those two makes the scanner say "not payable" to a valid hawker sticker.
 */
export type SgqrScanResult =
  | { kind: "not_sgqr" }
  | { kind: "payable"; payment: SgqrPayment; payNow: PayNowTarget }
  | { kind: "unpayable"; reason: "bad_crc" | "no_paynow" | "not_sgd" | "malformed"; detail: string };

export function classifySgqrScan(raw: string): SgqrScanResult {
  if (!looksLikeSgqr(raw)) return { kind: "not_sgqr" };

  let payment: SgqrPayment;
  try {
    payment = parseSgqr(raw);
  } catch (e) {
    return { kind: "unpayable", reason: "malformed", detail: (e as Error).message };
  }

  if (!payment.crc.ok) {
    return {
      kind: "unpayable",
      reason: "bad_crc",
      detail: "This code's checksum doesn't match — it may be damaged or tampered with.",
    };
  }
  if (!payment.payNow) {
    return {
      kind: "unpayable",
      reason: "no_paynow",
      detail: "This QR doesn't carry a PayNow scheme we can pay.",
    };
  }
  if (payment.currencyNumeric !== undefined && !payment.isSgd) {
    return {
      kind: "unpayable",
      reason: "not_sgd",
      detail: "PayNow settles in Singapore dollars only.",
    };
  }
  return { kind: "payable", payment, payNow: payment.payNow };
}
