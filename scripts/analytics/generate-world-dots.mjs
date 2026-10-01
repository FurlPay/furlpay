#!/usr/bin/env node
// Generates apps/web/src/components/analytics/worldDots.json: the dotted world
// map behind the admin dashboard's Geographic Distribution panel.
//
// Source: Natural Earth 1:50m Admin 0 countries (public domain), fetched from
// the project's own repository. Nothing here is hand-typed: land dots come from
// point-in-polygon tests against the country shapes, and each country's marker
// position is the centroid of its largest polygon, keyed by Natural Earth's own
// ISO_A2 (falling back to ISO_A2_EH where ISO_A2 is "-99", e.g. France, Norway).
//
// Run when the asset needs regenerating:  node scripts/analytics/generate-world-dots.mjs
// Projection: equirectangular, latitudes clipped to [-58, 84] (no Antarctica).

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SOURCE =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "../../apps/web/src/components/analytics/worldDots.json");

const W = 360; // viewBox width
const LAT_MAX = 84;
const LAT_MIN = -58;
const H = Math.round(((LAT_MAX - LAT_MIN) / 360) * W);
const STEP = 3.2; // grid spacing in viewBox units

const x = (lon) => ((lon + 180) / 360) * W;
const y = (lat) => ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * H;
const round = (n) => Math.round(n * 10) / 10;

function inRing(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPolygon = (lon, lat, poly) => inRing(lon, lat, poly[0]) && !poly.slice(1).some((h) => inRing(lon, lat, h));

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(a / 2);
}
function centroid(ring) {
  let cx = 0, cy = 0, a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
    a += f;
  }
  return a === 0 ? ring[0] : [cx / (3 * a), cy / (3 * a)];
}

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`fetch ${SOURCE}: ${res.status}`);
const geo = await res.json();

const polygons = [];
const centroids = {};
for (const f of geo.features) {
  const p = f.properties;
  const code = [p.ISO_A2, p.ISO_A2_EH].find((c) => typeof c === "string" && /^[A-Z]{2}$/.test(c));
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  polygons.push(...polys);
  if (!code) continue;
  const largest = polys.reduce((best, poly) => (ringArea(poly[0]) > ringArea(best[0]) ? poly : best), polys[0]);
  const [lon, lat] = centroid(largest[0]);
  centroids[code] = [round(x(lon)), round(y(Math.max(LAT_MIN, Math.min(LAT_MAX, lat))))];
}

const dots = [];
for (let py = STEP / 2; py < H; py += STEP) {
  for (let px = STEP / 2; px < W; px += STEP) {
    const lon = (px / W) * 360 - 180;
    const lat = LAT_MAX - (py / H) * (LAT_MAX - LAT_MIN);
    if (polygons.some((poly) => inPolygon(lon, lat, poly))) dots.push([round(px), round(py)]);
  }
}

writeFileSync(
  OUT,
  JSON.stringify({ source: SOURCE, width: W, height: H, dots, centroids }) + "\n"
);
console.log(`wrote ${OUT}: ${dots.length} dots, ${Object.keys(centroids).length} country centroids`);
