import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@/lib/evm/rlp";
import { call, RpcError, type ChainSlug } from "@/lib/evm/rpc";

// ---------------------------------------------------------------------------
// Reading an ERC-20's identity off-chain, from the chain.
//
// WHY THIS IS NOT A ONE-LINER. `symbol()` is not a reliably-shaped call. The
// ERC-20 standard made name/symbol/decimals OPTIONAL, and by the time they were
// widely expected several major tokens had already shipped returning
// `bytes32` instead of `string` — MKR is the canonical example, and a decoder
// that assumes `string` reads it as garbage or throws. Both outcomes end with a
// user adding a token whose displayed symbol is wrong, which on a send screen
// is how the wrong asset gets transferred.
//
// So this decoder handles BOTH shapes, and where it cannot decode at all it
// says so rather than substituting a placeholder. `null` for a symbol means
// "this contract did not tell us", which the UI can present honestly; a "?"
// invented here would be indistinguishable from a token genuinely called "?".
//
// EVERY VALUE HERE IS UNTRUSTED. `name` and `symbol` are attacker-chosen
// strings from a contract anyone can deploy — a token calling itself "USDC" is
// trivial to publish. They are sanitised for rendering (control characters,
// zero-width joiners and bidi overrides removed, length capped) and the UI must
// never present a user-added token as verified. See `sanitizeTokenText`.
// ---------------------------------------------------------------------------

function selector(signature: string): string {
  return bytesToHex(keccak_256(new TextEncoder().encode(signature)).slice(0, 4));
}

const SELECTORS = {
  name: selector("name()"),
  symbol: selector("symbol()"),
  decimals: selector("decimals()"),
  balanceOf: selector("balanceOf(address)"),
  totalSupply: selector("totalSupply()"),
} as const;

export interface Erc20Metadata {
  address: string;
  /** Null when the contract does not implement it or returned something undecodable. */
  name: string | null;
  symbol: string | null;
  /**
   * Decimals. NOT defaulted to 18 when absent.
   *
   * The 18 default is the single most damaging convenience in this file. A
   * token that returns nothing for `decimals()` and is treated as 18 when it is
   * really 6 displays a balance a million times too large, and an amount typed
   * against that display sends a million times too little — or, in the other
   * direction, a million times too much. `null` forces the caller to refuse the
   * token rather than guess.
   */
  decimals: number | null;
}

export class TokenReadError extends Error {
  readonly code: "not_a_contract" | "rpc_failed" | "not_erc20";
  constructor(code: TokenReadError["code"], message: string) {
    super(message);
    this.name = "TokenReadError";
    this.code = code;
  }
}

/**
 * C0 and C1 control characters.
 *
 * Written as escapes, never as literal bytes. A regex containing raw control
 * characters makes the source file binary to git and to every reviewer: the
 * class becomes unreadable, and nobody can tell an intended range from a
 * corrupted one. It has happened in this repo before.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * Zero-width and bidirectional-control characters.
 *
 * ZWSP/ZWNJ/ZWJ and the LRM/RLM marks (U+200B-U+200F), the LRE/RLE/PDF/LRO/RLO
 * overrides (U+202A-U+202E), the isolate controls and word joiner
 * (U+2060-U+2069), and the BOM (U+FEFF).
 *
 * Every one of these lets STORED text and RENDERED text differ. An RLO in a
 * symbol reverses what the user reads; a ZWJ makes two distinct tokens render
 * identically in a list. Both are used in the wild to pass a scam token off as
 * a real one, and a token list is exactly where that pays off.
 */
const INVISIBLE_CHARS = /[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

/**
 * Strip everything that lets a token name lie about what it is.
 *
 * Control characters, bidirectional overrides (U+202A-U+202E, U+2066-U+2069)
 * and zero-width characters are removed. This is not cosmetic: a right-to-left
 * override in a symbol can make "USDC-fake" render as "ekaf-CDSU" or reorder a
 * string so the visible text differs from the stored one, and zero-width joiners
 * let two distinct tokens render identically. Both are used in the wild to make
 * a scam token look like a real one in a list.
 *
 * Length is capped because a 4,000-character "symbol" is a layout attack on
 * every screen that renders it.
 */
export function sanitizeTokenText(raw: string, maxLength = 64): string {
  return (
    raw
      .replace(CONTROL_CHARS, "")
      .replace(INVISIBLE_CHARS, "")
      .trim()
      .slice(0, maxLength)
  );
}

/**
 * Decode an `eth_call` return that is either an ABI `string` or a `bytes32`.
 *
 * The discriminator is length: an ABI-encoded dynamic string is at least three
 * words (offset, length, data), a bytes32 is exactly one. Anything else is not
 * something we can read, and returns null.
 */
export function decodeStringReturn(hex: string): string | null {
  const body = (hex || "").replace(/^0x/, "");
  if (body.length === 0) return null;

  // bytes32: one word, right-padded with zeros.
  if (body.length === 64) {
    const bytes = hexToBytes(body).filter((b) => b !== 0);
    const text = latin1OrUtf8(bytes);
    return text ? sanitizeTokenText(text) : null;
  }

  // Dynamic string: [offset][length][data...]
  if (body.length >= 192) {
    try {
      const offset = Number(BigInt(`0x${body.slice(0, 64)}`));
      // The offset is a byte offset into the return data. A hostile or broken
      // contract can return one that points outside the payload; treating it as
      // valid would read whatever happened to be after it.
      if (!Number.isSafeInteger(offset) || offset < 32) return null;
      const lengthStart = offset * 2;
      if (lengthStart + 64 > body.length) return null;

      const length = Number(BigInt(`0x${body.slice(lengthStart, lengthStart + 64)}`));
      // 1KB is far beyond any legitimate token name and bounds the work.
      if (!Number.isSafeInteger(length) || length === 0 || length > 1024) return null;

      const dataStart = lengthStart + 64;
      if (dataStart + length * 2 > body.length) return null;

      const bytes = hexToBytes(body.slice(dataStart, dataStart + length * 2));
      const text = latin1OrUtf8(bytes);
      return text ? sanitizeTokenText(text) : null;
    } catch {
      return null;
    }
  }

  return null;
}

function hexToBytes(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

/**
 * Bytes to text, preferring UTF-8 and falling back to latin1.
 *
 * Old bytes32 tokens wrote ASCII; newer ones write UTF-8. Trying UTF-8 first
 * and falling back means an emoji-bearing name renders correctly and a plain
 * ASCII one is never mangled by a strict decoder.
 */
function latin1OrUtf8(bytes: number[]): string | null {
  if (bytes.length === 0) return null;
  const utf8 = tryUtf8(bytes);
  if (utf8 !== null) return utf8;
  return bytes.map((b) => String.fromCharCode(b)).join("");
}

function tryUtf8(bytes: number[]): string | null {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    let code: number;
    let len: number;
    if (b0 < 0x80) {
      code = b0;
      len = 1;
    } else if ((b0 & 0xe0) === 0xc0) {
      code = b0 & 0x1f;
      len = 2;
    } else if ((b0 & 0xf0) === 0xe0) {
      code = b0 & 0x0f;
      len = 3;
    } else if ((b0 & 0xf8) === 0xf0) {
      code = b0 & 0x07;
      len = 4;
    } else {
      return null;
    }
    if (i + len > bytes.length) return null;
    for (let k = 1; k < len; k++) {
      if ((bytes[i + k] & 0xc0) !== 0x80) return null;
      code = (code << 6) | (bytes[i + k] & 0x3f);
    }
    out += String.fromCodePoint(code);
    i += len;
  }
  return out;
}

export function decodeUintReturn(hex: string): bigint | null {
  const body = (hex || "").replace(/^0x/, "");
  if (body.length === 0 || body.length % 64 !== 0) return null;
  try {
    return BigInt(`0x${body.slice(0, 64)}`);
  } catch {
    return null;
  }
}

/**
 * Read a token's identity.
 *
 * The three calls run in PARALLEL and each is allowed to fail independently: a
 * token with no `name()` is unusual but legal, and refusing the whole read
 * because one optional method is missing would reject valid tokens. `decimals`
 * is the one that cannot be missing — see the field comment.
 */
export async function readErc20Metadata(chain: ChainSlug, address: string): Promise<Erc20Metadata> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new TokenReadError("not_a_contract", "That is not a valid contract address.");
  }

  const [nameRes, symbolRes, decimalsRes] = await Promise.allSettled([
    call(chain, address, SELECTORS.name),
    call(chain, address, SELECTORS.symbol),
    call(chain, address, SELECTORS.decimals),
  ]);

  // Every call failing at the RPC layer means we learned nothing about this
  // address — a different situation from a contract that answered but has no
  // name, and the user needs the difference to know whether retrying helps.
  if (
    nameRes.status === "rejected" &&
    symbolRes.status === "rejected" &&
    decimalsRes.status === "rejected"
  ) {
    const reason = decimalsRes.reason;
    throw new TokenReadError(
      "rpc_failed",
      reason instanceof RpcError ? reason.message : "Could not reach the network to read this token.",
    );
  }

  const decimalsRaw = decimalsRes.status === "fulfilled" ? decodeUintReturn(decimalsRes.value) : null;
  // Beyond 36 decimals nothing real exists and the fixed-point maths downstream
  // starts losing meaning; a contract claiming 200 is hostile or broken.
  const decimals =
    decimalsRaw !== null && decimalsRaw >= 0n && decimalsRaw <= 36n ? Number(decimalsRaw) : null;

  return {
    address,
    name: nameRes.status === "fulfilled" ? decodeStringReturn(nameRes.value) : null,
    symbol: symbolRes.status === "fulfilled" ? decodeStringReturn(symbolRes.value) : null,
    decimals,
  };
}

/** ERC-20 `balanceOf(owner)`. Null when the call fails or returns nothing. */
export async function readErc20Balance(
  chain: ChainSlug,
  token: string,
  owner: string,
): Promise<bigint | null> {
  const data = `${SELECTORS.balanceOf}${owner.replace(/^0x/, "").toLowerCase().padStart(64, "0")}`;
  try {
    return decodeUintReturn(await call(chain, token, data));
  } catch {
    // Null, not 0n. A zero balance and an unreadable one look identical to a
    // portfolio screen, and only one of them means "you hold none of this".
    return null;
  }
}

export { SELECTORS as ERC20_SELECTORS };
