// HyperLogLog sketches for unique senders/receivers. Same hash and register
// rule as the census (scripts/onchain/usdc-history-scan.mjs), which was
// measured within 0.5% of exact counts at p=14. Sketches merge by
// register-wise max (the merge equals the sketch of the union), so they are
// built here and merged in PostgreSQL (usdc_hll_merge) without an extension.
// Standard error ≈ 1.04 / sqrt(2^p): p=12 → 1.63%, p=14 → 0.81%.

export type Sketch = Uint8Array;

export const newSketch = (p: number): Sketch => new Uint8Array(1 << p);

function h64(s: string): [number, number] {
  let a = 0x9747b28c ^ s.length;
  let b = 0x85ebca6b ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0xcc9e2d51);
    a = (a << 15) | (a >>> 17);
    a = Math.imul(a, 0x1b873593);
    b = Math.imul(b ^ c, 0x5bd1e995);
    b = (b << 13) | (b >>> 19);
    b = Math.imul(b, 0xc2b2ae35);
  }
  a ^= a >>> 16;
  a = Math.imul(a, 0x85ebca6b);
  a ^= a >>> 13;
  a = Math.imul(a, 0xc2b2ae35);
  a ^= a >>> 16;
  b ^= b >>> 15;
  b = Math.imul(b, 0x2c1b3c6d);
  b ^= b >>> 12;
  b = Math.imul(b, 0x297a2d39);
  b ^= b >>> 15;
  return [a >>> 0, b >>> 0];
}

const pOf = (reg: Sketch) => Math.log2(reg.length);

export function hllAdd(reg: Sketch, value: string): void {
  const p = pOf(reg);
  const [a, b] = h64(value);
  const idx = a >>> (32 - p);
  const rest = (a << p) >>> 0;
  const rank = rest !== 0 ? Math.clz32(rest) + 1 : 32 - p + (b !== 0 ? Math.clz32(b) + 1 : 33);
  if (rank > reg[idx]) reg[idx] = rank;
}

export function hllMerge(into: Sketch, other: Sketch): Sketch {
  if (into.length !== other.length) throw new Error(`sketch sizes differ: ${into.length} vs ${other.length}`);
  for (let i = 0; i < into.length; i++) if (other[i] > into[i]) into[i] = other[i];
  return into;
}

export function hllCount(reg: Sketch): number {
  const m = reg.length;
  let sum = 0;
  let zeros = 0;
  for (let i = 0; i < m; i++) {
    sum += 2 ** -reg[i];
    if (reg[i] === 0) zeros++;
  }
  const e = ((0.7213 / (1 + 1.079 / m)) * m * m) / sum;
  if (e <= 2.5 * m && zeros > 0) return Math.round(m * Math.log(m / zeros));
  return Math.round(e);
}

export const stdError = (p: number) => +(1.04 / Math.sqrt(2 ** p)).toFixed(4);
export const toHex = (reg: Sketch) => Buffer.from(reg).toString("hex");
/** PostgREST returns bytea as "\\x…" hex. */
export const fromHex = (h: string | null | undefined): Sketch | null => (h ? new Uint8Array(Buffer.from(h.replace(/^\\x/, ""), "hex")) : null);
