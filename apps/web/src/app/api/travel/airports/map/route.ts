import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { airportsInBBox, geoAirportByIata, nearestAirports } from "@/lib/travel/airportGeo";

export const dynamic = "force-dynamic";

// GET /api/travel/airports/map — airports WITH positions, for the hotel map.
//
//   ?bbox=minLng,minLat,maxLng,maxLat&z=9   airports in view (size gated by zoom)
//   ?near=lat,lng&limit=2                    nearest commercial airports, with
//                                            straight-line distance in km
//   ?iata=SFO,NRT                            named airports (route endpoints)
//
// Public, read-only, static data (OurAirports, public domain). Rate-limited per
// AGENTS rule 2; cacheable because the data only changes on a rebuild.

const CACHE = { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" };

function nums(raw: string | null, n: number): number[] | null {
  if (!raw) return null;
  const parts = raw.split(",").map(Number);
  return parts.length === n && parts.every(Number.isFinite) ? parts : null;
}

export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "travel.airports.map", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  const sp = req.nextUrl.searchParams;

  const iata = sp.get("iata");
  if (iata) {
    const codes = iata.split(",").map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{3}$/.test(c)).slice(0, 4);
    const airports = codes.map((c) => geoAirportByIata(c)).filter(Boolean);
    return NextResponse.json({ airports }, { headers: CACHE });
  }

  const near = nums(sp.get("near"), 2);
  if (near) {
    const [lat, lng] = near;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return NextResponse.json({ error: "near out of range" }, { status: 400 });
    const limit = Math.min(5, Math.max(1, Number(sp.get("limit")) || 2));
    const nearest = nearestAirports({ latitude: lat, longitude: lng }, limit).map((a) => ({
      ...a,
      distanceKm: Math.round(a.distanceKm * 10) / 10,
    }));
    return NextResponse.json({ nearest, distance: "straight-line" }, { headers: CACHE });
  }

  const bbox = nums(sp.get("bbox"), 4);
  if (!bbox) {
    return NextResponse.json({ error: "Pass bbox=minLng,minLat,maxLng,maxLat, near=lat,lng or iata=AAA" }, { status: 400 });
  }
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  const [minLng, minLat, maxLng, maxLat] = [clamp(bbox[0], -180, 180), clamp(bbox[1], -90, 90), clamp(bbox[2], -180, 180), clamp(bbox[3], -90, 90)];
  if (minLat >= maxLat) return NextResponse.json({ error: "Invalid bbox" }, { status: 400 });
  const z = Number(sp.get("z"));
  const airports = airportsInBBox({ minLat, minLng, maxLat, maxLng }, Number.isFinite(z) ? z : 3);
  return NextResponse.json({ airports }, { headers: CACHE });
}
