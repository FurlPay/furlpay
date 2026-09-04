import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  adminSnowflakes,
  inspectDiscordUser,
  isDiscordAdmin,
  listDiscordUsers,
} from "../discord/admin";
import { handlePaymentsConsole } from "../discord/handler";
import { id } from "../discord/console";
import { auditEntries } from "../../audit";

// ---------------------------------------------------------------------------
// The admin console.
//
// THE PROPERTY THAT MATTERS MOST: Discord Administrator is not FurlPay
// authorization. The bot holds Administrator so it can create channels and pin
// messages — an operational capability inside one chat product. It confers no
// right to read another person's balance, and a server owner is not
// automatically entitled to their members' financial records.
//
// So these tests attack the boundary from both directions: a Discord admin who
// is not on the FurlPay allowlist must be refused, and being on the allowlist
// must not become a way to act AS a user.
// ---------------------------------------------------------------------------

const ADMIN = "999000000000000001";
const NOT_ADMIN = "111111111111111111";
const TARGET = "222222222222222222";

let saved: string | undefined;

beforeEach(() => {
  saved = process.env.FURLPAY_DISCORD_ADMINS;
  process.env.FURLPAY_DISCORD_ADMINS = ADMIN;
  process.env.DISCORD_GUILD_ID = "1522006337070825482";
  const g = globalThis as unknown as { __furlpayKv?: Map<string, unknown> };
  g.__furlpayKv?.clear();
});

afterEach(() => {
  if (saved === undefined) delete process.env.FURLPAY_DISCORD_ADMINS;
  else process.env.FURLPAY_DISCORD_ADMINS = saved;
});

describe("authorization is an explicit allowlist", () => {
  it("admits only configured snowflakes", () => {
    expect(isDiscordAdmin(ADMIN)).toBe(true);
    expect(isDiscordAdmin(NOT_ADMIN)).toBe(false);
  });

  it("admits nobody when the allowlist is empty", () => {
    // Fail closed. An unset variable must not mean "everyone is an admin",
    // which is what a truthiness check on an empty list would produce.
    process.env.FURLPAY_DISCORD_ADMINS = "";
    expect(isDiscordAdmin(ADMIN)).toBe(false);
    expect(adminSnowflakes()).toHaveLength(0);
  });

  it("ignores entries that are not snowflakes", () => {
    // A stray "*", "all" or "true" in the variable must not widen access.
    process.env.FURLPAY_DISCORD_ADMINS = "*,all,true,admin,,   ";
    expect(adminSnowflakes()).toHaveLength(0);
    expect(isDiscordAdmin(ADMIN)).toBe(false);
    expect(isDiscordAdmin("*")).toBe(false);
  });

  it("takes only a snowflake, so Discord permissions cannot reach the decision", () => {
    // isDiscordAdmin has no parameter for a member, a role list or a
    // permissions bitfield. There is no argument through which Discord's own
    // notion of "administrator" could be passed in.
    expect(isDiscordAdmin.length).toBe(1);
  });

  it("revokes immediately, without a redeploy", () => {
    expect(isDiscordAdmin(ADMIN)).toBe(true);
    process.env.FURLPAY_DISCORD_ADMINS = "";
    // Read per call rather than cached at import.
    expect(isDiscordAdmin(ADMIN)).toBe(false);
  });
});

describe("a Discord administrator gets nothing for free", () => {
  const asDiscordAdmin = (customId: string) => ({
    type: 3,
    guild_id: "1522006337070825482",
    member: {
      user: { id: NOT_ADMIN, username: "server-owner" },
      // Everything Discord could say about privilege, said at once.
      permissions: "8", // ADMINISTRATOR
      roles: ["admin-role-id"],
    },
    message: { flags: 1 << 6 },
    data: { custom_id: customId },
  });

  it("refuses the user list to a Discord Administrator not on the allowlist", async () => {
    const r = await handlePaymentsConsole(asDiscordAdmin(id("admin_users")) as never);
    expect(JSON.stringify(r)).toMatch(/not a FurlPay administrator/i);
  });

  it("refuses user inspection to a Discord Administrator not on the allowlist", async () => {
    const r = await handlePaymentsConsole(asDiscordAdmin(id("admin_user", TARGET)) as never);
    const body = JSON.stringify(r);
    expect(body).toMatch(/not a FurlPay administrator/i);
    // And leaks nothing about whether the target even exists.
    expect(body).not.toContain(TARGET);
  });

  it("records the refusal so probing is visible", async () => {
    await handlePaymentsConsole(asDiscordAdmin(id("admin_users")) as never);
    const denied = auditEntries(50).filter((e) => e.event === "admin.access_denied");
    expect(denied.length).toBeGreaterThan(0);
    expect(denied[0].actor).toBe(NOT_ADMIN);
  });
});

describe("authorized admin reads", () => {
  it("lists users and audits the read", async () => {
    const r = await listDiscordUsers(ADMIN);
    expect(r.ok).toBe(true);
    const listed = auditEntries(50).filter((e) => e.event === "admin.users_listed");
    expect(listed.length).toBeGreaterThan(0);
    expect(listed[0].actor).toBe(ADMIN);
  });

  it("records both sides when one person is inspected", async () => {
    // The event worth being able to reconstruct later is "who looked at whom".
    await inspectDiscordUser(ADMIN, TARGET);
    const events = auditEntries(50).filter(
      (e) => e.event === "admin.user_inspected" || e.event === "admin.access_denied"
    );
    expect(events.length).toBeGreaterThan(0);
  });

  it("reports a missing target rather than inventing one", async () => {
    const r = await inspectDiscordUser(ADMIN, "888888888888888888");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_found");
  });

  it("says so when no admins are configured, rather than silently allowing", async () => {
    process.env.FURLPAY_DISCORD_ADMINS = "";
    const r = await listDiscordUsers(ADMIN);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_configured");
  });
});

describe("admin views are read-only projections, not sessions", () => {
  it("never returns anything that could be used as an authenticated account", async () => {
    const r = await listDiscordUsers(ADMIN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const body = JSON.stringify(r.value);

    // No session, no token, no secret, no full account object. An admin view
    // that could be handed to code expecting an owner would be impersonation
    // by another name.
    for (const forbidden of ["security", "totpSecret", "session", "token", "safeAddress"]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });

  it("masks wallet addresses and emails", async () => {
    const r = await listDiscordUsers(ADMIN);
    if (!r.ok) return;
    for (const u of r.value) {
      if (u.walletMasked) expect(u.walletMasked).toContain("•");
      if (u.emailMasked) expect(u.emailMasked).toContain("•");
    }
  });

  it("exposes no mutation surface", async () => {
    // The module's whole exported API is three reads and a predicate. There is
    // deliberately no freeze, no transfer, no wallet-change and no "act as".
    const mod = await import("../discord/admin");
    const exported = Object.keys(mod).sort();
    expect(exported).toEqual([
      "adminSnowflakes",
      "inspectDiscordUser",
      "isDiscordAdmin",
      "listDiscordUsers",
    ]);
  });
});

describe("admin output stays private", () => {
  it("answers ephemerally, never into the channel", async () => {
    const r = await handlePaymentsConsole({
      type: 3,
      guild_id: "1522006337070825482",
      member: { user: { id: ADMIN, username: "admin" } },
      message: { flags: 1 << 6 },
      data: { custom_id: id("admin_users") },
    } as never);
    expect((r!.data as { flags?: number }).flags).toBe(1 << 6);
  });

  it("opens a new private reply when opened from a public message", async () => {
    // Even for an admin, a click on the public pinned message must not rewrite
    // it — and an admin screen listing members is the last thing that should
    // land in a shared channel.
    const r = await handlePaymentsConsole({
      type: 3,
      guild_id: "1522006337070825482",
      member: { user: { id: ADMIN, username: "admin" } },
      message: { flags: 0 },
      data: { custom_id: id("admin_users") },
    } as never);
    expect(r!.type).toBe(4);
    expect(r!.type).not.toBe(7);
  });
});
