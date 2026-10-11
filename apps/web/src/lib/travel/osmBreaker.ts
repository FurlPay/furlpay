// Circuit breaker for Overpass, shared by the hotel map route.
//
// MEASURED ON furlpay.com: Overpass essentially never answers from Vercel, so
// every map response spent its full bounded wait and every `osm=wait`
// follow-up spent ~33 s, on every pan, for nothing. After a failure the map
// stops asking for OSM_COOLDOWN_MS and answers at once with the layer marked
// unavailable; the first request after the cool-down tries again.
//
// Per instance (Fluid Compute reuses them), like the preferred-endpoint hint
// in osmHotels.ts — a latency hint, not state worth persisting.

export const OSM_COOLDOWN_MS = 120_000;
let downUntil = 0;

export function osmCoolingDown(now = Date.now()): boolean {
  return now < downUntil;
}

/** Feed a lookup's outcome: null (failure) opens the breaker, anything else closes it. */
export function noteOsmResult(result: unknown, now = Date.now()): void {
  downUntil = result === null ? now + OSM_COOLDOWN_MS : 0;
}

export function resetOsmBreaker(): void {
  downUntil = 0;
}
