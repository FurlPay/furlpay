// ---------------------------------------------------------------------------
// Minimal RLP encoder — enough for EIP-1559 transaction signing, and no more.
//
// There is no decoder here on purpose. Nothing in this app parses RLP: the
// server returns Li.Fi's transactionRequest as plain JSON, and the only bytes
// we produce are the ones we sign. A decoder would be untested surface sitting
// next to a signing path.
//
// RLP is deceptively easy to get subtly wrong, and every one of the rules below
// is load-bearing when the output is a transaction:
//
//   * Integers are MINIMAL big-endian. 0 encodes as the EMPTY string (0x80),
//     not as 0x00. A non-minimal encoding produces a different transaction hash
//     and therefore a signature over something no node will accept.
//   * A single byte < 0x80 encodes as itself, with no length prefix.
//   * `to` is 20 raw bytes, not a hex string, and a contract-creation `to` is
//     the empty string.
//
// Spec: Ethereum Yellow Paper, Appendix B.
// ---------------------------------------------------------------------------

/** Anything RLP can encode: a byte string, or a (nested) list of them. */
export type RlpInput = Uint8Array | RlpInput[];

export function encode(input: RlpInput): Uint8Array {
  if (Array.isArray(input)) {
    const payload = concat(input.map(encode));
    return concat([lengthPrefix(payload.length, 0xc0), payload]);
  }
  // A single byte below 0x80 is its own encoding — prefixing it would change
  // the hash of every transaction with a small nonce or chain id.
  if (input.length === 1 && input[0] < 0x80) return input;
  return concat([lengthPrefix(input.length, 0x80), input]);
}

/**
 * Short form for payloads up to 55 bytes, long form above.
 *
 * The long form encodes the LENGTH OF THE LENGTH in the header byte, which is
 * why `offset + 55` rather than a second magic number.
 */
function lengthPrefix(length: number, offset: number): Uint8Array {
  if (length <= 55) return Uint8Array.of(offset + length);
  const lengthBytes = toMinimalBytes(BigInt(length));
  return concat([Uint8Array.of(offset + 55 + lengthBytes.length), lengthBytes]);
}

/**
 * A non-negative integer as minimal big-endian bytes. Zero is the empty string.
 *
 * "Minimal" means no leading zero byte: 1024 is `0x0400`, never `0x000400`.
 * Leading zeros are a consensus error, not a formatting preference.
 */
export function toMinimalBytes(value: bigint): Uint8Array {
  if (value < 0n) throw new Error("RLP cannot encode a negative integer.");
  if (value === 0n) return new Uint8Array(0);
  let hex = value.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Hex string (with or without 0x) to bytes. An empty string is zero bytes. */
export function hexToBytes(hex: string): Uint8Array {
  let clean = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (clean.length === 0) return new Uint8Array(0);
  if (clean.length % 2) clean = "0" + clean;
  if (!/^[0-9a-fA-F]*$/.test(clean)) throw new Error(`Not hex: ${hex}`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = "0x";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/**
 * A quantity from JSON-RPC or Li.Fi as a bigint.
 *
 * Accepts "0x1a", "26" and 26. Deliberately NOT `Number`: gas and value are
 * routinely above 2^53, where Number silently rounds — and a rounded `value` is
 * a transaction that moves a different amount than the one quoted.
 */
export function toBigInt(value: string | number | bigint | null | undefined): bigint {
  if (value === null || value === undefined || value === "") return 0n;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`Quantity ${value} is beyond safe integer range — pass a hex string.`);
    }
    return BigInt(value);
  }
  const trimmed = value.trim();
  return trimmed.startsWith("0x") || trimmed.startsWith("0X")
    ? BigInt(trimmed)
    : BigInt(trimmed);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
