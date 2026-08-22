// Bar widths for the boarding-pass barcode.
//
// Deterministic on purpose. A randomised pattern would differ between the
// server render and the client hydration, and React would tear the whole
// subtree down over it — so the "randomness" is an FNV-1a hash of the value
// driving an LCG, which gives the same bars for the same booking on every
// runtime, forever.
//
// This encodes nothing. It is a visual stand-in with a real barcode's rhythm:
// guard bars at each end and narrow/wide alternation between them. When this
// screen is wired to a real booking, render the airline's actual PDF417 here.

const LEADING_GUARD = [3, 2, 1, 3];
const TRAILING_GUARD = [3, 2, 1, 4];
const BODY_BARS = 108;
const MAX_BAR_WIDTH = 4;

export function barcodeBars(value: string): number[] {
  let seed = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    seed ^= value.charCodeAt(i);
    seed = Math.imul(seed, 0x01000193) >>> 0;
  }
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  const bars = [...LEADING_GUARD];
  for (let i = 0; i < BODY_BARS; i++) bars.push(1 + Math.floor(next() * MAX_BAR_WIDTH));
  bars.push(...TRAILING_GUARD);
  return bars;
}
