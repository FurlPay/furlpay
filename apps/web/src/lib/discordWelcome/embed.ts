// ---------------------------------------------------------------------------
// The welcome message itself.
//
// ── WHY THE MENTION APPEARS TWICE ──────────────────────────────────────────
//
// A mention inside an EMBED renders as a highlighted @Name but sends NO
// notification. Discord only raises a ping for mentions in the message
// `content`. A welcome whose whole purpose is to greet someone, that the
// someone never sees, is a decoration.
//
// So the mention is in both places and each does a different job: `content`
// carries it so the member is actually pinged, and the embed description
// carries it so the card reads the way it was designed. This is the standard
// welcome-bot shape on Discord, and it is deliberate rather than duplicated.
//
// ── A DISPLAY NAME IS UNTRUSTED INPUT ──────────────────────────────────────
//
// Anyone can set their display name to `@everyone`, to `**` or to a string of
// backticks. Two defences, because they cover different attacks:
//
//   `allowed_mentions` pins exactly who this message may ping — the new member
//   and nobody else. Without it a crafted name could turn a welcome into an
//   @everyone. This is the one that matters.
//
//   The name is placed only in the embed AUTHOR field, which Discord does not
//   parse as markdown, so a name full of asterisks cannot restyle the card.
//   Anywhere the name would sit in markdown-parsed text, it is escaped.
// ---------------------------------------------------------------------------

import type { DiscordMember } from "./rest";
import { avatarUrl, displayName, mention } from "./identity";

/** FurlPay brand green, matching lib/discord.ts. Embed colours are integers. */
const BRAND_GREEN = 0x00e599;

const SITE = "https://furlpay.com";

/**
 * Escape the characters Discord treats as markdown.
 *
 * For text that lands in a markdown-parsed field. Backslash first, or it
 * escapes the escapes that follow it.
 */
export function escapeMarkdown(s: string): string {
  return s.replace(/[\\*_~`|>]/g, (c) => `\\${c}`);
}

export interface WelcomeMessageOptions {
  guildId: string;
  /** Channel to point newcomers at, e.g. the #welcome channel id. Optional. */
  startHereChannelId?: string | null;
  /** Append the "we will never ask for your seed phrase" line. */
  securityNote?: boolean;
}

/**
 * Build the public welcome message for one member.
 *
 * Returns a complete Discord message payload, not just an embed, because
 * `content` and `allowed_mentions` are as much a part of the design as the
 * embed is — see the header.
 */
export function buildWelcomeMessage(
  member: DiscordMember,
  opts: WelcomeMessageOptions
): Record<string, unknown> {
  const user = member.user;
  const id = user?.id ?? "";
  const name = displayName(member);
  const who = id ? mention(id) : escapeMarkdown(name);

  // "Check out #welcome to get started" — a real channel link when we know the
  // channel, and no dangling reference to one when we do not.
  const startHere = opts.startHereChannelId
    ? ` Check out <#${opts.startHereChannelId}> to get started.`
    : "";

  const lines = [`Welcome to FurlPay! Glad to have you here.${startHere}`];
  if (opts.securityNote !== false) {
    lines.push(
      "",
      "Security reminder: FurlPay will never ask for your seed phrase, private key or wallet password.",
    );
  }

  return {
    // The ping. See the header for why this is not redundant with the embed.
    content: `Let's all welcome ${who}`,
    embeds: [
      {
        color: BRAND_GREEN,
        author: {
          // Not markdown-parsed, so an adversarial display name is inert here.
          name: name,
          icon_url: avatarUrl(member, opts.guildId),
        },
        description: `Let's all welcome 👉 ${who}`,
        // The circular profile picture on the right of the card.
        thumbnail: { url: avatarUrl(member, opts.guildId) },
        fields: [{ name: "​", value: lines.join("\n") }],
        footer: { text: "FurlPay Community" },
        url: SITE,
      },
    ],
    // The whole allow-list. `parse: []` switches off @everyone, @here and role
    // mentions entirely; `users` then re-permits exactly one id.
    allowed_mentions: id ? { parse: [], users: [id] } : { parse: [] },
  };
}

/**
 * The optional onboarding DM.
 *
 * Kept deliberately separate from the channel message and off by default. It
 * carries the security guidance rather than a greeting, because the reason to
 * DM a new member at all is that unsolicited DMs are exactly how the scams in
 * this space open — and the first DM they get should be the one telling them
 * that.
 */
export function buildWelcomeDm(
  member: DiscordMember,
  opts: WelcomeMessageOptions
): Record<string, unknown> {
  const name = displayName(member);
  const startHere = opts.startHereChannelId ? `<#${opts.startHereChannelId}>` : "the welcome channel";

  return {
    embeds: [
      {
        color: BRAND_GREEN,
        title: "Welcome to FurlPay",
        description:
          `Hi ${escapeMarkdown(name)} — thanks for joining the FurlPay community.\n\n` +
          `Start with ${startHere}, and ask anything in the developer channels.`,
        fields: [
          {
            name: "Staying safe",
            value:
              "FurlPay will **never** ask for your seed phrase, private key, wallet password or recovery phrase, " +
              "and will never DM you first asking for a wallet address.\n\n" +
              "Announcements only ever come from the server's announcement channel. " +
              "Treat any DM offering an airdrop, or asking you to \"verify\" a wallet, as a scam.",
          },
        ],
        footer: { text: "FurlPay Community" },
        url: SITE,
      },
    ],
    allowed_mentions: { parse: [] },
  };
}
