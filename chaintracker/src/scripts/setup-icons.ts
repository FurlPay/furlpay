// Build chain icons and register them as Discord application emojis.
//
// Application emojis (not guild emojis) are the right mechanism here: they
// belong to the app rather than a server, need no MANAGE_EMOJIS permission in
// the guild, are capped at 2000, and render anywhere the bot posts. That last
// property is what lets a chain's real mark sit inline in a monospace table.
//
// Idempotent: an emoji whose name already exists is reused, not duplicated,
// so this can be re-run after adding a chain without churning ids.

import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v10";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { env, assertBootable, ROOT } from "../config/env.js";
import { getDb, chains } from "../db/index.js";
import { seedAll } from "../collectors/index.js";
import { buildAllIcons, iconPath } from "../assets/icons.js";
import { makeLogger } from "../util/logger.js";

const log = makeLogger("setup-icons");

/** Emoji names must be [a-z0-9_], so slugs are prefixed and normalised. */
function emojiName(slug: string): string {
  return `ct_${slug.replace(/[^a-z0-9]/gi, "_").toLowerCase()}`.slice(0, 32);
}

export const EMOJI_MAP_PATH = resolve(ROOT, "assets", "emoji-map.json");

interface AppEmoji {
  id: string;
  name: string;
  animated?: boolean;
}

export async function setupIcons(): Promise<Record<string, string>> {
  assertBootable();
  getDb();
  seedAll();

  const all = chains.all();
  log.info("building icons", { chains: all.length });
  const built = await buildAllIcons(all);

  const rest = new REST({ version: "10" }).setToken(env.discordToken!);
  const appId = env.discordClientId!;

  // Existing emojis first — re-uploading a name that already exists creates a
  // second one with the same name, which then resolves unpredictably.
  const existingRes = (await rest.get(Routes.applicationEmojis(appId))) as
    | { items?: AppEmoji[] }
    | AppEmoji[];
  const existing: AppEmoji[] = Array.isArray(existingRes)
    ? existingRes
    : (existingRes.items ?? []);
  const byName = new Map(existing.map((e) => [e.name, e]));
  log.info("existing application emojis", { count: existing.length });

  const map: Record<string, string> = {};
  let uploaded = 0;
  let reused = 0;

  for (const b of built) {
    const name = emojiName(b.slug);
    const already = byName.get(name);
    if (already) {
      map[b.slug] = `<:${already.name}:${already.id}>`;
      reused += 1;
      continue;
    }
    const png = readFileSync(b.pngPath);
    if (png.length > 256 * 1024) {
      log.warn("icon too large for Discord, skipped", { chain: b.slug, bytes: png.length });
      continue;
    }
    try {
      const created = (await rest.post(Routes.applicationEmojis(appId), {
        body: { name, image: `data:image/png;base64,${png.toString("base64")}` },
      })) as AppEmoji;
      map[b.slug] = `<:${created.name}:${created.id}>`;
      uploaded += 1;
      log.info("emoji created", { chain: b.slug, name, origin: b.origin });
    } catch (err) {
      log.warn("emoji upload failed", {
        chain: b.slug,
        err: (err as Error).message.slice(0, 160),
      });
    }
  }

  mkdirSync(resolve(ROOT, "assets"), { recursive: true });
  writeFileSync(EMOJI_MAP_PATH, JSON.stringify(map, null, 2));
  log.info("icon setup complete", {
    uploaded,
    reused,
    total: Object.keys(map).length,
    map: EMOJI_MAP_PATH,
  });
  return map;
}

/** Load the persisted map; empty when setup has not been run. */
export function loadEmojiMap(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(EMOJI_MAP_PATH, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("/setup-icons.js");
if (isMain) {
  setupIcons()
    .then((m) => {
      console.log(`\n${Object.keys(m).length} chain icons registered.`);
      process.exit(0);
    })
    .catch((err) => {
      log.error("icon setup failed", { err: (err as Error).message });
      console.error(err);
      process.exit(1);
    });
}
