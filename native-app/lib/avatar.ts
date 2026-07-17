// ---------------------------------------------------------------------------
// Identity helpers — pure and dependency-free so they are unit-testable and run
// identically on device, in Node, and offline.
//
//   shortUid(userId) -> a stable, DISPLAY-ONLY "FP-XXXXXXX" account id
//
// The avatar itself is NOT deterministic art: FurlPay shows a neutral human
// silhouette (or the user's real photo when available), see components/Avatar.tsx.
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit. Deterministic, fast, no dependencies. */
export function stableHash(input: string): number {
  let h = 0x811c9dc5;
  const s = input || "furlpay";
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Crockford base32 (no I/L/O/U — visually unambiguous when read aloud/copied).
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Short, human-friendly, DISPLAY-ONLY account id, e.g. "FP-8K4M92X".
 *
 * Derived one-way from the internal user id, so it is stable per user but
 * cannot be used to recover the UUID or to authenticate. Use it wherever a user
 * needs to reference their account (support, sharing) instead of the raw UUID.
 */
export function shortUid(id: string): string {
  let a = stableHash(id);
  let b = stableHash(`furlpay:uid:${id}`);
  let out = "";
  for (let i = 0; i < 7; i++) {
    out += B32[a & 31];
    const next = ((a >>> 5) ^ Math.imul(b, 0x01000193)) >>> 0;
    a = next;
    b = ((b >>> 3) ^ (a << 13)) >>> 0;
  }
  return `FP-${out}`;
}
