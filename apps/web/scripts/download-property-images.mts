// ---------------------------------------------------------------------------
// Find, verify, download and file a photograph for every curated property.
//
//   npx tsx apps/web/scripts/download-property-images.mts
//
// WHY THE IMAGES ARE DOWNLOADED RATHER THAN HOTLINKED. A stored file is one the
// map can draw with no API key, no per-view call and no dependency on another
// service staying up. Commons is reliable, but a luxury map that goes blank
// because upload.wikimedia.org is having a bad afternoon is not a product.
//
// WHY THEY ARE COMMONS AND NEVER GOOGLE. Google's Places policy permits storing
// the place ID and nothing else — its photography may not be written to disk at
// any resolution, for any duration. Commons files are CC or public domain, so
// they can be kept, provided the attribution and licence travel with them. Both
// are fetched here from the imageinfo API and written beside the file, because
// an unattributed CC-BY image is a licence breach, not a small omission.
//
// EVERY ROUTE IS ENTITY-LINKED. A human curating Wikidata or Wikipedia decided
// that this picture depicts this property:
//
//   1. Wikidata P18       the item's own designated image.
//   2. Commons category   the item's linked Commons category (P373), which is
//                         a folder somebody assembled for this building.
//   3. Wikipedia lead     the article's page image.
//
// WHAT WAS TRIED AND REMOVED, because it is the interesting part. Two more
// routes looked obvious and were measured to be wrong often enough to be
// unusable: Commons GEOSEARCH around the confirmed coordinate, and Commons TEXT
// SEARCH on the property name, each gated on the filename naming the property.
//
// Both produce confident, plausible, wrong answers:
//
//   The Louise (Barossa Valley)  -> "Lake Louise 2018-03 ski.jpg", a Canadian lake
//   Ellerman House (Cape Town)   -> "Arthur C. Ellerman House from SE.JPG"
//   Lake House Daylesford        -> "Daylesford Lake ....jpg", the lake, not the hotel
//   Eichardt's Private Hotel     -> an Australasian Crested Grebe, 23m away
//
// The filename gate cannot fix this, because the failure is not a string
// problem. "Louise" really does appear in both names; a photograph really was
// taken 23m from the hotel. Proximity answers "what was photographed near
// here" and a name match answers "what shares these words" — neither answers
// "what is this building", which is the only question that matters.
//
// The two routes would have roughly doubled coverage. A property with no
// picture is a gap a reader can see; a property showing another continent's
// lake is a false statement rendered at full confidence, and it is the same
// error as a pin on the wrong building.
//
// FLAGS
//   --in <path>     Dataset. Default: src/data/luxury-properties.json
//   --out <dir>     Image root. Default: public/hotels
//   --width <px>    Longest edge to download. Default 900
//   --limit <n>     Only the first n properties
//   --only <text>   Only properties whose name contains this
//   --dry-run       Resolve and report, download nothing
//   --force         Re-download files that already exist
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { CuratedDataset, CuratedProperty } from "../src/lib/hotels/curatedTypes";
import { openDataset } from "./lib/dataset.mts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, "..");

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const IN_PATH = path.resolve(flag("in") ?? path.join(WEB_ROOT, "src", "data", "luxury-properties.json"));
const OUT_DIR = path.resolve(flag("out") ?? path.join(WEB_ROOT, "public", "hotels"));
const WIDTH = Number(flag("width") ?? 900) || 900;
const LIMIT = Number(flag("limit") ?? 0) || 0;
const ONLY = flag("only")?.toLowerCase();
const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

const UA = { "User-Agent": "FurlPay/1.0 (+https://furlpay.com) hotel-map images" };

const stats = {
  p18: 0, commons_category: 0, wikipedia: 0,
  none: 0, downloaded: 0, skipped: 0, failed: 0, bytes: 0, calls: 0,
};

async function api<T>(url: string): Promise<T | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      stats.calls++;
      const res = await fetch(url, { headers: UA, signal: controller.signal });
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

interface Candidate {
  file: string;
  route: "p18" | "commons_category" | "wikipedia";
}

/**
 * Is this file a PICTURE OF the property, rather than a file ABOUT it?
 *
 * Commons holds logos, floor plans, location maps and scanned brochures
 * alongside photographs, and Wikidata's P18 sometimes points at one: Amanoi's
 * designated image is "Amanoi_Logo.jpg". A logo in a hero slot is not a
 * catastrophe, but it is not what the card is for, and it looks like a bug
 * rather than a source limitation.
 *
 * Applied to EVERY route. It first lived inside the Commons-category lookup
 * only, which is exactly why the logo reached the dataset through P18.
 */
function looksLikeAPhotograph(file: string): boolean {
  if (!/\.(jpe?g|png|webp)$/i.test(file)) return false;
  return !/logo|floor.?plan|plan|map|diagram|coat[ _]of[ _]arms|signature|brochure|screenshot|poster|leaflet/i.test(
    file
  );
}

/** Commons file name from a P18 claim or a stored Special:FilePath URL. */
function fileFromStoredUrl(url: string | undefined): string | null {
  if (!url) return null;
  const m = url.match(/Special:FilePath\/([^?]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function wikipediaLeadImage(wikipediaUrl: string): Promise<string | null> {
  const title = decodeURIComponent(wikipediaUrl.split("/wiki/")[1] ?? "");
  if (!title) return null;
  const json = await api<{ query?: { pages?: Record<string, { pageimage?: string }> } }>(
    "https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages" +
      `&piprop=name&titles=${encodeURIComponent(title)}`
  );
  const page = Object.values(json?.query?.pages ?? {})[0];
  return page?.pageimage ?? null;
}

/**
 * The first usable photograph in the item's linked Commons category.
 *
 * P373 is a claim on the Wikidata item saying "this category is about this
 * thing", so its contents are curated for this property rather than merely
 * near it. Files are taken in category order, skipping the logos, floor plans
 * and maps that tend to sort first.
 */
async function commonsCategoryImage(qid: string): Promise<string | null> {
  const ent = await api<{ entities?: Record<string, any> }>(
    `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`
  );
  const category = ent?.entities?.[qid]?.claims?.P373?.[0]?.mainsnak?.datavalue?.value;
  if (typeof category !== "string" || !category) return null;

  const json = await api<{ query?: { categorymembers?: { title: string }[] } }>(
    "https://commons.wikimedia.org/w/api.php?action=query&format=json&list=categorymembers" +
      `&cmtype=file&cmlimit=20&cmtitle=${encodeURIComponent(`Category:${category}`)}`
  );
  for (const m of json?.query?.categorymembers ?? []) {
    const file = m.title.replace(/^File:/, "");
    if (!looksLikeAPhotograph(file)) continue;
    return file;
  }
  return null;
}

async function resolveImage(p: CuratedProperty): Promise<Candidate | null> {
  const stored = fileFromStoredUrl(p.imageUrl);
  // A P18 that points at a logo falls through to the next route rather than
  // being accepted just because Wikidata designated it.
  if (stored && looksLikeAPhotograph(stored)) return { file: stored, route: "p18" };
  // Everything below needs an item: without one there is nothing linking a
  // picture to this property, and a guess is worse than a gap.
  if (!p.wikidata) return null;

  const category = await commonsCategoryImage(p.wikidata.qid);
  if (category) return { file: category, route: "commons_category" };

  if (p.wikidata.wikipediaUrl) {
    const lead = await wikipediaLeadImage(p.wikidata.wikipediaUrl);
    if (lead && looksLikeAPhotograph(lead)) return { file: lead, route: "wikipedia" };
  }
  return null;
}

interface FileMeta {
  url: string;
  artist?: string;
  licence?: string;
  descriptionUrl?: string;
  mime?: string;
}

/**
 * The thumbnail URL plus the attribution the licence requires.
 *
 * `extmetadata` is where Commons keeps the artist and the licence short name.
 * Both are fetched here rather than assumed, because "CC BY-SA 4.0, photo by X"
 * is a condition of using the file, and guessing it is the same as omitting it.
 */
async function fileMeta(file: string): Promise<FileMeta | null> {
  const json = await api<{
    query?: { pages?: Record<string, {
      imageinfo?: { thumburl?: string; url?: string; mime?: string; descriptionurl?: string;
        extmetadata?: Record<string, { value?: string }> }[] }> };
  }>(
    "https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo" +
      `&iiprop=url|mime|extmetadata&iiurlwidth=${WIDTH}&titles=${encodeURIComponent(`File:${file}`)}`
  );
  const info = Object.values(json?.query?.pages ?? {})[0]?.imageinfo?.[0];
  if (!info) return null;
  const meta = info.extmetadata ?? {};
  const strip = (s?: string) => s?.replace(/<[^>]*>/g, "").trim() || undefined;
  return {
    url: info.thumburl ?? info.url ?? "",
    artist: strip(meta.Artist?.value),
    licence: strip(meta.LicenseShortName?.value),
    descriptionUrl: info.descriptionurl,
    mime: info.mime,
  };
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70);
}

/**
 * Fetch one file to disk, retrying transient failures.
 *
 * THE RETRY IS NOT DEFENSIVE PADDING, it is the difference between 42 files and
 * all of them. The first full run resolved 151 images and wrote 42: every one
 * of the 109 "failures" fetched perfectly when tried again by hand. Wikimedia
 * was rate-limiting an unauthenticated client, `api()` retried and this did
 * not, so a 429 on the image itself was recorded as "no picture exists" — an
 * upstream throttle rendered as a permanent fact about the property.
 *
 * Written only after the whole body is in hand, so an interrupted fetch cannot
 * leave a truncated file that the next run then skips as already downloaded.
 */
async function download(url: string, dest: string): Promise<number | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(url, { headers: UA, signal: controller.signal });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1_500 * 2 ** attempt));
        continue;
      }
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.byteLength) return null;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      return buf.byteLength;
    } catch {
      if (attempt === 3) return null;
      await new Promise((r) => setTimeout(r, 1_500 * 2 ** attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

async function mapWithConcurrency<T, R>(
  items: T[], limit: number, fn: (item: T, index: number) => Promise<R>
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
    console.error(`Dataset not found: ${IN_PATH}`);
    process.exit(1);
  }
  // THE RUN THAT MOTIVATED THE LOCK. This one held the dataset in memory for
  // twenty minutes while downloading, then wrote it back over a backfill that
  // had completed in the meantime.
  const held = openDataset<CuratedDataset>(IN_PATH, "download-property-images");
  const dataset = held.data;

  let selected = dataset.properties;
  if (ONLY) selected = selected.filter((p) => p.name.toLowerCase().includes(ONLY));
  if (LIMIT) selected = selected.slice(0, LIMIT);

  console.log(`dataset    ${IN_PATH}`);
  console.log(`images     ${OUT_DIR}`);
  console.log(`properties ${selected.length}, filed by category, ${WIDTH}px longest edge`);
  console.log(`routes     entity-linked only: P18, Commons category, Wikipedia lead`);
  if (DRY_RUN) console.log("mode       DRY RUN - nothing downloaded");
  console.log("");

  // Wikimedia asks unauthenticated clients to be modest; this is courtesy.
  const results = await mapWithConcurrency(selected, 1, async (p, i) => {
    const candidate = await resolveImage(p);
    if (!candidate) {
      stats.none++;
      return null;
    }
    stats[candidate.route]++;

    const meta = await fileMeta(candidate.file);
    if (!meta?.url) {
      stats.failed++;
      return null;
    }

    // Filed by CATEGORY, so the tree mirrors the taxonomy the map filters by
    // and a category's imagery can be reviewed as a set.
    const category = p.categories[0] ?? "uncategorised";
    const ext =
      EXT_BY_MIME[meta.mime ?? ""] ?? (path.extname(candidate.file).toLowerCase() || ".jpg");
    const rel = path.posix.join(category, `${slug(p.name)}${ext}`);
    const dest = path.join(OUT_DIR, rel);

    if (!DRY_RUN) {
      if (fs.existsSync(dest) && !FORCE) {
        stats.skipped++;
        stats.bytes += fs.statSync(dest).size;
      } else {
        const size = await download(meta.url, dest);
        if (size === null) {
          stats.failed++;
          return null;
        }
        stats.downloaded++;
        stats.bytes += size;
      }
    }

    console.log(
      `[${i + 1}/${selected.length}] ${p.name.slice(0, 38).padEnd(39)} ${candidate.route.padEnd(17)} -> ${rel}`
    );

    return {
      id: p.id,
      localPath: `/hotels/${rel}`,
      credit: meta.artist,
      licence: meta.licence,
      sourcePage: meta.descriptionUrl,
      route: candidate.route,
      file: candidate.file,
    };
  });

  if (DRY_RUN) {
    held.release();
    console.log("");
    console.log(`p18 ${stats.p18} · commons category ${stats.commons_category} · wikipedia ${stats.wikipedia} · none ${stats.none}`);
    return;
  }

  const byId = new Map(results.filter(Boolean).map((r) => [r!.id, r!]));
  dataset.properties = dataset.properties.map((p) => {
    const r = byId.get(p.id);
    if (!r) return p;
    return {
      ...p,
      // The local file is what the map draws. The remote URL stays as a
      // fallback for anything rendering outside this deployment.
      imageLocalPath: r.localPath,
      imageCredit: [r.credit, r.licence].filter(Boolean).join(" · ") || p.imageCredit,
      imageLicence: r.licence,
      imageSourcePage: r.sourcePage,
      imageRoute: r.route,
      imageSource: "wikimedia_commons" as const,
    };
  });
  dataset.imagesDownloadedAt = new Date().toISOString();
  held.commit(dataset);

  const withImage = dataset.properties.filter((p) => p.imageLocalPath).length;
  console.log("");
  console.log(`resolved   p18 ${stats.p18} · commons category ${stats.commons_category} · wikipedia ${stats.wikipedia}`);
  console.log(`no image   ${stats.none} properties have no entity-linked picture`);
  console.log(`downloaded ${stats.downloaded}, reused ${stats.skipped}, failed ${stats.failed}`);
  console.log(`on disk    ${withImage}/${dataset.properties.length} properties, ${(stats.bytes / 1048576).toFixed(1)} MB`);
  console.log(`written    ${IN_PATH}`);
}

await main();
