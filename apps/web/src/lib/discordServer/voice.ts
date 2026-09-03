// ---------------------------------------------------------------------------
// Voice channels the server should have.
//
// DECLARATIVE AND IDEMPOTENT, like the role catalog: this is the desired set,
// and the setup endpoint creates only what is missing. Running it twice never
// produces two Trading Floors.
//
// MATCHED BY NAME, and Discord normalises voice channel names less
// aggressively than text ones (no forced lowercase, spaces preserved), so the
// comparison is a case-insensitive exact match on the name as typed here.
//
// USER LIMITS ARE DELIBERATE. An open-ended voice room in a community server
// tends to become either empty or unusable; a cap of 10-25 keeps a room
// conversational and pushes overflow into the next one, which is why there is
// more than one.
// ---------------------------------------------------------------------------

const API = "https://discord.com/api/v10";
const TIMEOUT_MS = 8_000;

/** Discord channel type ids. */
export const CHANNEL_TEXT = 0;
export const CHANNEL_VOICE = 2;
export const CHANNEL_CATEGORY = 4;
export const CHANNEL_STAGE = 13;

export interface VoiceChannelSpec {
  name: string;
  /** 0 = unlimited. */
  userLimit: number;
  /** Category to nest under, matched by name. Created if absent. */
  category: string;
}

export const VOICE_CATEGORY = "VOICE";

export const VOICE_CHANNELS: VoiceChannelSpec[] = [
  { name: "Lounge", userLimit: 25, category: VOICE_CATEGORY },
  { name: "Builders Room", userLimit: 15, category: VOICE_CATEGORY },
  { name: "Trading Floor", userLimit: 15, category: VOICE_CATEGORY },
  { name: "Pair Programming", userLimit: 6, category: VOICE_CATEGORY },
  { name: "AFK", userLimit: 0, category: VOICE_CATEGORY },
];

export interface GuildChannel {
  id: string;
  name: string;
  type: number;
  parent_id?: string | null;
}

export type ChannelResult<T> = { ok: true; data: T } | { ok: false; error: string };

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bot ${token}`,
    "User-Agent": "FurlPay-Server-Setup (+https://furlpay.com)",
    "Content-Type": "application/json",
  };
}

/** Never contains a response body, for the same reason as everywhere else. */
function describe(status: number): string {
  if (status === 401) return "Discord rejected the bot token (401).";
  if (status === 403) return "Bot lacks Manage Channels in this server (403).";
  if (status === 429) return "Rate limited by Discord (429).";
  return `Discord returned HTTP ${status}.`;
}

export async function listChannels(token: string, guildId: string): Promise<ChannelResult<GuildChannel[]>> {
  try {
    const res = await fetch(`${API}/guilds/${guildId}/channels`, {
      headers: headers(token),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: describe(res.status) };
    const data = (await res.json()) as GuildChannel[];
    if (!Array.isArray(data)) return { ok: false, error: "Discord returned an unexpected channel list." };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Could not reach Discord." };
  }
}

export async function createChannel(
  token: string,
  guildId: string,
  body: Record<string, unknown>
): Promise<ChannelResult<GuildChannel>> {
  try {
    const res = await fetch(`${API}/guilds/${guildId}/channels`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: describe(res.status) };
    return { ok: true, data: (await res.json()) as GuildChannel };
  } catch {
    return { ok: false, error: "Could not reach Discord." };
  }
}

export interface VoiceEnsureReport {
  existing: string[];
  created: string[];
  failed: { name: string; error: string }[];
  categoryId: string | null;
}

/**
 * Ensure every voice channel in the catalog exists.
 *
 * `apply: false` reports what is missing without creating anything, so the
 * setup endpoint's read-only default stays genuinely read-only.
 */
export async function ensureVoiceChannels(
  token: string,
  guildId: string,
  apply: boolean
): Promise<ChannelResult<VoiceEnsureReport>> {
  const channels = await listChannels(token, guildId);
  if (!channels.ok) return channels;

  const lower = (s: string) => s.toLowerCase();
  const byName = new Map(channels.data.map((c) => [`${c.type}:${lower(c.name)}`, c]));

  // The category first — a voice channel created before it would land at the
  // top level and have to be moved.
  let category = channels.data.find((c) => c.type === CHANNEL_CATEGORY && lower(c.name) === lower(VOICE_CATEGORY));
  if (!category && apply) {
    const made = await createChannel(token, guildId, { name: VOICE_CATEGORY, type: CHANNEL_CATEGORY });
    if (made.ok) category = made.data;
  }

  const report: VoiceEnsureReport = {
    existing: [],
    created: [],
    failed: [],
    categoryId: category?.id ?? null,
  };

  for (const spec of VOICE_CHANNELS) {
    if (byName.has(`${CHANNEL_VOICE}:${lower(spec.name)}`)) {
      report.existing.push(spec.name);
      continue;
    }
    if (!apply) {
      report.created.push(spec.name); // "would create"
      continue;
    }
    const made = await createChannel(token, guildId, {
      name: spec.name,
      type: CHANNEL_VOICE,
      user_limit: spec.userLimit,
      ...(category ? { parent_id: category.id } : {}),
    });
    if (made.ok) report.created.push(spec.name);
    else report.failed.push({ name: spec.name, error: made.error });
  }

  return { ok: true, data: report };
}
