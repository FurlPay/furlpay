// Illustrative geography for the partnership globe.
//
// These are CITIES and the routes drawn between them, nothing more. They are
// not FurlPay corridors, transaction flows or partner locations, and the page
// says so beside the globe. Coordinates are the cities' published WGS84
// centres (latitude, longitude), so the dots land where the cities are.

export type City = { id: string; name: string; location: [number, number] };

export const CITIES: City[] = [
  { id: "new-york", name: "New York", location: [40.7128, -74.006] },
  { id: "london", name: "London", location: [51.5074, -0.1278] },
  { id: "frankfurt", name: "Frankfurt", location: [50.1109, 8.6821] },
  { id: "dubai", name: "Dubai", location: [25.2048, 55.2708] },
  { id: "bengaluru", name: "Bengaluru", location: [12.9716, 77.5946] },
  { id: "singapore", name: "Singapore", location: [1.3521, 103.8198] },
  { id: "tokyo", name: "Tokyo", location: [35.6762, 139.6503] },
  { id: "sydney", name: "Sydney", location: [-33.8688, 151.2093] },
];

/** Pairs of city ids. Order is the direction a pulse travels. */
export const ROUTES: [string, string][] = [
  ["new-york", "london"],
  ["london", "frankfurt"],
  ["london", "dubai"],
  ["frankfurt", "dubai"],
  ["dubai", "bengaluru"],
  ["bengaluru", "singapore"],
  ["dubai", "singapore"],
  ["singapore", "tokyo"],
  ["singapore", "sydney"],
  ["tokyo", "sydney"],
];

const byId = new Map(CITIES.map(c => [c.id, c]));
export function routeEnds(route: [string, string]): [[number, number], [number, number]] {
  const a = byId.get(route[0]), b = byId.get(route[1]);
  if (!a || !b) throw new Error(`Unknown city in route ${route.join("→")}`);
  return [a.location, b.location];
}

const rad = (d: number) => (d * Math.PI) / 180, deg = (r: number) => (r * 180) / Math.PI;

/**
 * The point a fraction `t` of the way along the great circle from `a` to `b`
 * (spherical linear interpolation). Used to move light packets along routes.
 */
export function greatCirclePoint(a: [number, number], b: [number, number], t: number): [number, number] {
  const [la1, lo1, la2, lo2] = [rad(a[0]), rad(a[1]), rad(b[0]), rad(b[1])];
  const v1 = [Math.cos(la1) * Math.cos(lo1), Math.cos(la1) * Math.sin(lo1), Math.sin(la1)];
  const v2 = [Math.cos(la2) * Math.cos(lo2), Math.cos(la2) * Math.sin(lo2), Math.sin(la2)];
  const dot = Math.min(1, Math.max(-1, v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]));
  const omega = Math.acos(dot);
  if (omega < 1e-9) return a;
  const s = Math.sin(omega), k1 = Math.sin((1 - t) * omega) / s, k2 = Math.sin(t * omega) / s;
  const x = k1 * v1[0] + k2 * v2[0], y = k1 * v1[1] + k2 * v2[1], z = k1 * v1[2] + k2 * v2[2];
  return [deg(Math.atan2(z, Math.hypot(x, y))), deg(Math.atan2(y, x))];
}
