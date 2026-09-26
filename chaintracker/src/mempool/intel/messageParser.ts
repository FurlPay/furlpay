// The message layer: decoding OP_RETURN payloads.
//
// A Bitcoin transaction carries two independent channels. The value channel is
// inputs, outputs and amounts. The message channel is data embedded in
// unspendable outputs, and it is the one nobody looks at.
//
// It is worth looking at. During the Liquid incident the parties negotiated
// ON CHAIN: 15 OP_RETURN outputs appear against the federation address in the
// days around the drain, carrying text including "WHITE HATS IN CONTROL" and
// "do what the white hats say - bc1qavzlpl…". All verified from chain and kept
// as a fixture.
//
// TWO RULES, both learned from that same real data:
//
// 1. NEVER MATCH ON CONTENT. The same address also received memecoin
//    advertising, a Telegram solicitation and a PGP block. A rule keyed on
//    words like "hack" or "whitehat" would fire on the spam and miss the next
//    incident, which will use different words or none. What is detectable is
//    STRUCTURAL: an address with no message history suddenly emitting a burst
//    of them. Content is shown to the reader; it is never the signal.
//
// 2. DECODE BEFORE INTERPRETING. A first pass here matched only
//    OP_PUSHBYTES_n and reported half the real payloads as empty, because
//    longer messages use OP_PUSHDATA1 and OP_PUSHDATA2. Bytes that failed to
//    decode looked exactly like transactions carrying no message at all.

import { createHash } from "node:crypto";

export type PayloadKind = "text" | "hex" | "hash" | "binary" | "empty";

export interface OnChainMessage {
  /** Raw payload bytes, hex encoded. */
  hex: string;
  bytes: number;
  kind: PayloadKind;
  /** Decoded text, when the payload is printable. Never used for matching. */
  text: string | null;
  /** Stable identity of the payload — dedupe and recurrence key. */
  fingerprint: string;
  /** Bitcoin addresses appearing inside the message text. */
  embeddedAddresses: string[];
  /** Leading bytes, which is where protocol markers live. */
  prefix: string;
}

/**
 * Extract every pushed payload from an OP_RETURN scriptPubKey ASM string.
 *
 * Handles all four push forms. The `OP_PUSHDATA*` cases are the ones that
 * carry anything long enough to be a sentence, so omitting them — as a first
 * version did — silently drops exactly the messages worth reading.
 */
export function extractPushes(asm: string): string[] {
  if (!asm || !asm.startsWith("OP_RETURN")) return [];
  const out: string[] = [];
  // Esplora renders ASM as opcode/operand pairs separated by spaces; the
  // operand of any push opcode is the hex payload.
  const tokens = asm.split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (!/^OP_PUSHBYTES_\d+$|^OP_PUSHDATA[124]$/.test(t)) continue;
    const operand = tokens[i + 1];
    if (operand && /^[0-9a-fA-F]*$/.test(operand) && operand.length % 2 === 0) {
      out.push(operand.toLowerCase());
      i += 1;
    }
  }
  return out;
}

/** Parse one OP_RETURN output into a message. Pure. */
export function parseMessage(asm: string): OnChainMessage | null {
  const pushes = extractPushes(asm);
  if (!pushes.length) {
    // An OP_RETURN with no push is still a message channel being used, and it
    // is not the same thing as no OP_RETURN at all.
    return asm.startsWith("OP_RETURN")
      ? {
          hex: "", bytes: 0, kind: "empty", text: null,
          fingerprint: fingerprintOf(""), embeddedAddresses: [], prefix: "",
        }
      : null;
  }
  const hex = pushes.join("");
  const buf = Buffer.from(hex, "hex");
  const text = decodeText(buf);

  return {
    hex,
    bytes: buf.length,
    kind: classify(buf, text),
    text,
    fingerprint: fingerprintOf(hex),
    embeddedAddresses: text ? findAddresses(text) : [],
    prefix: hex.slice(0, 8),
  };
}

/** Every message on a transaction. */
export function parseMessages(
  vout: Array<{ scriptpubkey_asm?: string; scriptpubkey_type?: string }>,
): OnChainMessage[] {
  const out: OnChainMessage[] = [];
  for (const o of vout) {
    if (o.scriptpubkey_type !== "op_return") continue;
    const m = parseMessage(o.scriptpubkey_asm ?? "");
    if (m) out.push(m);
  }
  return out;
}

/**
 * Printable text, or null.
 *
 * Requires the WHOLE payload to be printable. Accepting a partly-printable
 * buffer produces convincing-looking fragments out of binary protocol data —
 * a hash that happens to contain a few ASCII bytes would render as a word.
 */
function decodeText(buf: Buffer): string | null {
  if (!buf.length) return null;
  const s = buf.toString("utf8");
  // Reject replacement characters: their presence means this was not UTF-8.
  if (s.includes("�")) return null;
  // Printable ASCII plus ordinary whitespace, and anything above U+00A0 so
  // non-Latin scripts survive.
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    const printable = (c >= 0x20 && c <= 0x7e) || c === 0x0a || c === 0x0d || c === 0x09 || c >= 0xa0;
    if (!printable) return null;
  }
  return s;
}

function classify(buf: Buffer, text: string | null): PayloadKind {
  if (!buf.length) return "empty";
  if (text) {
    // A 32-byte payload that decodes as text is still almost certainly a hash
    // if it looks like one; check shape before trusting the decode.
    return /^[0-9a-f]{64}$/i.test(text.trim()) ? "hash" : "text";
  }
  if (buf.length === 32) return "hash";
  if (buf.length === 20) return "hex";
  return "binary";
}

/**
 * Stable identity for a payload.
 *
 * Hashed rather than stored raw so recurrence can be counted without keeping
 * arbitrary third-party data — which may be anything at all — in the database.
 */
export function fingerprintOf(hex: string): string {
  return createHash("sha256").update(hex, "hex").digest("hex").slice(0, 32);
}

/**
 * Bitcoin addresses written inside message text.
 *
 * This is the message-to-money link: a message naming an address, in a
 * transaction moving funds, connects the two channels. Matched on shape only —
 * whether the address exists or matters is decided elsewhere.
 */
export function findAddresses(text: string): string[] {
  const out = new Set<string>();
  const patterns = [
    /\bbc1[02-9ac-hj-np-z]{11,71}\b/gi,   // bech32 / bech32m
    /\b[13][1-9A-HJ-NP-Za-km-z]{25,34}\b/g, // P2PKH / P2SH
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) out.add(m[0]);
  }
  return [...out];
}

/**
 * How novel and how bursty a message is, given what has been seen before.
 *
 * Both terms are relative to observed history. A payload seen thousands of
 * times is not novel however strange it reads; a payload never seen before, on
 * an address that has never published one, is — regardless of what it says.
 */
export function messageAnomaly(input: {
  /** Times this exact fingerprint has been seen before now. */
  seenBefore: number;
  /** Messages this address had published before now. */
  publisherHistory: number;
  /** Messages from this address inside the recent window. */
  recentFromPublisher: number;
  /** Median messages per address per window, from observation. */
  medianPerPublisher: number | null;
}): { novelty: number; burst: number; confidence: number } {
  // Novelty decays with repetition rather than stepping between two values, so
  // a payload seen twice is not treated the same as one seen ten thousand times.
  const novelty = 1 / (1 + input.seenBefore);

  let burst = 0;
  let confidence = 0.35;
  if (input.medianPerPublisher !== null && input.medianPerPublisher >= 0) {
    // Relative to how many messages an address normally publishes. An address
    // that has never published one emitting several is the strong case.
    const expected = Math.max(input.medianPerPublisher, 0.5);
    burst = clamp01((input.recentFromPublisher - expected) / (expected * 4));
    confidence = 0.75;
  }
  // A publisher with no history at all is the most interesting case AND the
  // least certain one — exactly the situation where risk and confidence must
  // move in opposite directions.
  if (input.publisherHistory === 0 && input.recentFromPublisher > 0) {
    burst = Math.max(burst, 0.6);
    confidence = Math.min(confidence, 0.5);
  }
  return { novelty, burst, confidence };
}

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
