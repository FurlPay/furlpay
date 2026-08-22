// Bar widths for the boarding-pass barcode.
//
// Same algorithm as apps/web/src/lib/trips/barcode.ts, duplicated rather than
// imported because native-app is deliberately NOT an npm workspace (see the
// note in package.json — React 19 / react-native must never hoist into the web
// tree). Both sides are pinned by tests so they cannot drift apart silently.
//
// Deterministic on purpose: the same booking must draw the same bars on every
// render and on every platform, so a passenger who screenshots their pass sees
// what the gate scanner will.
//
// This encodes nothing — it is a visual stand-in with a real barcode's rhythm.
// Replace it with the carrier's actual PDF417 when Duffel returns one.

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
