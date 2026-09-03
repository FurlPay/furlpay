import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { avatarUrl, defaultAvatarIndex, displayName, mention } from "../identity";
import { buildWelcomeDm, buildWelcomeMessage, escapeMarkdown } from "../embed";
import { envFlag, envNumber, isSnowflake, welcomeConfig } from "../config";
import { isEligible } from "../welcome";
import { detectJoins } from "../detect";
import type { DiscordMember } from "../rest";
import type { WelcomeConfig } from "../config";

// ---------------------------------------------------------------------------
// A welcome message is a public statement about a person, posted automatically.
// These tests are mostly about the two ways that goes wrong: greeting the wrong
// people (everyone, twice, or bots), and rendering the person incorrectly (the
// wrong name, a broken avatar, or a mention that does not ping).
// ---------------------------------------------------------------------------

const GUILD = "1522006337070825482";

function member(over: Partial<DiscordMember> & { id?: string } = {}): DiscordMember {
  const { id, ...rest } = over;
  return {
    user: {
      id: id ?? "1212331846994755604",
      username: "ashutosh0x",
      global_name: "Ashutosh",
      discriminator: "0",
      avatar: null,
      ...(over.user ?? {}),
    },
    nick: null,
    avatar: null,
    joined_at: "2026-09-03T10:00:00.000Z",
    ...rest,
  };
}

describe("display name", () => {
  it("prefers the server nickname, then the global name, then the handle", () => {
    expect(displayName(member({ nick: "Ash (FurlPay)" }))).toBe("Ash (FurlPay)");
    expect(displayName(member())).toBe("Ashutosh");
    expect(
      displayName(member({ user: { id: "1", username: "handle", global_name: null } }))
    ).toBe("handle");
  });

  it("ignores an empty nickname rather than rendering a blank name", () => {
    // Discord drops an empty author field entirely, so this would silently
    // remove the name from the card.
    expect(displayName(member({ nick: "   " }))).toBe("Ashutosh");
  });
});

describe("default avatar", () => {
  it("uses the six-way scheme for migrated accounts", () => {
    // (id >> 22) % 6 — and the id must be treated as a 64-bit integer.
    const id = "1212331846994755604";
    const expected = Number((BigInt(id) >> 22n) % 6n);
    expect(defaultAvatarIndex({ id, discriminator: "0" })).toBe(expected);
    expect(expected).toBeGreaterThanOrEqual(0);
    expect(expected).toBeLessThan(6);
  });

  it("does not lose precision on a real snowflake", () => {
    // Number(id) >> 22 is the tempting version and it is wrong: a snowflake
    // exceeds MAX_SAFE_INTEGER, and >> coerces to a 32-bit int, so the naive
    // form collapses distinct users onto the same avatar.
    const id = "1212331846994755604";
    expect(Number(id) > Number.MAX_SAFE_INTEGER).toBe(true);
    expect(defaultAvatarIndex({ id, discriminator: "0" })).toBe(Number((BigInt(id) >> 22n) % 6n));
  });

  it("uses the five-way scheme for legacy discriminated accounts", () => {
    expect(defaultAvatarIndex({ id: "762154433856667648", discriminator: "0007" })).toBe(2);
    expect(defaultAvatarIndex({ id: "762154433856667648", discriminator: "0005" })).toBe(0);
  });

  it("survives a malformed id instead of throwing", () => {
    expect(defaultAvatarIndex({ id: "not-a-snowflake", discriminator: "0" })).toBe(0);
  });
});

describe("avatar url", () => {
  it("prefers the per-server avatar", () => {
    const url = avatarUrl(member({ avatar: "abc123", user: { id: "42", username: "u", avatar: "def456" } }), GUILD);
    expect(url).toBe(`https://cdn.discordapp.com/guilds/${GUILD}/users/42/avatars/abc123.png?size=256`);
  });

  it("falls back to the account avatar", () => {
    const url = avatarUrl(member({ avatar: null, user: { id: "42", username: "u", avatar: "def456" } }), GUILD);
    expect(url).toBe("https://cdn.discordapp.com/avatars/42/def456.png?size=256");
  });

  it("falls back to a Discord default when the member has no avatar at all", () => {
    // The link that is usually missed: building a CDN url from a null hash
    // gives a 404 and an embed with a broken thumbnail.
    const url = avatarUrl(member({ avatar: null, user: { id: "42", username: "u", avatar: null } }), GUILD);
    expect(url).toMatch(/^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/[0-5]\.png$/);
  });

  it("asks for a gif only when the hash says the avatar is animated", () => {
    expect(avatarUrl(member({ user: { id: "42", username: "u", avatar: "a_9f9f" } }), GUILD)).toContain(".gif");
    expect(avatarUrl(member({ user: { id: "42", username: "u", avatar: "9f9f" } }), GUILD)).toContain(".png");
  });
});

describe("welcome message", () => {
  const opts = { guildId: GUILD, startHereChannelId: "1523535527272386673", securityNote: true };

  it("pings the member with a real mention in the content", () => {
    // A mention inside an embed renders but does not notify. If the ping is
    // only in the embed, the person being welcomed never finds out.
    const msg = buildWelcomeMessage(member({ id: "42" }), opts);
    expect(msg.content).toBe("Let's all welcome <@42>");
    expect(mention("42")).toBe("<@42>");
  });

  it("also carries the mention in the embed description, as designed", () => {
    const embed = (buildWelcomeMessage(member({ id: "42" }), opts).embeds as Record<string, unknown>[])[0];
    expect(embed.description).toBe("Let's all welcome 👉 <@42>");
  });

  it("shows the member's own avatar, never the bot's", () => {
    const m = member({ id: "42", user: { id: "42", username: "u", avatar: "aaa" } });
    const embed = (buildWelcomeMessage(m, opts).embeds as Record<string, unknown>[])[0];
    const thumb = embed.thumbnail as { url: string };
    expect(thumb.url).toContain("/avatars/42/aaa.png");
  });

  it("restricts mentions to the one member, so a crafted name cannot ping everyone", () => {
    // A display name is user-controlled text. `parse: []` switches off
    // @everyone/@here/roles; `users` then re-permits exactly one id.
    const msg = buildWelcomeMessage(member({ id: "42", nick: "@everyone" }), opts);
    expect(msg.allowed_mentions).toEqual({ parse: [], users: ["42"] });
  });

  it("links the start-here channel when one is configured, and omits it otherwise", () => {
    const withLink = buildWelcomeMessage(member(), opts);
    const fields = ((withLink.embeds as Record<string, unknown>[])[0].fields as { value: string }[])[0];
    expect(fields.value).toContain("<#1523535527272386673>");

    const without = buildWelcomeMessage(member(), { ...opts, startHereChannelId: null });
    const f2 = ((without.embeds as Record<string, unknown>[])[0].fields as { value: string }[])[0];
    expect(f2.value).not.toContain("<#");
    expect(f2.value).not.toContain("undefined");
  });

  it("carries the security reminder by default and drops it when switched off", () => {
    const on = buildWelcomeMessage(member(), opts);
    const onText = ((on.embeds as Record<string, unknown>[])[0].fields as { value: string }[])[0].value;
    expect(onText).toContain("never ask for your seed phrase");

    const off = buildWelcomeMessage(member(), { ...opts, securityNote: false });
    const offText = ((off.embeds as Record<string, unknown>[])[0].fields as { value: string }[])[0].value;
    expect(offText).not.toContain("seed phrase");
  });

  it("never asks for anything a scammer would ask for", () => {
    const msg = buildWelcomeMessage(member(), opts);
    const dm = buildWelcomeDm(member(), opts);
    const text = JSON.stringify(msg) + JSON.stringify(dm);
    // The message may WARN about these — the DM's whole point is to say
    // "we will never ask for a wallet address" — so the test bans the
    // SOLICITATION, not the words. A blanket ban would fail the safety copy.
    const solicits =
      /(send|share|provide|enter|reply with|dm us)[^.]{0,40}(seed phrase|private key|password|recovery phrase|wallet address)/i;
    expect(text).not.toMatch(solicits);
    // Every mention of a wallet address must be a refusal to ask for one.
    for (const m of text.matchAll(/.{0,80}wallet address/gi)) {
      expect(m[0]).toMatch(/never/i);
    }
  });

  it("escapes markdown in a name that lands in parsed text", () => {
    expect(escapeMarkdown("**bold**")).toBe("\\*\\*bold\\*\\*");
    const dm = buildWelcomeDm(member({ nick: "**Ash**" }), opts);
    expect(JSON.stringify(dm)).toContain("\\\\*\\\\*Ash");
  });
});

describe("config", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("WELCOME_") || k === "DISCORD_GUILD_ID") delete process.env[k];
    }
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("rejects a channel name pasted into a channel-id variable", () => {
    expect(isSnowflake("1523535544523423794")).toBe(true);
    expect(isSnowflake("#general")).toBe(false);
    expect(isSnowflake("123")).toBe(false);
  });

  it("reports a typo as misconfigured, and an absent value as simply off", () => {
    process.env.DISCORD_GUILD_ID = GUILD;
    process.env.WELCOME_CHANNEL_ID = "#general";
    const bad = welcomeConfig();
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.misconfigured).toBe(true);

    delete process.env.WELCOME_CHANNEL_ID;
    const off = welcomeConfig();
    expect(off.ok).toBe(false);
    if (!off.ok) expect(off.misconfigured).toBe(false);
  });

  it("keeps DMs off unless explicitly enabled", () => {
    process.env.DISCORD_GUILD_ID = GUILD;
    process.env.WELCOME_CHANNEL_ID = "1523535544523423794";
    const r = welcomeConfig();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.dmEnabled).toBe(false);
      expect(r.config.channelEnabled).toBe(true);
      // The guard that stops the first run greeting the whole server.
      expect(r.config.backfillOnFirstRun).toBe(false);
      expect(r.config.includeBots).toBe(false);
      expect(r.config.securityNote).toBe(true);
    }
  });

  it("parses flags and numbers tolerantly but does not invent values", () => {
    expect(envFlag("NOPE_MISSING", true)).toBe(true);
    process.env.WELCOME_TEST_FLAG = "no";
    expect(envFlag("WELCOME_TEST_FLAG", true)).toBe(false);
    process.env.WELCOME_TEST_FLAG = "gibberish";
    expect(envFlag("WELCOME_TEST_FLAG", true)).toBe(true);
    process.env.WELCOME_TEST_NUM = "-4";
    expect(envNumber("WELCOME_TEST_NUM", 48)).toBe(48);
    process.env.WELCOME_TEST_NUM = "6";
    expect(envNumber("WELCOME_TEST_NUM", 48)).toBe(6);
  });
});

describe("eligibility", () => {
  const cfg: WelcomeConfig = {
    guildId: GUILD,
    channelId: "1523535544523423794",
    channelEnabled: true,
    dmEnabled: false,
    maxAgeHours: 48,
    backfillOnFirstRun: false,
    includeBots: false,
    startHereChannelId: null,
    securityNote: true,
  };
  const now = Date.parse("2026-09-03T12:00:00.000Z");

  it("greets a member who joined inside the window", () => {
    const j = { member: member(), joinedAt: now - 3_600_000, source: "member-list" as const };
    expect(isEligible(j, cfg, now).eligible).toBe(true);
  });

  it("does not greet a member who joined before the window", () => {
    // A sweep that has been down for a week must not wake up and post a pile
    // of week-late welcomes.
    const j = { member: member(), joinedAt: now - 72 * 3_600_000, source: "member-list" as const };
    expect(isEligible(j, cfg, now).eligible).toBe(false);
  });

  it("skips bots unless they are explicitly included", () => {
    const bot = member({ user: { id: "9", username: "somebot", bot: true } });
    const j = { member: bot, joinedAt: now - 60_000, source: "member-list" as const };
    expect(isEligible(j, cfg, now).eligible).toBe(false);
    expect(isEligible(j, { ...cfg, includeBots: true }, now).eligible).toBe(true);
  });
});

describe("join detection", () => {
  const cfg: WelcomeConfig = {
    guildId: GUILD,
    channelId: "1523535544523423794",
    channelEnabled: true,
    dmEnabled: false,
    maxAgeHours: 48,
    backfillOnFirstRun: false,
    includeBots: false,
    startHereChannelId: null,
    securityNote: true,
  };

  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(handler: (url: string) => { status: number; body: unknown }) {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const { status, body } = handler(url);
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    });
  }

  it("uses the member list when the Server Members intent is on", async () => {
    stubFetch((url) => {
      if (url.includes("/members")) {
        return { status: 200, body: [{ user: { id: "42", username: "new" }, joined_at: "2026-09-03T10:00:00Z" }] };
      }
      return { status: 404, body: {} };
    });
    const r = await detectJoins("tok", cfg);
    expect(r.ok).toBe(true);
    expect(r.source).toBe("member-list");
    expect(r.joins).toHaveLength(1);
    expect(r.degraded).toBeNull();
  });

  it("falls back to system join messages on a 403, and says why", async () => {
    // 403 on /members is the documented answer when the privileged intent is
    // off. It is a routing decision, not a failure.
    stubFetch((url) => {
      if (url.includes("/members")) return { status: 403, body: { message: "Missing Access" } };
      if (url.includes(`/guilds/${GUILD}`)) {
        return { status: 200, body: { id: GUILD, system_channel_id: "555", system_channel_flags: 0 } };
      }
      if (url.includes("/channels/555/messages")) {
        return {
          status: 200,
          body: [
            { id: "1", type: 7, timestamp: "2026-09-03T10:00:00Z", author: { id: "42", username: "new" } },
            { id: "2", type: 0, timestamp: "2026-09-03T09:00:00Z", author: { id: "43", username: "chatter" } },
          ],
        };
      }
      return { status: 404, body: {} };
    });

    const r = await detectJoins("tok", cfg);
    expect(r.ok).toBe(true);
    expect(r.source).toBe("system-messages");
    // Only the type-7 join message counts; the ordinary message is not a join.
    expect(r.joins).toHaveLength(1);
    expect(r.joins[0]!.member.user!.id).toBe("42");
    expect(r.degraded).toContain("Server Members intent");
  });

  it("reports a real error when join messages are suppressed too", async () => {
    stubFetch((url) => {
      if (url.includes("/members")) return { status: 403, body: {} };
      if (url.includes(`/guilds/${GUILD}`)) {
        return { status: 200, body: { id: GUILD, system_channel_id: "555", system_channel_flags: 1 } };
      }
      return { status: 404, body: {} };
    });
    const r = await detectJoins("tok", cfg);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("suppressed");
  });

  it("never leaks the bot token in an error string", async () => {
    stubFetch(() => ({ status: 401, body: { message: "401: Unauthorized" } }));
    const r = await detectJoins("super-secret-token", cfg);
    expect(JSON.stringify(r)).not.toContain("super-secret-token");
  });
});
