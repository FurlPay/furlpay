import { describe, it, expect, afterEach, vi } from "vitest";
import {
  ROLE_CATALOG,
  allSelfAssignable,
  resolveSelfAssignableKey,
  selfAssignable,
} from "../catalog";
import { IDENTITY_CUSTOM_ID, NOTIFY_CUSTOM_ID, buildRolePicker, groupForCustomId } from "../picker";
import { canManageRole } from "../rest";
import { handleRolePicker } from "../handle";
import { ROLE_ICONS } from "../iconData";
import { emojiName } from "@/lib/discordServer/emoji";

vi.mock("@/lib/kv", () => ({
  kvGet: async () => null,
  kvSet: async () => {},
}));

// ---------------------------------------------------------------------------
// A role picker is an endpoint that grants Discord permissions on request. Most
// of these tests are about the two ways that goes wrong: granting a role it
// should never grant, and removing a role it was never shown.
// ---------------------------------------------------------------------------

const GUILD = "1522006337070825482";
const BOT = "1523364052116705400";

describe("catalog", () => {
  it("never marks a staff or earned role self-assignable", () => {
    // The load-bearing assertion in this file. If someone adds
    // `selfAssignable: true` to Moderator, this fails before it ships.
    const staff = ROLE_CATALOG.filter((r) => r.group === "staff");
    expect(staff.length).toBeGreaterThan(0);
    for (const r of staff) expect(r.selfAssignable).toBe(false);

    for (const name of ["Moderator", "Team", "Founder", "Partner", "Contributor"]) {
      const spec = ROLE_CATALOG.find((r) => r.name === name);
      expect(spec, `${name} should be in the catalog`).toBeDefined();
      expect(spec!.selfAssignable, `${name} must never be self-assignable`).toBe(false);
    }
  });

  it("refuses to resolve a staff key even though the key exists", () => {
    // "moderator" is a real catalog key. Resolution must still return null,
    // because a forged submission would use exactly that value.
    expect(resolveSelfAssignableKey("moderator")).toBeNull();
    expect(resolveSelfAssignableKey("team")).toBeNull();
    expect(resolveSelfAssignableKey("founder")).toBeNull();
    expect(resolveSelfAssignableKey("not-a-role")).toBeNull();
    expect(resolveSelfAssignableKey("developer")?.name).toBe("Developer");
  });

  it("has unique keys and names", () => {
    const keys = ROLE_CATALOG.map((r) => r.key);
    const names = ROLE_CATALOG.map((r) => r.name.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it("covers the roles that were asked for", () => {
    const assignable = allSelfAssignable().map((r) => r.name);
    expect(assignable).toContain("Developer");
    expect(assignable).toContain("Investor");
    expect(assignable).toContain("Finance Expert");
    expect(assignable).not.toContain("Moderator");
  });

  it("keeps each select menu inside Discord's 25-option limit", () => {
    expect(selfAssignable("identity").length).toBeLessThanOrEqual(25);
    expect(selfAssignable("notify").length).toBeLessThanOrEqual(25);
  });
});

describe("picker", () => {
  it("builds two menus that can be cleared as well as set", () => {
    const msg = buildRolePicker();
    const rows = msg.components as { components: Record<string, unknown>[] }[];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const menu = row.components[0]!;
      // min_values 0 is what makes the menu a toggle instead of a one-way grant.
      expect(menu.min_values).toBe(0);
      expect(menu.max_values).toBe((menu.options as unknown[]).length);
    }
  });

  it("offers only self-assignable roles as options", () => {
    const msg = buildRolePicker();
    const rows = msg.components as { components: { options: { value: string }[] }[] }[];
    const offered = rows.flatMap((r) => r.components[0]!.options.map((o) => o.value));
    for (const value of offered) {
      expect(resolveSelfAssignableKey(value), `${value} must be self-assignable`).not.toBeNull();
    }
    expect(offered).not.toContain("moderator");
  });

  it("recognises only its own custom ids", () => {
    expect(groupForCustomId(IDENTITY_CUSTOM_ID)).toBe("identity");
    expect(groupForCustomId(NOTIFY_CUSTOM_ID)).toBe("notify");
    expect(groupForCustomId("roles:v9:evil")).toBeNull();
    expect(groupForCustomId("something-else")).toBeNull();
  });

  it("pings nobody", () => {
    expect(buildRolePicker().allowed_mentions).toEqual({ parse: [] });
  });
});

describe("role hierarchy", () => {
  it("refuses a role at or above the bot's own position", () => {
    // The live finding on this server: every role sits at position 1, including
    // the bot's own, so nothing is assignable until the bot is moved up.
    expect(canManageRole({ id: "1", name: "Developer", position: 1 }, 1).ok).toBe(false);
    expect(canManageRole({ id: "1", name: "Developer", position: 1 }, 2).ok).toBe(true);
  });

  it("refuses a Discord-managed role outright", () => {
    const r = canManageRole({ id: "1", name: "Server Booster", position: 1, managed: true }, 99);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("managed");
  });
});

describe("applying a submission", () => {
  afterEach(() => vi.unstubAllGlobals());

  const ROLES = [
    { id: "r-dev", name: "Developer", position: 1 },
    { id: "r-inv", name: "Investor", position: 1 },
    { id: "r-fin", name: "Finance Expert", position: 1 },
    { id: "r-mod", name: "Moderator", position: 1 },
    { id: "r-notify", name: "Hackathons", position: 1 },
    { id: "r-bot", name: "Furlpay", position: 50, managed: true },
  ];

  /** Records every role write so a test can assert what was NOT called. */
  function stub(botRoles = ["r-bot"]) {
    const writes: { method: string; roleId: string }[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (url.endsWith("/roles") && method === "GET") {
        return new Response(JSON.stringify(ROLES), { status: 200 });
      }
      if (url.includes("/users/@me")) {
        return new Response(JSON.stringify({ id: BOT }), { status: 200 });
      }
      if (url.includes(`/members/${BOT}`) && method === "GET") {
        return new Response(JSON.stringify({ roles: botRoles }), { status: 200 });
      }
      const m = url.match(/\/members\/[^/]+\/roles\/([^/?]+)$/);
      if (m) {
        writes.push({ method, roleId: m[1]! });
        return new Response(null, { status: 204 });
      }
      return new Response("{}", { status: 404 });
    });
    return writes;
  }

  function interaction(customId: string, values: string[], held: string[] = []) {
    return {
      data: { custom_id: customId, values },
      guild_id: GUILD,
      member: { user: { id: "member-1" }, roles: held },
    };
  }

  it("adds the roles a member picked", async () => {
    const writes = stub();
    const r = await handleRolePicker(interaction(IDENTITY_CUSTOM_ID, ["developer", "investor"]), "tok");
    expect(r!.added.sort()).toEqual(["Developer", "Investor"]);
    expect(writes.filter((w) => w.method === "PUT").map((w) => w.roleId).sort()).toEqual(["r-dev", "r-inv"]);
  });

  it("removes a role the member deselected", async () => {
    const writes = stub();
    const r = await handleRolePicker(interaction(IDENTITY_CUSTOM_ID, ["developer"], ["r-dev", "r-inv"]), "tok");
    expect(r!.added).toEqual([]);
    expect(r!.removed).toEqual(["Investor"]);
    expect(writes).toEqual([{ method: "DELETE", roleId: "r-inv" }]);
  });

  it("removes everything in the group when the menu is cleared", async () => {
    stub();
    const r = await handleRolePicker(interaction(IDENTITY_CUSTOM_ID, [], ["r-dev", "r-inv"]), "tok");
    expect(r!.removed.sort()).toEqual(["Developer", "Investor"]);
  });

  it("NEVER grants a staff role, even when one is submitted directly", async () => {
    // The forged-payload case. Discord signs that the interaction came from
    // Discord; it does not promise the values were ones the menu offered.
    const writes = stub();
    const r = await handleRolePicker(interaction(IDENTITY_CUSTOM_ID, ["moderator", "developer"]), "tok");
    expect(r!.added).toEqual(["Developer"]);
    expect(writes.map((w) => w.roleId)).not.toContain("r-mod");
  });

  it("never removes a role the menu does not offer", async () => {
    // A member who holds Moderator submits the identity menu. Moderator is not
    // among the submitted values, and a naive diff would strip it.
    const writes = stub();
    const r = await handleRolePicker(
      interaction(IDENTITY_CUSTOM_ID, ["developer"], ["r-mod", "r-notify"]),
      "tok"
    );
    expect(r!.removed).toEqual([]);
    expect(writes.map((w) => w.roleId)).not.toContain("r-mod");
    // The notification role belongs to the other menu and must also survive.
    expect(writes.map((w) => w.roleId)).not.toContain("r-notify");
  });

  it("ignores a value replayed from the other menu", async () => {
    const writes = stub();
    const r = await handleRolePicker(interaction(IDENTITY_CUSTOM_ID, ["notify-hackathons"]), "tok");
    expect(r!.added).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("explains the hierarchy problem instead of failing opaquely", async () => {
    // Bot's highest role at position 1, same as the targets — the exact state
    // this server is in today.
    const writes = stub(["r-dev"]);
    const r = await handleRolePicker(interaction(IDENTITY_CUSTOM_ID, ["investor"]), "tok");
    expect(writes).toEqual([]);
    expect(JSON.stringify(r!.reply)).toContain("above them");
  });

  it("says nothing changed rather than writing needlessly", async () => {
    const writes = stub();
    const r = await handleRolePicker(interaction(IDENTITY_CUSTOM_ID, ["developer"], ["r-dev"]), "tok");
    expect(writes).toEqual([]);
    expect(JSON.stringify(r!.reply)).toContain("already have");
  });

  it("replies ephemerally so a picker does not spam the channel", async () => {
    stub();
    const r = await handleRolePicker(interaction(IDENTITY_CUSTOM_ID, ["developer"]), "tok");
    expect((r!.reply as { flags: number }).flags & 64).toBe(64);
  });

  it("returns null for an interaction that is not a role picker", async () => {
    stub();
    expect(await handleRolePicker(interaction("some:other:thing", []), "tok")).toBeNull();
  });

  it("never leaks the bot token", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));
    const r = await handleRolePicker(interaction(IDENTITY_CUSTOM_ID, ["developer"]), "super-secret");
    expect(JSON.stringify(r)).not.toContain("super-secret");
  });
});

describe("custom icon emoji", () => {
  it("uses a custom guild emoji when one exists, for both the menu and the text", () => {
    const icons = { developer: { id: "999", name: "furlpay_developer" } };
    const msg = buildRolePicker(new Set(), icons);

    // Structured field on the select option.
    const rows = msg.components as { components: { options: Record<string, any>[] }[] }[];
    const dev = rows[0]!.components[0]!.options.find((o) => o.value === "developer")!;
    expect(dev.emoji).toEqual({ id: "999", name: "furlpay_developer" });

    // Embed TEXT uses a different syntax entirely.
    const field = ((msg.embeds as any[])[0].fields as { value: string }[])[0]!;
    expect(field.value).toContain("<:furlpay_developer:999>");
  });

  it("falls back to unicode where no icon has been uploaded", () => {
    // The icons are an upgrade, not a dependency: a server without them must
    // still get a working picker.
    const msg = buildRolePicker(new Set(), {});
    const rows = msg.components as { components: { options: Record<string, any>[] }[] }[];
    const dev = rows[0]!.components[0]!.options.find((o) => o.value === "developer")!;
    expect(dev.emoji).toEqual({ name: "💻" });
  });

  it("names emoji within Discord's rules", () => {
    for (const r of allSelfAssignable()) {
      const n = emojiName(r.key);
      expect(n).toMatch(/^[A-Za-z0-9_]{2,32}$/);
    }
    expect(emojiName("notify-announcements")).toBe("furlpay_notify_announcements");
  });

  it("has icon geometry for every self-assignable role", () => {
    // A missing entry renders a 404 and leaves that one option iconless.
    for (const r of allSelfAssignable()) {
      expect(ROLE_ICONS[r.key], `${r.key} needs icon geometry`).toBeDefined();
      expect(ROLE_ICONS[r.key]!.elements.length).toBeGreaterThan(0);
    }
  });
});
