// ---------------------------------------------------------------------------
// Keccak-256, as Ethereum uses it.
//
// WHY THIS IS HERE RATHER THAN A DEPENDENCY. EIP-55 checksums are the one thing
// in this package that needs a hash, and this package's entire proposition is
// that you can drop it into a wallet without auditing a dependency tree. One
// import would undo that.
//
// It is NOT hand-rolled cryptography in the dangerous sense: there is no key,
// no nonce and no secret input — every byte hashed here is a public address the
// attacker already knows. The only property that matters is functional
// correctness, and correctness of a hash is settled by test vectors, not by
// trust. test/keccak.test.js pins the empty-string digest, the "abc" digest and
// the four canonical EIP-55 addresses from the ERC itself. If any bit of this
// were wrong, none of those would pass.
//
// NOTE THE PADDING. Ethereum uses ORIGINAL Keccak (pad byte 0x01), not the
// later NIST SHA3-256 (pad byte 0x06). They differ in exactly one byte and
// produce completely different digests, and picking the wrong one is the single
// most common way this gets implemented incorrectly.
// ---------------------------------------------------------------------------

/** Round constants for Keccak-f[1600], as 64-bit values. */
const ROUND_CONSTANTS: bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

// ρ and π are applied in one 24-step loop, so BOTH tables below are indexed by
// LOOP ITERATION (0–23) — not by lane. There is a second, equally valid table
// of rotation offsets indexed by lane position (0, 1, 62, 28, 27, …), and
// mixing the two conventions produces a permutation that looks plausible,
// permutes 25 lanes, and yields entirely wrong digests. The vectors in
// test/keccak.test.js are what catch that.

/** Rotation offset for each step of the combined ρ/π loop. */
const ROTATION = [
  1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44,
];

/** Destination lane for each step of the combined ρ/π loop. */
const PI_LANE = [
  10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1,
];

const MASK64 = (1n << 64n) - 1n;

function rotl64(value: bigint, shift: number): bigint {
  const s = BigInt(shift);
  return ((value << s) | (value >> (64n - s))) & MASK64;
}

/** The Keccak-f[1600] permutation, in place on a 25-lane state. */
function permute(state: bigint[]): void {
  for (let round = 0; round < 24; round++) {
    // θ — parity of each column, folded back into every lane.
    const c: bigint[] = new Array(5);
    for (let x = 0; x < 5; x++) {
      c[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    }
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5] ^ rotl64(c[(x + 1) % 5], 1);
      for (let y = 0; y < 25; y += 5) state[x + y] ^= d;
    }

    // ρ and π — rotate each lane, then move it.
    let last = state[1];
    for (let i = 0; i < 24; i++) {
      const target = PI_LANE[i];
      const temp = state[target];
      state[target] = rotl64(last, ROTATION[i]);
      last = temp;
    }

    // χ — the only non-linear step.
    for (let y = 0; y < 25; y += 5) {
      const row = [state[y], state[y + 1], state[y + 2], state[y + 3], state[y + 4]];
      for (let x = 0; x < 5; x++) {
        state[y + x] = row[x] ^ (~row[(x + 1) % 5] & MASK64 & row[(x + 2) % 5]);
      }
    }

    // ι — break the round's symmetry.
    state[0] ^= ROUND_CONSTANTS[round];
  }
}

/** Rate in bytes for Keccak-256: (1600 - 2×256) / 8. */
const RATE = 136;

/**
 * Keccak-256 of `input`, returning 32 bytes.
 *
 * Absorbs `RATE` bytes at a time, applies multi-rate padding, then squeezes a
 * single block — the digest is shorter than the rate, so one squeeze suffices
 * and no extra permutation is needed.
 */
export function keccak256(input: Uint8Array): Uint8Array {
  const state: bigint[] = new Array(25).fill(0n);

  // Pad: 0x01, zeroes, then 0x80 on the final byte of the last block. When the
  // message is one byte short of the rate these collapse onto the same byte,
  // which is why the OR below is not an assignment.
  const padded = new Uint8Array(Math.floor(input.length / RATE + 1) * RATE);
  padded.set(input);
  padded[input.length] = 0x01;
  padded[padded.length - 1] |= 0x80;

  for (let offset = 0; offset < padded.length; offset += RATE) {
    for (let i = 0; i < RATE / 8; i++) {
      // Little-endian: lane 0 is the first 8 bytes, least significant first.
      let lane = 0n;
      for (let b = 7; b >= 0; b--) {
        lane = (lane << 8n) | BigInt(padded[offset + i * 8 + b]);
      }
      state[i] ^= lane;
    }
    permute(state);
  }

  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    let lane = state[i];
    for (let b = 0; b < 8; b++) {
      out[i * 8 + b] = Number(lane & 0xffn);
      lane >>= 8n;
    }
  }
  return out;
}

/** UTF-8 encode without depending on a global TextEncoder shim. */
export function utf8(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // Surrogate pair → one code point.
      const low = text.charCodeAt(++i);
      code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    } else {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return new Uint8Array(out);
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
