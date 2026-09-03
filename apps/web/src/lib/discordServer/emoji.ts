// ---------------------------------------------------------------------------
// Custom guild emoji for the role icons.
//
// ── WHY THIS EXISTS AT ALL ─────────────────────────────────────────────────
//
// Discord gives you exactly two ways to put a glyph next to a select-menu
// option or inside embed text: a unicode emoji, or a CUSTOM GUILD EMOJI. There
// is no inline image in either place. So "real icons, not emojis" means
// uploading real icons AS emoji — the mechanism is the same, the artwork is
// ours instead of the platform's.
//
// ── THE CONSTRAINTS THAT SHAPE THIS FILE ───────────────────────────────────
//
//   FORMAT. PNG, GIF or WEBP. Not SVG — hence the rasteriser in
//   /api/og/role-icon. Uploaded as a base64 data URI, not multipart.
//
//   SIZE. 256KB per emoji, hard. A 128x128 line icon lands around 3-6KB, so
//   there is enormous headroom, but the check stays because a future icon with
//   a photographic fill would silently fail the upload otherwise.
//
//   SLOTS. An unboosted server has 50 static emoji slots. The catalog needs
//   ~15, so this is comfortable — but `ensureRoleEmoji` reports the count so a
//   server that is already near the limit fails with a reason instead of a
//   string of opaque 400s.
//
//   NAMES. 2-32 characters, alphanumeric and underscore only. Every name is
//   prefixed so these are recognisable as ours in a server that has other
//   emoji, and so removing them later is unambiguous.
// ---------------------------------------------------------------------------

const API = "https://discord.com/api/v10";
const TIMEOUT_MS = 15_000;

/** Discord's per-emoji ceiling. */
const MAX_BYTES = 256 * 1024;

/** Unboosted guilds get 50 static slots; boosted tiers get more. Used only to
 *  produce a useful error, never to decide the real limit — Discord does that. */
const ASSUMED_SLOTS = 50;

const NAME_PREFIX = "furlpay_";

export interface GuildEmoji {
  id: string;
  name: string;
  animated?: boolean;
}

export type EmojiResult<T> = { ok: true; data: T } | { ok: false; error: string };

function headers(token: string, json = true): Record<string, string> {
  return {
    Authorization: `Bot ${token}`,
    "User-Agent": "FurlPay-Server-Setup (+https://furlpay.com)",
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

function describe(status: number): string {
  if (status === 401) return "Discord rejected the bot token (401).";
  if (status === 403) return "Bot lacks Manage Expressions / Manage Emojis (403).";
  if (status === 400) return "Discord rejected the emoji (400) — usually size, format or a duplicate name.";
  if (status === 429) return "Rate limited by Discord (429).";
  return `Discord returned HTTP ${status}.`;
}

/** Discord's emoji name rules, applied to a catalog key. */
export function emojiName(roleKey: string): string {
  const cleaned = roleKey.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `${NAME_PREFIX}${cleaned}`.slice(0, 32);
}

export async function listEmoji(token: string, guildId: string): Promise<EmojiResult<GuildEmoji[]>> {
  try {
    const res = await fetch(`${API}/guilds/${guildId}/emojis`, {
      headers: headers(token),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: describe(res.status) };
    const data = (await res.json()) as GuildEmoji[];
    if (!Array.isArray(data)) return { ok: false, error: "Discord returned an unexpected emoji list." };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Could not reach Discord." };
  }
}

export async function createEmoji(
  token: string,
  guildId: string,
  name: string,
  png: Uint8Array
): Promise<EmojiResult<GuildEmoji>> {
  if (png.byteLength > MAX_BYTES) {
    return { ok: false, error: `Image is ${Math.round(png.byteLength / 1024)}KB; Discord's limit is 256KB.` };
  }
  const b64 = Buffer.from(png).toString("base64");
  try {
    const res = await fetch(`${API}/guilds/${guildId}/emojis`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ name, image: `data:image/png;base64,${b64}`, roles: [] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: describe(res.status) };
    return { ok: true, data: (await res.json()) as GuildEmoji };
  } catch {
    return { ok: false, error: "Could not reach Discord." };
  }
}

export interface EmojiEnsureReport {
  existing: string[];
  created: string[];
  failed: { key: string; error: string }[];
  /** roleKey -> "<:name:id>" for embed text, and the parts for select options. */
  resolved: Record<string, { id: string; name: string }>;
  slotsUsed: number;
}

/**
 * Make sure every role key has an emoji, rendering any that are missing.
 *
 * `origin` is where the rasteriser lives. It has to be an absolute, publicly
 * reachable URL because the render is fetched over HTTP rather than called in
 * process — that keeps the ImageResponse machinery in one place instead of
 * duplicating it here.
 */
export async function ensureRoleEmoji(
  token: string,
  guildId: string,
  roleKeys: readonly string[],
  origin: string,
  apply: boolean
): Promise<EmojiResult<EmojiEnsureReport>> {
  const current = await listEmoji(token, guildId);
  if (!current.ok) return current;

  const byName = new Map(current.data.map((e) => [e.name, e]));
  const report: EmojiEnsureReport = {
    existing: [],
    created: [],
    failed: [],
    resolved: {},
    slotsUsed: current.data.length,
  };

  for (const key of roleKeys) {
    const name = emojiName(key);
    const found = byName.get(name);
    if (found) {
      report.existing.push(key);
      report.resolved[key] = { id: found.id, name: found.name };
      continue;
    }

    if (!apply) {
      report.created.push(key); // "would create"
      continue;
    }

    if (report.slotsUsed >= ASSUMED_SLOTS) {
      report.failed.push({ key, error: "No emoji slots left in this server." });
      continue;
    }

    let png: Uint8Array;
    try {
      const res = await fetch(`${origin}/api/og/role-icon/${encodeURIComponent(key)}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      if (!res.ok) {
        report.failed.push({ key, error: `Icon render returned ${res.status}.` });
        continue;
      }
      png = new Uint8Array(await res.arrayBuffer());
    } catch {
      report.failed.push({ key, error: "Icon render failed." });
      continue;
    }

    const made = await createEmoji(token, guildId, name, png);
    if (made.ok) {
      report.created.push(key);
      report.resolved[key] = { id: made.data.id, name: made.data.name };
      report.slotsUsed++;
    } else {
      report.failed.push({ key, error: made.error });
    }
  }

  return { ok: true, data: report };
}
