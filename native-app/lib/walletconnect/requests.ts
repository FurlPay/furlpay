import { WC_ERRORS, type SessionRequest, type WcRpcError } from "./types";
import { chainIdFromCaip } from "./policy";

// ---------------------------------------------------------------------------
// Decoding what a dApp actually asked for.
//
// EVERY FIELD HERE ARRIVES FROM A REMOTE PARTY AND IS ASSUMED HOSTILE. A dApp
// can send any JSON at all: missing fields, wrong types, a `to` that is not an
// address, a `value` of "0x" + 500 digits, an array where an object belongs.
// None of that may throw — a decode failure has to become a JSON-RPC error we
// hand back, because an exception here would leave the dApp waiting forever on
// a request the wallet silently dropped.
//
// WHY THIS IS A SEPARATE FILE FROM THE UI. The confirmation sheet must render
// exactly what will be signed and nothing else. Keeping the decode pure and
// tested means the sheet has no branch of its own that could show one thing
// while the signer signs another — the classic wallet confirmation bug, and the
// reason clear-signing exists at all.
//
// NUMBERS ARE bigint, NEVER number. A wei value exceeds 2^53 constantly; 1 ETH
// is 10^18. Parsing into a JS number silently rounds, and a rounded value
// rendered to the user is a number they did not agree to. Every quantity here
// stays exact from the wire to the screen.
// ---------------------------------------------------------------------------

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HEX_RE = /^0x[0-9a-fA-F]*$/;

export interface TransactionIntent {
  kind: "transaction";
  /** Whether the dApp wants it broadcast (`eth_sendTransaction`) or just signed. */
  broadcast: boolean;
  chainId: number;
  from: string;
  to: string;
  value: bigint;
  data: string;
  /** Present only when the dApp specified one; otherwise we estimate. */
  gasLimit?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  nonce?: bigint;
}

export interface PersonalSignIntent {
  kind: "personal_sign";
  chainId: number;
  address: string;
  /** Raw bytes as hex, exactly as they will be signed. */
  messageHex: string;
  /**
   * UTF-8 rendering, when the bytes are valid printable UTF-8.
   *
   * Absent for binary payloads, and that absence is load-bearing: a message the
   * app cannot render as text must be shown as hex with a warning, never as a
   * lossy "best effort" string. Lossy decoding is how a user reads "Sign in to
   * example.com" from bytes that say something else.
   */
  messageText?: string;
}

export interface TypedDataIntent {
  kind: "typed_data";
  chainId: number;
  address: string;
  /** EIP-712 domain, as sent. */
  domain: Record<string, unknown>;
  primaryType: string;
  message: Record<string, unknown>;
  types: Record<string, unknown>;
  /**
   * True when the payload is a token-spending approval (Permit / Permit2).
   *
   * Flagged here rather than left for the UI to sniff, because this is the
   * single highest-risk EIP-712 shape: it looks like "signing a message" and is
   * in fact granting an allowance, and it is the mechanism behind most
   * signature-phishing drains.
   */
  isPermit: boolean;
}

export interface SwitchChainIntent {
  kind: "switch_chain";
  chainId: number;
}

export type RequestIntent = TransactionIntent | PersonalSignIntent | TypedDataIntent | SwitchChainIntent;

export type DecodeResult = { ok: true; intent: RequestIntent } | { ok: false; error: WcRpcError };

function invalid(detail: string): DecodeResult {
  return { ok: false, error: { code: WC_ERRORS.INVALID_PARAMS.code, message: detail } };
}

/**
 * Hex quantity -> bigint.
 *
 * Accepts the decimal strings some dApps send in place of hex, because they are
 * common enough that refusing them breaks real sites, but refuses anything that
 * is neither — a silent 0n for an unparseable value would render a transfer of
 * "0" for a transaction that moves funds.
 */
function toBigInt(value: unknown, field: string): bigint | { error: string } {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return { error: `${field} is not a valid amount` };
    return BigInt(value);
  }
  if (typeof value !== "string") return { error: `${field} is not a valid amount` };
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "0x") return 0n;
  try {
    if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
      if (!HEX_RE.test(trimmed)) return { error: `${field} is not valid hex` };
      return BigInt(trimmed);
    }
    if (!/^\d+$/.test(trimmed)) return { error: `${field} is not a valid amount` };
    return BigInt(trimmed);
  } catch {
    return { error: `${field} is not a valid amount` };
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Decode any supported request. Never throws. */
export function decodeRequest(request: SessionRequest): DecodeResult {
  const chainId = chainIdFromCaip(request.chainId);
  if (chainId === null) {
    return { ok: false, error: { code: WC_ERRORS.UNSUPPORTED_CHAIN.code, message: "Unrecognised network." } };
  }

  const params = Array.isArray(request.params) ? request.params : [];

  switch (request.method) {
    case "eth_sendTransaction":
    case "eth_signTransaction":
      return decodeTransaction(params, chainId, request.method === "eth_sendTransaction");
    case "personal_sign":
      return decodePersonalSign(params, chainId);
    case "eth_signTypedData":
    case "eth_signTypedData_v4":
      return decodeTypedData(params, chainId);
    case "wallet_switchEthereumChain":
      return decodeSwitchChain(params);
    default:
      return { ok: false, error: { code: WC_ERRORS.UNSUPPORTED_METHOD.code, message: WC_ERRORS.UNSUPPORTED_METHOD.message } };
  }
}

function decodeTransaction(params: unknown[], chainId: number, broadcast: boolean): DecodeResult {
  const tx = asRecord(params[0]);
  if (!tx) return invalid("Transaction request had no transaction object.");

  const from = typeof tx.from === "string" ? tx.from : "";
  if (!ADDRESS_RE.test(from)) return invalid("Transaction is missing a valid sender address.");

  // Contract creation (`to` absent) is refused rather than decoded: this wallet
  // has no way to show a user what bytecode they would be deploying, and
  // signing an opaque deployment is exactly the blind approval the whole
  // confirmation flow exists to prevent.
  const to = typeof tx.to === "string" ? tx.to : "";
  if (!ADDRESS_RE.test(to)) {
    return invalid(
      to === "" ? "FurlPay does not support contract deployment from a connected site." : "Transaction has an invalid recipient address.",
    );
  }

  const data = typeof tx.data === "string" ? tx.data : typeof tx.input === "string" ? tx.input : "0x";
  if (!HEX_RE.test(data)) return invalid("Transaction data is not valid hex.");

  const value = tx.value === undefined || tx.value === null ? 0n : toBigInt(tx.value, "value");
  if (typeof value !== "bigint") return invalid(value.error);

  const out: TransactionIntent = { kind: "transaction", broadcast, chainId, from, to, value, data };

  // Optional hints. A malformed one is rejected rather than ignored: dropping a
  // bad gasLimit and estimating instead would silently overrule a dApp that had
  // a reason for the number it sent.
  for (const [field, key] of [
    ["gas", "gasLimit"],
    ["gasLimit", "gasLimit"],
    ["maxFeePerGas", "maxFeePerGas"],
    ["maxPriorityFeePerGas", "maxPriorityFeePerGas"],
    ["nonce", "nonce"],
  ] as const) {
    const raw = tx[field];
    if (raw === undefined || raw === null) continue;
    const parsed = toBigInt(raw, field);
    if (typeof parsed !== "bigint") return invalid(parsed.error);
    (out as unknown as Record<string, bigint>)[key] = parsed;
  }

  return { ok: true, intent: out };
}

/**
 * personal_sign params are [message, address] — the REVERSE of eth_sign.
 *
 * Wallets have shipped this backwards repeatedly. Both orders are accepted here
 * by detecting which element is an address, because a strict reading breaks a
 * meaningful number of real dApps, and the ambiguity is resolvable without
 * guessing: an address matches a 20-byte hex pattern and a message essentially
 * never does.
 */
function decodePersonalSign(params: unknown[], chainId: number): DecodeResult {
  const [a, b] = params;
  let messageRaw: unknown;
  let address: string;

  if (typeof b === "string" && ADDRESS_RE.test(b)) {
    messageRaw = a;
    address = b;
  } else if (typeof a === "string" && ADDRESS_RE.test(a)) {
    address = a;
    messageRaw = b;
  } else {
    return invalid("Signature request is missing an address.");
  }

  if (typeof messageRaw !== "string") return invalid("Signature request is missing a message.");

  // A message may legitimately be plain text rather than hex — the spec says
  // hex, practice says otherwise.
  const messageHex = HEX_RE.test(messageRaw) ? messageRaw : utf8ToHex(messageRaw);
  const messageText = HEX_RE.test(messageRaw) ? hexToUtf8(messageRaw) : messageRaw;

  return {
    ok: true,
    intent: { kind: "personal_sign", chainId, address, messageHex, messageText },
  };
}

function decodeTypedData(params: unknown[], chainId: number): DecodeResult {
  const [a, b] = params;
  const address = typeof a === "string" && ADDRESS_RE.test(a) ? a : typeof b === "string" && ADDRESS_RE.test(b) ? b : "";
  if (!address) return invalid("Typed-data request is missing an address.");

  const payloadRaw = typeof a === "string" && ADDRESS_RE.test(a) ? b : a;
  let payload: Record<string, unknown> | null;
  if (typeof payloadRaw === "string") {
    try {
      payload = asRecord(JSON.parse(payloadRaw));
    } catch {
      return invalid("Typed-data payload is not valid JSON.");
    }
  } else {
    payload = asRecord(payloadRaw);
  }
  if (!payload) return invalid("Typed-data payload is missing.");

  const domain = asRecord(payload.domain) ?? {};
  const message = asRecord(payload.message) ?? {};
  const types = asRecord(payload.types) ?? {};
  const primaryType = typeof payload.primaryType === "string" ? payload.primaryType : "";
  if (!primaryType) return invalid("Typed-data payload has no primaryType.");

  return {
    ok: true,
    intent: { kind: "typed_data", chainId, address, domain, primaryType, message, types, isPermit: looksLikePermit(primaryType, message) },
  };
}

/**
 * Does this typed-data payload grant a spending allowance?
 *
 * Matched on primaryType AND on the field shape, because the type name is
 * chosen by whoever wrote the contract and a drainer will not call it "Permit".
 * A payload carrying a spender and an amount or token id is an approval
 * whatever it is named, and the UI must warn on it.
 */
export function looksLikePermit(primaryType: string, message: Record<string, unknown>): boolean {
  const name = primaryType.toLowerCase();
  if (name.includes("permit")) return true;
  const keys = new Set(Object.keys(message).map((k) => k.toLowerCase()));
  const hasSpender = keys.has("spender") || keys.has("operator") || keys.has("delegate");
  const hasAmount = keys.has("value") || keys.has("amount") || keys.has("allowed") || keys.has("tokenid");
  return hasSpender && hasAmount;
}

function decodeSwitchChain(params: unknown[]): DecodeResult {
  const arg = asRecord(params[0]);
  if (!arg) return invalid("Network switch request had no target.");
  const parsed = toBigInt(arg.chainId, "chainId");
  if (typeof parsed !== "bigint") return invalid(parsed.error);
  const id = Number(parsed);
  if (!Number.isSafeInteger(id) || id <= 0) return invalid("Network switch request had an invalid chain id.");
  return { ok: true, intent: { kind: "switch_chain", chainId: id } };
}

// --- hex/utf8 ---------------------------------------------------------------
//
// Hand-rolled rather than Buffer/TextDecoder: Hermes ships neither reliably
// across the RN versions this app supports, and a polyfill that is present in
// Jest but absent on device is how a confirmation screen renders correctly in
// tests and garbage in production.

export function utf8ToHex(input: string): string {
  let out = "0x";
  for (const byte of utf8Bytes(input)) out += byte.toString(16).padStart(2, "0");
  return out;
}

function utf8Bytes(input: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    let code = input.codePointAt(i)!;
    if (code > 0xffff) i++; // surrogate pair consumed
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
  }
  return bytes;
}

/**
 * Hex -> string, or undefined when the bytes are not clean printable UTF-8.
 *
 * Returning undefined rather than a replacement-character string is deliberate:
 * see PersonalSignIntent.messageText. A partially-decoded message is a message
 * the user cannot trust, and the UI needs to know the difference.
 */
export function hexToUtf8(hex: string): string | undefined {
  if (!HEX_RE.test(hex)) return undefined;
  const body = hex.slice(2);
  if (body.length % 2 !== 0) return undefined;

  const bytes: number[] = [];
  for (let i = 0; i < body.length; i += 2) bytes.push(parseInt(body.slice(i, i + 2), 16));

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
      return undefined;
    }
    if (i + len > bytes.length) return undefined;
    for (let k = 1; k < len; k++) {
      const cont = bytes[i + k];
      if ((cont & 0xc0) !== 0x80) return undefined;
      code = (code << 6) | (cont & 0x3f);
    }
    // Control characters other than tab/newline/carriage return mean this is
    // binary that happens to decode, not text a user should be shown.
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return undefined;
    out += String.fromCodePoint(code);
    i += len;
  }
  return out;
}
