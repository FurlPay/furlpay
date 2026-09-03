// ---------------------------------------------------------------------------
// Community mode, the rules channel, and native join-time onboarding.
//
// ── WHAT DISCORD WILL AND WILL NOT LET A BOT DO HERE ───────────────────────
//
// The "Before you can talk here — agree to the rules — Submit" screen is
// Discord's MEMBERSHIP SCREENING, and its API is not available to us: the
// GET/MODIFY member-verification endpoints answer 404 for a bot token, and
// Discord has explicitly withdrawn their documentation while they redesign
// them. So the rules TEXT that appears on that screen is set once, by a human,
// in Server Settings. There is no supported way to automate it and pretending
// otherwise would produce code that silently does nothing.
//
// What IS supported, and is arguably the better half:
//
//   COMMUNITY MODE — PATCH /guilds/{id} with the COMMUNITY feature. This is
//   what unlocks membership screening, onboarding and the rules channel in the
//   first place. Discord enforces preconditions (a rules channel, a moderator
//   updates channel, a verification level, an explicit-content filter) and
//   rejects the change if any is missing, so they are all set here first.
//
//   ONBOARDING — PUT /guilds/{id}/onboarding. The native "customise your
//   server" flow a member walks through AS THEY JOIN, before they ever reach a
//   channel. It can assign roles directly, which means a new member arrives
//   already tagged as a Developer or an Investor without touching a bot.
//
// The bot's role picker still matters: onboarding runs once at join, and the
// picker is how somebody changes their mind six weeks later.
//
// ── THE ONBOARDING CONSTRAINT THAT BITES ───────────────────────────────────
//
// Discord requires at least 7 default channels, of which at least 5 must let
// @everyone send messages, before onboarding can be enabled. A server whose
// channels are mostly announcement-style fails this with an opaque 400, so
// `defaultChannels` below picks conversational channels deliberately and the
// caller reports the count when it falls short.
// ---------------------------------------------------------------------------

import { CHANNEL_TEXT, listChannels, createChannel, type GuildChannel } from "./voice";

const API = "https://discord.com/api/v10";
const TIMEOUT_MS = 15_000;

export type CommunityResult<T> = { ok: true; data: T } | { ok: false; error: string };

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bot ${token}`,
    "User-Agent": "FurlPay-Server-Setup (+https://furlpay.com)",
    "Content-Type": "application/json",
  };
}

function describe(status: number): string {
  if (status === 401) return "Discord rejected the bot token (401).";
  if (status === 403) return "Bot lacks the permission for this change (403). Community mode needs Administrator.";
  if (status === 400)
    return (
      "Discord rejected the change (400). For onboarding this is almost always the channel requirement: " +
      "at least 7 default channels, at least 5 of which let @everyone send messages."
    );
  if (status === 429) return "Rate limited by Discord (429).";
  return `Discord returned HTTP ${status}.`;
}

// ---------------------------------------------------------------------------
// The rules.
//
// Written for THIS community rather than copied from a generic template: rules
// 4 and 5 exist because the scam that prompted all of this was a DM offering an
// airdrop and asking for "another wallet address", and a rule people can point
// at is what makes reporting it feel normal rather than paranoid.
// ---------------------------------------------------------------------------
export const FURLPAY_RULES: string[] = [
  "Be respectful. No harassment, hate speech, slurs, or personal attacks. Disagree with the argument, not the person.",
  "No spam, self-promotion, referral links, or NSFW content. Share what you are building in the showcase channel.",
  "No FUD, conspiracies, or misinformation. If you make a claim about a protocol, a chain, or a company, bring a source.",
  "FurlPay will NEVER DM you first, and will never ask for your seed phrase, private key, wallet password, or recovery phrase. Anyone who does is an impersonator.",
  "No airdrop, giveaway, or \"verify your wallet\" schemes. Never send a wallet address or sign anything for someone who DMs you. Report it instead.",
  "Nothing here is financial advice. No price predictions presented as fact, no pump coordination, no shilling.",
  "Use the right channel, and keep long tangents in a thread so everyone else can follow.",
  "Follow Discord's Terms of Service and Community Guidelines.",
];

export const RULES_CHANNEL_NAME = "📜︱rules";
export const MOD_UPDATES_CHANNEL_NAME = "mod-updates";

/** The rules as a channel message. */
export function buildRulesMessage(): Record<string, unknown> {
  return {
    embeds: [
      {
        color: 0x00e599,
        title: "FurlPay community rules",
        description: FURLPAY_RULES.map((r, i) => `**${i + 1}.** ${r}`).join("\n\n"),
        footer: { text: "Breaking these can get you muted, kicked or banned. Ask a moderator if anything is unclear." },
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

/** Find a text channel by name, creating it when missing. */
export async function ensureTextChannel(
  token: string,
  guildId: string,
  name: string,
  topic: string,
  apply: boolean
): Promise<CommunityResult<{ channel: GuildChannel | null; created: boolean }>> {
  const channels = await listChannels(token, guildId);
  if (!channels.ok) return { ok: false, error: channels.error };

  const found = channels.data.find((c) => c.type === CHANNEL_TEXT && c.name.toLowerCase() === name.toLowerCase());
  if (found) return { ok: true, data: { channel: found, created: false } };
  if (!apply) return { ok: true, data: { channel: null, created: false } };

  const made = await createChannel(token, guildId, { name, type: CHANNEL_TEXT, topic });
  if (!made.ok) return { ok: false, error: made.error };
  return { ok: true, data: { channel: made.data, created: true } };
}

/**
 * Turn on Community mode.
 *
 * Every precondition is set in the SAME patch as the feature flag. Sending them
 * separately means a failed second call leaves the server half-configured, with
 * a verification level nobody asked for and no community features to show for
 * it.
 */
export async function enableCommunity(
  token: string,
  guildId: string,
  opts: { rulesChannelId: string; modUpdatesChannelId: string; existingFeatures: string[] }
): Promise<CommunityResult<{ features: string[] }>> {
  if (opts.existingFeatures.includes("COMMUNITY")) {
    return { ok: true, data: { features: opts.existingFeatures } };
  }

  try {
    const res = await fetch(`${API}/guilds/${guildId}`, {
      method: "PATCH",
      headers: headers(token),
      body: JSON.stringify({
        features: [...opts.existingFeatures, "COMMUNITY"],
        rules_channel_id: opts.rulesChannelId,
        public_updates_channel_id: opts.modUpdatesChannelId,
        // Discord's own preconditions for Community: members must have a
        // verified email, and media must be scanned for everyone.
        verification_level: 1, // LOW
        explicit_content_filter: 2, // ALL_MEMBERS
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: describe(res.status) };
    const g = (await res.json()) as { features?: string[] };
    return { ok: true, data: { features: g.features ?? [] } };
  } catch {
    return { ok: false, error: "Could not reach Discord." };
  }
}

export interface OnboardingPromptOption {
  title: string;
  description: string;
  roleIds: string[];
  emojiId?: string;
  emojiName?: string;
}

/**
 * Configure the native join-time onboarding flow.
 *
 * `default_channel_ids` is the set a new member is opted into. Discord counts
 * these against the 7/5 requirement described in the header, so the caller
 * passes conversational channels rather than announcement ones.
 */
export async function configureOnboarding(
  token: string,
  guildId: string,
  prompts: { title: string; options: OnboardingPromptOption[]; singleSelect: boolean }[],
  defaultChannelIds: string[]
): Promise<CommunityResult<{ enabled: boolean }>> {
  const body = {
    prompts: prompts.map((p, pi) => ({
      // Discord requires ids on prompts and options; new ones may be any
      // unique snowflake-shaped value and are reassigned on save.
      id: String(pi + 1),
      type: 0, // MULTIPLE_CHOICE
      title: p.title,
      single_select: p.singleSelect,
      required: false,
      in_onboarding: true,
      options: p.options.map((o, oi) => ({
        id: String((pi + 1) * 100 + oi),
        title: o.title,
        description: o.description,
        role_ids: o.roleIds,
        channel_ids: [],
        // On an onboarding option the emoji is three flat fields, NOT a nested
        // emoji object — the object form is silently ignored here.
        ...(o.emojiId ? { emoji_id: o.emojiId, emoji_name: o.emojiName } : {}),
        ...(!o.emojiId && o.emojiName ? { emoji_name: o.emojiName } : {}),
      })),
    })),
    default_channel_ids: defaultChannelIds,
    enabled: true,
    mode: 0, // ONBOARDING_DEFAULT — counts only default channels
  };

  try {
    const res = await fetch(`${API}/guilds/${guildId}/onboarding`, {
      method: "PUT",
      headers: headers(token),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: describe(res.status) };
    const j = (await res.json()) as { enabled?: boolean };
    return { ok: true, data: { enabled: j.enabled === true } };
  } catch {
    return { ok: false, error: "Could not reach Discord." };
  }
}

/**
 * Channels suitable as onboarding defaults.
 *
 * Conversational text channels only. An announcement channel counts toward the
 * 7 but not the 5, so a list made of those passes one check and fails the
 * other with the same opaque 400.
 */
export function defaultChannels(channels: GuildChannel[], limit = 10): string[] {
  const preferred = [
    "general",
    "introductions",
    "developer-chat",
    "showcase",
    "feedback",
    "payments",
    "investing",
    "x402-agents",
    "integrations",
    "help",
    "cards",
    "travel",
  ];
  const byName = new Map(channels.filter((c) => c.type === CHANNEL_TEXT).map((c) => [c.name.toLowerCase(), c]));

  const picked: string[] = [];
  for (const name of preferred) {
    for (const [key, chan] of byName) {
      // Channel names carry emoji prefixes on this server, so match on suffix.
      if (key === name || key.endsWith(name)) {
        if (!picked.includes(chan.id)) picked.push(chan.id);
        break;
      }
    }
    if (picked.length >= limit) break;
  }
  return picked;
}
