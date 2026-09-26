// Icon pipeline: furlpay SVG assets → Discord application emojis.
//
// Discord will not render SVG anywhere — not in an embed thumbnail, not as an
// emoji — so the official marks from furlpay.com/markets have to be rasterised
// first. sharp does that from prebuilt binaries, no compiler needed.
//
// Five of the 28 chains have no mark in the furlpay asset set. Rather than
// substitute someone else's logo, resolution falls through in this order:
//
//   1. the chain's own mark            (logos/chains/<slug>.svg)
//   2. the chain token's mark          (logos/coins/<ticker>.svg)
//   3. a generated monogram tile       in the chain's registry colour
//
// Step 4 is visibly generic on purpose: a placeholder that looks like a
// placeholder is honest, a borrowed logo is not.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import sharp from "sharp";
import { ROOT } from "../config/env.js";
import { makeLogger } from "../util/logger.js";
import type { ChainRow } from "../types/index.js";

const log = makeLogger("icons");

/** The furlpay web app's public asset root, relative to this project. */
export const FURLPAY_LOGOS = resolve(ROOT, "..", "apps", "web", "public", "logos");
export const ICON_OUT = resolve(ROOT, "assets", "icons");

/** 128px keeps every emoji far under Discord's 256 KB ceiling. */
const SIZE = 128;

export interface ResolvedIcon {
  slug: string;
  /** Source SVG path, or null when a monogram was generated. */
  source: string | null;
  origin: "chain-mark" | "token-mark" | "gas-asset" | "monogram";
  pngPath: string;
  bytes: number;
}

/**
 * Gas-asset substitutions.
 *
 * Deliberately empty. Base and Robinhood Chain pay gas in ETH, but they are
 * distinct brands — stamping Ethereum's diamond on a Base row would tell the
 * reader something untrue about which network a whale moved on. A neutral
 * monogram in the chain's own colour is the honest fallback.
 */
const GAS_ASSET_LOGO: Record<string, string> = {};

function svgPath(rel: string): string | null {
  const p = join(FURLPAY_LOGOS, `${rel}.svg`);
  return existsSync(p) ? p : null;
}

/** Work out which artwork represents a chain, and how confident that is. */
export function resolveSource(chain: {
  slug: string;
  logo?: string;
  coinLogo?: string;
}): { path: string | null; origin: ResolvedIcon["origin"] } {
  if (chain.logo) {
    const p = svgPath(chain.logo);
    if (p) return { path: p, origin: chain.logo.startsWith("chains/") ? "chain-mark" : "token-mark" };
  }
  if (chain.coinLogo) {
    const p = svgPath(chain.coinLogo);
    if (p) return { path: p, origin: "token-mark" };
  }
  const gas = GAS_ASSET_LOGO[chain.slug];
  if (gas) {
    const p = svgPath(gas);
    if (p) return { path: p, origin: "gas-asset" };
  }
  return { path: null, origin: "monogram" };
}

/**
 * A monogram tile: the chain's initials on its registry colour. Generated as
 * SVG then rasterised, so it stays crisp and matches the real marks' weight.
 */
function monogramSvg(name: string, color: number): string {
  const initials = name
    .replace(/[^A-Za-z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const hex = `#${color.toString(16).padStart(6, "0")}`;
  // Dark brand colours need light text and vice versa.
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const fg = luminance > 0.6 ? "#0b0d10" : "#ffffff";
  const size = SIZE;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size * 0.24}" fill="${hex}"/>
  <text x="50%" y="50%" dy="0.35em" text-anchor="middle"
        font-family="DejaVu Sans, Verdana, Arial, sans-serif"
        font-size="${initials.length > 1 ? size * 0.42 : size * 0.55}"
        font-weight="700" fill="${fg}">${initials || "?"}</text>
</svg>`;
}

/** Rasterise one chain's icon to `assets/icons/<slug>.png`. */
export async function buildIcon(chain: {
  slug: string;
  name: string;
  logo?: string;
  coinLogo?: string;
  color: number;
}): Promise<ResolvedIcon> {
  mkdirSync(ICON_OUT, { recursive: true });
  const { path, origin } = resolveSource(chain);
  const out = join(ICON_OUT, `${chain.slug}.png`);

  const input: Buffer =
    path !== null
      ? readFileSync(path)
      : Buffer.from(monogramSvg(chain.name, chain.color), "utf8");

  const png = await sharp(input, { density: 384 })
    .resize(SIZE, SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();

  writeFileSync(out, png);
  return { slug: chain.slug, source: path, origin, pngPath: out, bytes: png.length };
}

export async function buildAllIcons(chainList: ChainRow[]): Promise<ResolvedIcon[]> {
  const out: ResolvedIcon[] = [];
  for (const c of chainList) {
    try {
      out.push(
        await buildIcon({
          slug: c.slug,
          name: c.name,
          logo: c.logo,
          coinLogo: c.coinLogo,
          color: c.color,
        }),
      );
    } catch (err) {
      log.warn("icon build failed", { chain: c.slug, err: (err as Error).message.slice(0, 120) });
    }
  }
  const byOrigin = out.reduce<Record<string, number>>((a, r) => {
    a[r.origin] = (a[r.origin] ?? 0) + 1;
    return a;
  }, {});
  log.info("icons built", { total: out.length, ...byOrigin });
  return out;
}

/** Path to a built icon, or null when it has not been generated yet. */
export function iconPath(slug: string): string | null {
  const p = join(ICON_OUT, `${slug}.png`);
  return existsSync(p) ? p : null;
}
