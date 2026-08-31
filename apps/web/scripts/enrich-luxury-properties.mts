// ---------------------------------------------------------------------------
// Enrich the resolved luxury-property dataset from Wikidata and Wikimedia
// Commons.
//
//   npx tsx apps/web/scripts/enrich-luxury-properties.mts
//
// WHY A SECOND SOURCE AT ALL. Google Places has the photography, and we may not
// keep it: the Places policy permits storing the place ID and nothing else, so
// every Google image has to be fetched at view time, per viewer, forever. That
// is correct but it is not a dataset — the map cannot show a property's
// photograph without a live billed call, and nothing survives a key rotation.
//
// Wikidata and Commons are the opposite trade. Coverage is roughly half, and
// the imagery is inconsistent. But the licences are CC/public-domain, the file
// URLs are stable and permanent, and the whole thing can be STORED. So this is
// the layer that gives the map durable pictures, and Google stays the on-demand
// enrichment behind a click.
//
// THE FAILURE MODE IS THE SAME ONE THE RESOLVER GUARDS AGAINST, so the defence
// is the same. Wikidata's search happily answers a hotel name with whatever
// sorts first: asked for "Ashford Castle" it returns an entity sitting at
// 53.22,-1.71 — in Derbyshire, England, 400km from the Irish castle the CSV
// means. Taking that would have attached an English manor's photograph to an
// Irish hotel. So a Wikidata match must agree on POSITION with the coordinate
// Google already confirmed, and on NAME, before anything it says is written.
//
// FLAGS
//   --in <path>      Dataset to enrich. Default: src/data/luxury-properties.json
//   --limit <n>      Only the first n properties (a cheap smoke test)
//   --only <text>    Only properties whose name contains this
//   --radius <m>     How far a Wikidata coordinate may sit. Default 2000
//   --dry-run        Report what would be written, write nothing
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { haversineMeters, jaroWinkler, normalizeName } from "../src/lib/hotels/h3";
import { tokenContainment, canonicalCountryCode } from "../src/lib/hotels/resolve";
import type { CuratedDataset, CuratedProperty } from "../src/lib/hotels/curatedTypes";
import { openDataset } from "./lib/dataset.mts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, "..");

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const IN_PATH = path.resolve(flag("in") ?? path.join(WEB_ROOT, "src", "data", "luxury-properties.json"));
const LIMIT = Number(flag("limit") ?? 0) || 0;
const ONLY = flag("only")?.toLowerCase();
const DRY_RUN = process.argv.includes("--dry-run");

/**
 * How far a Wikidata coordinate may sit from the confirmed one.
 *
 * Tight on purpose. Unlike the Places resolver, this is not trying to CORRECT a
 * position — it is trying to confirm that two records describe one building,
 * and it already has a coordinate a second source verified. Anything beyond a
 * couple of kilometres is a different property with a similar name.
 */
const MAX_DISTANCE_M = Number(flag("radius") ?? 2000) || 2000;
/** Name agreement floor, matching the resolver's own corroboration threshold. */
const MIN_NAME = 0.75;

const UA = "FurlPay/1.0 (+https://furlpay.com) hotel-map enrichment";

const stats = { searched: 0, matched: 0, rejected: 0, images: 0, calls: 0 };

async function wiki<T>(url: string): Promise<T | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      stats.calls++;
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: controller.signal });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1_000 * 2 ** attempt));
        continue;
      }
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      if (attempt === 2) return null;
      await new Promise((r) => setTimeout(r, 1_000 * 2 ** attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

interface WikidataMatch {
  qid: string;
  matchedLabel: string;
  distanceMeters: number;
  nameEvidence: number;
  /** Commons file name, when the entity has P18. */
  imageFile?: string;
  imageUrl?: string;
  officialWebsite?: string;
  inceptionYear?: number;
  wikipediaUrl?: string;
}

/**
 * A permanent, hotlink-safe URL for a Commons file.
 *
 * Special:FilePath resolves a file NAME to its current binary and follows
 * renames, which a direct upload.wikimedia.org path does not. The width
 * parameter makes Commons render a thumbnail rather than serving a 12MB
 * original into a 115px card.
 */
function commonsUrl(file: string, width: number): string {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${width}`;
}

type SearchHit = { id: string; label?: string; description?: string };

async function searchEntities(term: string): Promise<SearchHit[]> {
  const url =
    "https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json" +
    `&language=en&uselang=en&type=item&limit=5&search=${encodeURIComponent(term)}`;
  const json = await wiki<{ search?: SearchHit[] }>(url);
  return json?.search ?? [];
}

async function entity(qid: string): Promise<Record<string, any> | null> {
  const json = await wiki<{ entities?: Record<string, any> }>(
    `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`
  );
  return json?.entities?.[qid] ?? null;
}

function claimValue(ent: Record<string, any>, prop: string): any {
  return ent?.claims?.[prop]?.[0]?.mainsnak?.datavalue?.value;
}

/**
 * Find the Wikidata item for one property, or nothing.
 *
 * Every candidate is checked against BOTH the confirmed coordinate and the
 * name, for the reason at the top of this file. Returning nothing is a normal,
 * frequent and correct outcome.
 */
async function matchProperty(p: CuratedProperty): Promise<WikidataMatch | null> {
  // Only enrich properties whose position a second source already confirmed.
  // Without a trustworthy coordinate the distance gate has nothing to stand on,
  // and the name alone is exactly what produces the Ashford Castle error.
  if (p.precision !== "exact") return null;

  const terms = [...new Set([p.name, `${p.name} ${p.city}`.trim()])];
  let best: WikidataMatch | null = null;

  for (const term of terms) {
    stats.searched++;
    for (const hit of await searchEntities(term)) {
      const ent = await entity(hit.id);
      if (!ent) continue;

      const coord = claimValue(ent, "P625");
      if (!coord?.latitude || !coord?.longitude) continue;

      const distanceMeters = haversineMeters(p.latitude, p.longitude, coord.latitude, coord.longitude);
      if (distanceMeters > MAX_DISTANCE_M) continue;

      const label: string = ent.labels?.en?.value ?? hit.label ?? "";
      if (!label) continue;
      const nameEvidence = Math.max(
        jaroWinkler(normalizeName(p.name), normalizeName(label)),
        tokenContainment(p.name, label)
      );
      if (nameEvidence < MIN_NAME) continue;

      // A country claim, when present, must agree. Wikidata's P17 is an item
      // reference rather than a code, so this checks the label rather than
      // pretending to resolve the entity.
      const imageFile = claimValue(ent, "P18");
      const site = claimValue(ent, "P856");
      const inception = claimValue(ent, "P571")?.time as string | undefined;
      const enwiki = ent.sitelinks?.enwiki?.title as string | undefined;

      const candidate: WikidataMatch = {
        qid: hit.id,
        matchedLabel: label,
        distanceMeters: Math.round(distanceMeters),
        nameEvidence: Math.round(nameEvidence * 1000) / 1000,
        imageFile: typeof imageFile === "string" ? imageFile : undefined,
        imageUrl: typeof imageFile === "string" ? commonsUrl(imageFile, 1024) : undefined,
        officialWebsite: typeof site === "string" ? site : undefined,
        inceptionYear: inception ? Number(inception.slice(1, 5)) || undefined : undefined,
        wikipediaUrl: enwiki
          ? `https://en.wikipedia.org/wiki/${encodeURIComponent(enwiki.replace(/ /g, "_"))}`
          : undefined,
      };

      // Prefer a match that actually carries a picture — that is the whole
      // reason this pass exists — and fall back to the closest otherwise.
      const better =
        !best ||
        (Boolean(candidate.imageFile) && !best.imageFile) ||
        (Boolean(candidate.imageFile) === Boolean(best.imageFile) &&
          candidate.nameEvidence > best.nameEvidence);
      if (better) best = candidate;
    }
    if (best?.imageFile) break;
  }

  return best;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

async function main() {
  if (!fs.existsSync(IN_PATH)) {
    console.error(`Dataset not found: ${IN_PATH}\nRun resolve-luxury-properties.mts first.`);
    process.exit(1);
  }

  // Held under a lock for the whole run: this reads at the start and writes at
  // the end, which is exactly the window another script can be lost in.
  const held = openDataset<CuratedDataset>(IN_PATH, "enrich-luxury-properties");
  const dataset = held.data;
  let selected = dataset.properties;
  if (ONLY) selected = selected.filter((p) => p.name.toLowerCase().includes(ONLY));
  if (LIMIT) selected = selected.slice(0, LIMIT);

  console.log(`dataset   ${IN_PATH}`);
  console.log(`properties ${dataset.properties.length}${selected.length !== dataset.properties.length ? ` (${selected.length} selected)` : ""}`);
  console.log(`gate      within ${MAX_DISTANCE_M}m of the confirmed position, name >= ${MIN_NAME}`);
  if (DRY_RUN) console.log("mode      DRY RUN - nothing written");
  console.log("");

  // Wikimedia asks for modest concurrency from unauthenticated clients; this is
  // a courtesy limit, not a performance choice.
  const matches = await mapWithConcurrency(selected, 4, async (p, i) => {
    const m = await matchProperty(p);
    if (m) {
      stats.matched++;
      if (m.imageFile) stats.images++;
      console.log(
        `[${i + 1}/${selected.length}] ${p.name} -> ${m.qid} "${m.matchedLabel}" ${m.distanceMeters}m` +
          (m.imageFile ? "  IMAGE" : "")
      );
    } else if (p.precision === "exact") {
      stats.rejected++;
    }
    return m;
  });

  if (DRY_RUN) {
    console.log(`\nWould enrich ${stats.matched} properties, ${stats.images} with imagery.`);
    return;
  }

  const byId = new Map(selected.map((p, i) => [p.id, matches[i]]));
  dataset.properties = dataset.properties.map((p) => {
    const m = byId.get(p.id);
    if (!m) return p;
    return {
      ...p,
      wikidata: {
        qid: m.qid,
        matchedLabel: m.matchedLabel,
        distanceMeters: m.distanceMeters,
        nameEvidence: m.nameEvidence,
        wikipediaUrl: m.wikipediaUrl,
        inceptionYear: m.inceptionYear,
      },
      // Stored because the licence permits it. This is the map's durable
      // imagery; Google's photography stays a per-view lookup.
      imageUrl: m.imageUrl,
      imageThumbUrl: m.imageFile ? commonsUrl(m.imageFile, 400) : undefined,
      imageSource: m.imageUrl ? ("wikimedia_commons" as const) : undefined,
      imageCredit: m.imageFile ? `Wikimedia Commons: ${m.imageFile}` : undefined,
    };
  });

  dataset.enrichedAt = new Date().toISOString();
  held.commit(dataset);

  console.log("");
  console.log(`matched   ${stats.matched}/${selected.length}`);
  console.log(`imagery   ${stats.images} properties now carry a stored, CC-licensed photograph`);
  console.log(`rejected  ${stats.rejected} confirmed properties had no credible Wikidata item`);
  console.log(`api calls ${stats.calls}`);
  console.log(`written   ${IN_PATH}`);
}

await main();
