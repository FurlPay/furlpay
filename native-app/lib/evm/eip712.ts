import { keccak_256 } from "@noble/hashes/sha3";

// ---------------------------------------------------------------------------
// Generic EIP-712 typed-data hashing.
//
// WHY THIS EXISTS ALONGSIDE computeAuthorizationDigest IN lib/wallet.ts. That
// function hashes ONE struct — TransferWithAuthorization — with its typehash
// written out as a string literal. That is the right shape for a payload the
// app constructs itself: the type is known at build time, the encoding is four
// lines, and there is nothing to get wrong at runtime.
//
// It is the wrong shape for eth_signTypedData_v4, where the struct is whatever
// a dApp sends. That needs the actual algorithm: recursive type collection,
// alphabetical ordering of referenced types, arrays, nested structs, dynamic
// bytes and strings. So this file implements EIP-712 properly, and the
// hardcoded path stays as it is — replacing a correct, tested, purpose-built
// encoder with a general one would be a regression in confidence for no gain.
//
// THE PARTS THAT ARE EASY TO GET WRONG, and are therefore the parts the tests
// in __tests__/eip712.test.ts pin against known vectors:
//
//   - encodeType sorts REFERENCED types alphabetically but keeps the primary
//     type first. Sorting everything is the classic bug and it produces a
//     different typehash, which means a signature that recovers to a different
//     address than the contract expects.
//   - `bytes` and `string` are hashed; `bytesN` is left-aligned and padded
//     RIGHT, while every numeric type pads LEFT. Getting the alignment
//     backwards silently produces a valid-looking signature over the wrong data.
//   - Arrays are the keccak of the concatenated encodings of their elements,
//     NOT of the RLP or of a length prefix.
//   - EIP712Domain is itself a struct, and its typehash depends on which
//     fields are actually PRESENT. A domain with no `salt` must not hash as if
//     it had one, so the domain type is built from the value, not from a
//     constant.
//
// NOTHING HERE SIGNS. It produces a 32-byte digest; the signer decides whether
// the user has agreed to it. Keeping hashing separate from signing is what
// stops this file from becoming a blind-signing oracle.
// ---------------------------------------------------------------------------

export interface TypedDataField {
  name: string;
  type: string;
}

export type TypedDataTypes = Record<string, TypedDataField[]>;

export interface TypedDataDomain {
  name?: string;
  version?: string;
  chainId?: number | string | bigint;
  verifyingContract?: string;
  salt?: string;
}

export class TypedDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TypedDataError";
  }
}

const utf8 = (s: string) => new TextEncoder().encode(s);

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, "");
  if (clean.length % 2 !== 0) throw new TypedDataError(`Hex value has an odd length: ${hex}`);
  if (clean.length > 0 && !/^[0-9a-fA-F]+$/.test(clean)) throw new TypedDataError(`Not hex: ${hex}`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = "0x";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** A signed or unsigned integer as a 32-byte big-endian word. */
function intWord(value: bigint, signed: boolean): Uint8Array {
  // Two's complement for negatives: int256 is a real EIP-712 type and a
  // negative value encoded as if unsigned hashes to something no contract will
  // accept.
  let v = value;
  if (v < 0n) {
    if (!signed) throw new TypedDataError("Negative value for an unsigned type.");
    v = (1n << 256n) + v;
  }
  if (v >= 1n << 256n) throw new TypedDataError("Value exceeds 256 bits.");
  const hex = v.toString(16).padStart(64, "0");
  return hexToBytes(hex);
}

function toBigInt(value: unknown, type: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new TypedDataError(`${type} value is not an integer.`);
    return BigInt(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") throw new TypedDataError(`${type} value is empty.`);
    try {
      return BigInt(trimmed);
    } catch {
      throw new TypedDataError(`${type} value is not a number: ${trimmed}`);
    }
  }
  throw new TypedDataError(`${type} value has an unsupported JavaScript type.`);
}

const ARRAY_RE = /^(.*)\[(\d*)\]$/;
const BYTES_N_RE = /^bytes(\d+)$/;
const INT_RE = /^(u?int)(\d*)$/;

/** Is `type` a struct defined in `types` (as opposed to an atomic type)? */
function isStruct(type: string, types: TypedDataTypes): boolean {
  return Object.prototype.hasOwnProperty.call(types, type);
}

/**
 * Every struct type reachable from `primaryType`, sorted the way EIP-712
 * requires: the primary type first, then the rest alphabetically.
 */
export function collectDependencies(primaryType: string, types: TypedDataTypes): string[] {
  const found = new Set<string>();

  const visit = (type: string) => {
    const base = type.replace(/\[\d*\]$/, "");
    if (found.has(base) || !isStruct(base, types)) return;
    found.add(base);
    for (const field of types[base]) visit(field.type);
  };

  visit(primaryType);
  found.delete(primaryType);
  // Alphabetical for the referenced types ONLY. Sorting the primary type in
  // with them changes the typehash and produces a signature the verifying
  // contract will not recognise.
  return [primaryType, ...Array.from(found).sort()];
}

/** `Mail(Person from,Person to,string contents)Person(string name,address wallet)` */
export function encodeType(primaryType: string, types: TypedDataTypes): string {
  if (!isStruct(primaryType, types)) throw new TypedDataError(`Unknown type: ${primaryType}`);
  return collectDependencies(primaryType, types)
    .map((name) => `${name}(${types[name].map((f) => `${f.type} ${f.name}`).join(",")})`)
    .join("");
}

export function typeHash(primaryType: string, types: TypedDataTypes): Uint8Array {
  return keccak_256(utf8(encodeType(primaryType, types)));
}

/** One field, as its 32-byte EIP-712 encoding. */
function encodeValue(type: string, value: unknown, types: TypedDataTypes): Uint8Array {
  const arrayMatch = ARRAY_RE.exec(type);
  if (arrayMatch) {
    const [, baseType, fixedLength] = arrayMatch;
    if (!Array.isArray(value)) throw new TypedDataError(`${type} value is not an array.`);
    if (fixedLength !== "" && value.length !== Number(fixedLength)) {
      throw new TypedDataError(`${type} expects ${fixedLength} items, got ${value.length}.`);
    }
    // keccak of the concatenated element encodings — no length prefix.
    return keccak_256(concat(...value.map((item) => encodeValue(baseType, item, types))));
  }

  if (isStruct(type, types)) {
    return hashStruct(type, value as Record<string, unknown>, types);
  }

  if (type === "string") {
    if (typeof value !== "string") throw new TypedDataError("string value is not a string.");
    return keccak_256(utf8(value));
  }

  if (type === "bytes") {
    if (typeof value !== "string") throw new TypedDataError("bytes value must be a hex string.");
    return keccak_256(hexToBytes(value));
  }

  if (type === "bool") {
    return intWord(value ? 1n : 0n, false);
  }

  if (type === "address") {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
      throw new TypedDataError(`address value is malformed: ${String(value)}`);
    }
    return intWord(BigInt(value), false);
  }

  const bytesN = BYTES_N_RE.exec(type);
  if (bytesN) {
    const size = Number(bytesN[1]);
    if (size < 1 || size > 32) throw new TypedDataError(`Invalid type: ${type}`);
    if (typeof value !== "string") throw new TypedDataError(`${type} value must be a hex string.`);
    const bytes = hexToBytes(value);
    if (bytes.length > size) throw new TypedDataError(`${type} value is longer than ${size} bytes.`);
    // bytesN is LEFT-aligned: padded on the RIGHT. Every numeric type is the
    // opposite. Getting this backwards produces a valid signature over data
    // nobody meant to sign.
    const word = new Uint8Array(32);
    word.set(bytes, 0);
    return word;
  }

  const intMatch = INT_RE.exec(type);
  if (intMatch) {
    const signed = intMatch[1] === "int";
    const bits = intMatch[2] === "" ? 256 : Number(intMatch[2]);
    if (bits % 8 !== 0 || bits < 8 || bits > 256) throw new TypedDataError(`Invalid type: ${type}`);
    return intWord(toBigInt(value, type), signed);
  }

  throw new TypedDataError(`Unsupported type: ${type}`);
}

export function encodeData(
  primaryType: string,
  data: Record<string, unknown>,
  types: TypedDataTypes,
): Uint8Array {
  const fields = types[primaryType];
  if (!fields) throw new TypedDataError(`Unknown type: ${primaryType}`);
  return concat(
    typeHash(primaryType, types),
    ...fields.map((f) => encodeValue(f.type, data?.[f.name], types)),
  );
}

export function hashStruct(
  primaryType: string,
  data: Record<string, unknown>,
  types: TypedDataTypes,
): Uint8Array {
  return keccak_256(encodeData(primaryType, data, types));
}

/**
 * The domain separator.
 *
 * THE DOMAIN TYPE IS DERIVED FROM WHICH FIELDS ARE PRESENT, not from a
 * constant. EIP-712 lets a domain omit any of its five fields, and a domain
 * with no `salt` must not hash as though it had one — that produces a separator
 * the verifying contract does not compute, and a signature it will reject with
 * no useful error. Field ORDER is fixed by the spec regardless of the order the
 * dApp wrote them in.
 */
export function hashDomain(domain: TypedDataDomain): Uint8Array {
  const fields: TypedDataField[] = [];
  const values: Record<string, unknown> = {};

  if (domain.name !== undefined) {
    fields.push({ name: "name", type: "string" });
    values.name = domain.name;
  }
  if (domain.version !== undefined) {
    fields.push({ name: "version", type: "string" });
    values.version = domain.version;
  }
  if (domain.chainId !== undefined) {
    fields.push({ name: "chainId", type: "uint256" });
    values.chainId = domain.chainId;
  }
  if (domain.verifyingContract !== undefined) {
    fields.push({ name: "verifyingContract", type: "address" });
    values.verifyingContract = domain.verifyingContract;
  }
  if (domain.salt !== undefined) {
    fields.push({ name: "salt", type: "bytes32" });
    values.salt = domain.salt;
  }

  return hashStruct("EIP712Domain", values, { EIP712Domain: fields });
}

/**
 * The 32-byte digest an EIP-712 signature covers: keccak(0x19 0x01 ‖ domain ‖ struct).
 *
 * `types` may include an `EIP712Domain` entry (dApps send one); it is IGNORED
 * in favour of the domain reconstructed from the domain VALUE. A dApp that
 * declares a domain type listing fields its domain object does not contain
 * would otherwise steer us into computing a separator no contract agrees with.
 */
export function hashTypedData(input: {
  domain: TypedDataDomain;
  types: TypedDataTypes;
  primaryType: string;
  message: Record<string, unknown>;
}): string {
  const { EIP712Domain: _ignored, ...structTypes } = input.types;
  if (!structTypes[input.primaryType]) {
    throw new TypedDataError(`primaryType "${input.primaryType}" is not defined in types.`);
  }
  const digest = keccak_256(
    concat(
      new Uint8Array([0x19, 0x01]),
      hashDomain(input.domain),
      hashStruct(input.primaryType, input.message, structTypes),
    ),
  );
  return bytesToHex(digest);
}

/**
 * Validate a dApp's typed-data payload before anything else touches it.
 *
 * Returns a reason string rather than throwing, because the caller's job is to
 * turn this into a JSON-RPC error for the dApp, not to crash a confirmation
 * screen. Depth and breadth are capped: a deeply self-referential type graph
 * would otherwise recurse until the JS stack gives out, which a remote party
 * should not be able to trigger.
 */
export function validateTypedData(input: {
  domain: unknown;
  types: unknown;
  primaryType: unknown;
  message: unknown;
}): { ok: true } | { ok: false; reason: string } {
  if (typeof input.primaryType !== "string" || input.primaryType === "") {
    return { ok: false, reason: "primaryType is missing." };
  }
  if (!input.types || typeof input.types !== "object") return { ok: false, reason: "types is missing." };
  if (!input.message || typeof input.message !== "object") return { ok: false, reason: "message is missing." };
  if (!input.domain || typeof input.domain !== "object") return { ok: false, reason: "domain is missing." };

  const types = input.types as Record<string, unknown>;
  const names = Object.keys(types);
  if (names.length > 100) return { ok: false, reason: "Too many types." };

  for (const name of names) {
    const fields = types[name];
    if (!Array.isArray(fields)) return { ok: false, reason: `Type ${name} is not a list of fields.` };
    if (fields.length > 100) return { ok: false, reason: `Type ${name} has too many fields.` };
    for (const f of fields) {
      if (!f || typeof f !== "object") return { ok: false, reason: `Type ${name} has a malformed field.` };
      const { name: fname, type: ftype } = f as { name?: unknown; type?: unknown };
      if (typeof fname !== "string" || typeof ftype !== "string") {
        return { ok: false, reason: `Type ${name} has a field with no name or type.` };
      }
    }
  }

  if (!Object.prototype.hasOwnProperty.call(types, input.primaryType)) {
    return { ok: false, reason: `primaryType "${input.primaryType}" is not defined in types.` };
  }

  // Cycle check. A type graph that references itself is legal to WRITE and
  // impossible to hash — encodeValue would recurse forever. Catching it here
  // turns a stack overflow into a JSON-RPC error the dApp can read.
  const visiting = new Set<string>();
  const done = new Set<string>();
  const walk = (type: string): string | null => {
    const base = type.replace(/\[\d*\]$/, "");
    if (!Object.prototype.hasOwnProperty.call(types, base)) return null;
    if (done.has(base)) return null;
    if (visiting.has(base)) return `Type ${base} refers to itself.`;
    visiting.add(base);
    for (const f of types[base] as TypedDataField[]) {
      const err = walk(f.type);
      if (err) return err;
    }
    visiting.delete(base);
    done.add(base);
    return null;
  };
  const cycle = walk(input.primaryType);
  if (cycle) return { ok: false, reason: cycle };

  return { ok: true };
}
