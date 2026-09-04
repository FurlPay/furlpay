import { describe, it, expect, beforeEach } from "vitest";
import {
  classifyOrigin,
  ownsAccount,
  resolveDiscordAccount,
} from "../discord/identity";
import { handlePaymentsConsole } from "../discord/handler";
import { id } from "../discord/console";

// ---------------------------------------------------------------------------
// One Discord user, one FurlPay account — wherever they click.
//
// Before this existed, every Discord user resolved to the same hardcoded
// SPECIMEN object, because the account loader was never set. There was no
// identity mapping at all: two people running /payments saw the same thing,
// and there was nothing to isolate because there was nothing per-user.
//
// The properties under test:
//   1. a snowflake maps to exactly one account, created once
//   2. guild and DM resolve to the SAME account for the same person
//   3. two people never collide
//   4. a username change does not move the account
//   5. an unauthorized guild cannot mint FurlPay users
//   6. ownership is derived from the signed envelope, never from a custom_id
// ---------------------------------------------------------------------------

const GUILD = "1522006337070825482";
const OTHER_GUILD = "999999999999999999";
const USER_A = "111111111111111111";
const USER_B = "222222222222222222";

beforeEach(() => {
  process.env.DISCORD_GUILD_ID = GUILD;
  const g = globalThis as unknown as { __furlpayKv?: Map<string, unknown> };
  g.__furlpayKv?.clear();
});

/** An interaction as Discord delivers it from inside a guild. */
const inGuild = (userId: string, username = "member", guild = GUILD) => ({
  type: 2,
  guild_id: guild,
  member: { user: { id: userId, username } },
  data: { name: "payments" },
});

/** A DM. Discord sends NO guild_id and populates `user` rather than `member`. */
const inDm = (userId: string, username = "member") => ({
  type: 2,
  user: { id: userId, username },
  data: { name: "payments" },
});

describe("origin classification", () => {
  it("accepts the authorized guild", () => {
    const r = classifyOrigin(inGuild(USER_A));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.origin).toEqual({ kind: "guild", guildId: GUILD });
  });

  it("rejects any other guild", () => {
    // Another server adding the bot must not be able to mint FurlPay users.
    const r = classifyOrigin(inGuild(USER_A, "member", OTHER_GUILD));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("wrong_guild");
  });

  it("treats a missing guild_id as a DM, not as the authorized guild", () => {
    // THE DANGEROUS DEFAULT. Filling in the authorized guild when none was
    // sent would let an interaction forged without one inherit guild-member
    // privileges.
    const r = classifyOrigin(inDm(USER_A));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.origin).toEqual({ kind: "dm" });
  });

  it("refuses an interaction carrying no user at all", () => {
    const r = classifyOrigin({ guild_id: GUILD });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_identity");
  });
});

describe("one snowflake, one account", () => {
  it("creates an account on first contact and reuses it after", async () => {
    const first = await resolveDiscordAccount(inGuild(USER_A));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.identity.created).toBe(true);

    const second = await resolveDiscordAccount(inGuild(USER_A));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.identity.created).toBe(false);
    expect(second.identity.account.user.id).toBe(first.identity.account.user.id);
  });

  it("resolves the SAME account from a DM as from the guild", async () => {
    // The headline requirement. Guild is authorization; it is not identity.
    // Keying on (guild, user) would give one person two accounts and split
    // their money across both.
    const viaGuild = await resolveDiscordAccount(inGuild(USER_A));
    const viaDm = await resolveDiscordAccount(inDm(USER_A));
    expect(viaGuild.ok && viaDm.ok).toBe(true);
    if (!viaGuild.ok || !viaDm.ok) return;

    expect(viaDm.identity.account.user.id).toBe(viaGuild.identity.account.user.id);
    expect(viaDm.identity.created).toBe(false);
  });

  it("resolves the same account when the DM comes first", async () => {
    const viaDm = await resolveDiscordAccount(inDm(USER_B));
    const viaGuild = await resolveDiscordAccount(inGuild(USER_B));
    expect(viaDm.ok && viaGuild.ok).toBe(true);
    if (!viaDm.ok || !viaGuild.ok) return;
    expect(viaGuild.identity.account.user.id).toBe(viaDm.identity.account.user.id);
    expect(viaGuild.identity.created).toBe(false);
  });

  it("does not move the account when the username changes", async () => {
    // Usernames are renameable and, once released, claimable by someone else.
    // Keying identity on one would eventually hand an account to whoever took
    // the handle next.
    const before = await resolveDiscordAccount(inGuild(USER_A, "oldname"));
    const after = await resolveDiscordAccount(inGuild(USER_A, "totally-different"));
    expect(before.ok && after.ok).toBe(true);
    if (!before.ok || !after.ok) return;
    expect(after.identity.account.user.id).toBe(before.identity.account.user.id);
  });

  it("never collides two different people", async () => {
    const a = await resolveDiscordAccount(inGuild(USER_A));
    const b = await resolveDiscordAccount(inGuild(USER_B));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.identity.account.user.id).not.toBe(b.identity.account.user.id);
  });

  it("does not create two accounts when two clicks race", async () => {
    // findOrCreate is atomic against the durable unique index.
    const results = await Promise.all(
      Array.from({ length: 8 }, () => resolveDiscordAccount(inGuild(USER_A)))
    );
    const ids = new Set(results.map((r) => (r.ok ? r.identity.account.user.id : "ERR")));
    expect(ids.size).toBe(1);
    expect(ids.has("ERR")).toBe(false);
  });

  it("refuses to provision from an unauthorized guild", async () => {
    const r = await resolveDiscordAccount(inGuild("333333333333333333", "x", OTHER_GUILD));
    expect(r.ok).toBe(false);
  });
});

describe("ownership is derived, never supplied", () => {
  it("recognises the owner and refuses everyone else", async () => {
    const a = await resolveDiscordAccount(inGuild(USER_A));
    const b = await resolveDiscordAccount(inGuild(USER_B));
    if (!a.ok || !b.ok) throw new Error("setup failed");

    expect(ownsAccount(a.identity, a.identity.account.user.id)).toBe(true);
    // USER A holding USER B's account id must not grant access.
    expect(ownsAccount(a.identity, b.identity.account.user.id)).toBe(false);
    expect(ownsAccount(b.identity, a.identity.account.user.id)).toBe(false);
  });
});

describe("the console routes per user", () => {
  it("answers each user privately and independently", async () => {
    const a = await handlePaymentsConsole(inGuild(USER_A) as never);
    const b = await handlePaymentsConsole(inGuild(USER_B) as never);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    // Ephemeral, both of them — a public reply here would post one member's
    // console into a channel of hundreds.
    expect((a!.data as { flags?: number }).flags).toBe(1 << 6);
    expect((b!.data as { flags?: number }).flags).toBe(1 << 6);
  });

  it("works in a DM, where there is no guild_id", async () => {
    const r = await handlePaymentsConsole(inDm(USER_A) as never);
    expect(r).not.toBeNull();
    expect((r!.data as { flags?: number }).flags).toBe(1 << 6);
  });

  it("refuses the console in an unauthorized guild", async () => {
    const r = await handlePaymentsConsole(inGuild(USER_A, "x", OTHER_GUILD) as never);
    expect(JSON.stringify(r)).toMatch(/not available in this server/i);
  });

  it("welcomes a brand-new member once, then stops", async () => {
    const fresh = "444444444444444444";
    const first = await handlePaymentsConsole(inGuild(fresh) as never);
    expect(JSON.stringify(first)).toMatch(/account is ready/i);

    const second = await handlePaymentsConsole(inGuild(fresh) as never);
    expect(JSON.stringify(second)).not.toMatch(/account is ready/i);
  });
});

describe("the public pinned message is never rewritten", () => {
  const click = (userId: string, sourceFlags: number) => ({
    type: 3,
    guild_id: GUILD,
    member: { user: { id: userId, username: "member" } },
    message: { flags: sourceFlags },
    data: { custom_id: id("account") },
  });

  it("opens a NEW private reply when clicked from the public message", async () => {
    // THE BUG THIS PINS. UPDATE_MESSAGE edits the source in place, and flags:64
    // cannot retroactively privatise a public message — so responding with an
    // update here rewrote the pinned "Payments Center" into one member's
    // account screen, for everyone. It actually happened in production.
    const r = await handlePaymentsConsole(click(USER_A, 0) as never);
    expect(r!.type).toBe(4); // CHANNEL_MESSAGE_WITH_SOURCE — a new reply
    expect(r!.type).not.toBe(7); // never UPDATE_MESSAGE
    expect((r!.data as { flags?: number }).flags).toBe(1 << 6);
  });

  it("edits in place once the conversation is already private", async () => {
    // Within a user's own ephemeral screen, updating is correct: it avoids a
    // stack of stale screens, and only that user can see it.
    const r = await handlePaymentsConsole(click(USER_A, 1 << 6) as never);
    expect(r!.type).toBe(7);
  });

  it("keeps two users clicking the public message independent", async () => {
    const a = await handlePaymentsConsole(click(USER_A, 0) as never);
    const b = await handlePaymentsConsole(click(USER_B, 0) as never);
    // Both get their own new private reply; neither touches the shared message.
    expect(a!.type).toBe(4);
    expect(b!.type).toBe(4);
  });
});
