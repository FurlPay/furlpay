import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// A real in-memory KV so consumption, attempt counting and expiry are exercised
// rather than stubbed away — those ARE the security properties under test.
const store = new Map<string, unknown>();
vi.mock("@/lib/kv", () => ({
  kvGet: async (k: string) => (store.has(k) ? store.get(k) : null),
  kvSet: async (k: string, v: unknown) => void store.set(k, v),
  kvDel: async (k: string) => void store.delete(k),
  kvIncr: async (k: string) => {
    const n = ((store.get(`c:${k}`) as number) ?? 0) + 1;
    store.set(`c:${k}`, n);
    return n;
  },
}));

import {
  CAPTCHA_MAX_ATTEMPTS,
  checkChallenge,
  issueChallenge,
  readChallenge,
} from "../challenge";
import { VERIFY_START_ID, buildVerifyPanel, handleVerify, modalValue } from "../flow";
import { ROLE_CATALOG, VERIFIED_ROLE_NAME } from "@/lib/discordRoles/catalog";

const GUILD = "1522006337070825482";
const USER = "member-1";
const OTHER = "member-2";

beforeEach(() => store.clear());
afterEach(() => vi.unstubAllGlobals());

describe("captcha challenge", () => {
  it("uses an alphabet without characters people confuse", async () => {
    // A member who reads the picture correctly and still fails because the
    // font renders 1 like l has been told the system is broken.
    for (let n = 0; n < 40; n++) {
      const issued = await issueChallenge(USER, GUILD);
      const c = await readChallenge(issued!.id);
      expect(c!.code).not.toMatch(/[O0I1L]/);
      expect(c!.code).toMatch(/^[A-Z2-9]{5}$/);
    }
  });

  it("issues unguessable ids", async () => {
    const ids = new Set<string>();
    for (let n = 0; n < 50; n++) ids.add((await issueChallenge(USER, GUILD))!.id);
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("accepts the right code, case-insensitively", async () => {
    const issued = await issueChallenge(USER, GUILD);
    const code = (await readChallenge(issued!.id))!.code;
    expect(await checkChallenge(issued!.id, USER, code.toLowerCase())).toEqual({ ok: true });
  });

  it("consumes the challenge on success, so it cannot be replayed", async () => {
    const issued = await issueChallenge(USER, GUILD);
    const code = (await readChallenge(issued!.id))!.code;
    expect((await checkChallenge(issued!.id, USER, code)).ok).toBe(true);
    // Second use of a solved challenge must fail.
    expect(await checkChallenge(issued!.id, USER, code)).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses a challenge issued to someone else", async () => {
    // Otherwise one solved captcha could be passed round a group.
    const issued = await issueChallenge(USER, GUILD);
    const code = (await readChallenge(issued!.id))!.code;
    expect(await checkChallenge(issued!.id, OTHER, code)).toEqual({ ok: false, reason: "wrong-user" });
  });

  it("checks ownership before the code, so it is not a guessing oracle", async () => {
    const issued = await issueChallenge(USER, GUILD);
    // A wrong answer from the wrong user must not even burn an attempt.
    await checkChallenge(issued!.id, OTHER, "ZZZZZ");
    expect((await readChallenge(issued!.id))!.attempts).toBe(0);
  });

  it("burns the challenge after too many wrong answers", async () => {
    const issued = await issueChallenge(USER, GUILD);
    for (let i = 0; i < CAPTCHA_MAX_ATTEMPTS - 1; i++) {
      const r = await checkChallenge(issued!.id, USER, "ZZZZZ");
      expect(r).toMatchObject({ ok: false, reason: "incorrect" });
    }
    expect(await checkChallenge(issued!.id, USER, "ZZZZZ")).toEqual({ ok: false, reason: "exhausted" });
    // And it is gone — brute force costs a new image each time.
    expect(await readChallenge(issued!.id)).toBeNull();
  });

  it("rejects a malformed id without touching storage", async () => {
    expect(await readChallenge("../../etc/passwd")).toBeNull();
    expect(await readChallenge("short")).toBeNull();
  });
});

describe("verify panel", () => {
  it("offers a Verify button and warns about the scam it exists to stop", () => {
    const panel = buildVerifyPanel();
    const row = (panel.components as { components: { custom_id: string }[] }[])[0]!;
    expect(row.components[0]!.custom_id).toBe(VERIFY_START_ID);
    const text = JSON.stringify(panel);
    expect(text).toContain("never");
    expect(text).toContain("seed phrase");
  });

  it("never solicits a secret", () => {
    const text = JSON.stringify(buildVerifyPanel());
    expect(text).not.toMatch(/(send|share|provide|reply with)[^.]{0,40}(seed phrase|private key|wallet address)/i);
  });
});

describe("verify flow", () => {
  const ROLES = [
    { id: "r-verified", name: VERIFIED_ROLE_NAME, position: 1 },
    { id: "r-bot", name: "Furlpay", position: 50, managed: true },
  ];

  function stub(opts: { botRoles?: string[] } = {}) {
    const writes: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (url.endsWith("/roles") && method === "GET") return new Response(JSON.stringify(ROLES), { status: 200 });
      if (url.includes("/users/@me")) return new Response(JSON.stringify({ id: "bot" }), { status: 200 });
      if (url.includes("/members/bot") && method === "GET") {
        return new Response(JSON.stringify({ roles: opts.botRoles ?? ["r-bot"] }), { status: 200 });
      }
      const m = url.match(/\/members\/[^/]+\/roles\/([^/?]+)$/);
      if (m) {
        writes.push(m[1]!);
        return new Response(null, { status: 204 });
      }
      return new Response("{}", { status: 404 });
    });
    return writes;
  }

  const base = { guild_id: GUILD, member: { user: { id: USER } } };

  it("shows a captcha image and an Enter code button", async () => {
    stub();
    const r = await handleVerify({ ...base, data: { custom_id: VERIFY_START_ID } }, "tok");
    const data = r!.data as Record<string, any>;
    expect(data.embeds[0].image.url).toMatch(/\/api\/og\/captcha\/[0-9a-f]{32}$/);
    expect(data.components[0].components[0].custom_id).toMatch(/^verify:v1:open:[0-9a-f]{32}$/);
    // Ephemeral: a verification channel must not fill with captcha images.
    expect(data.flags & 64).toBe(64);
  });

  it("opens a modal with a single fixed-length code input", async () => {
    stub();
    const start = await handleVerify({ ...base, data: { custom_id: VERIFY_START_ID } }, "tok");
    const openId = (start!.data as any).components[0].components[0].custom_id;

    const modal = await handleVerify({ ...base, data: { custom_id: openId } }, "tok");
    // Callback type 9 is MODAL; anything else renders as a broken interaction.
    expect(modal!.type).toBe(9);
    const d = modal!.data as Record<string, any>;
    expect(d.custom_id).toMatch(/^verify:v1:submit:[0-9a-f]{32}$/);
    expect(d.title.length).toBeLessThanOrEqual(45);
    const input = d.components[0].components[0];
    expect(input.type).toBe(4);
    expect(input.style).toBe(1);
    expect(input.min_length).toBe(5);
    expect(input.max_length).toBe(5);
    expect(String(input.label).length).toBeLessThanOrEqual(45);
  });

  it("grants Verified on the right code", async () => {
    const writes = stub();
    const start = await handleVerify({ ...base, data: { custom_id: VERIFY_START_ID } }, "tok");
    const id = (start!.data as any).components[0].components[0].custom_id.split(":").pop();
    const code = (await readChallenge(id))!.code;

    const done = await handleVerify(
      {
        ...base,
        data: {
          custom_id: `verify:v1:submit:${id}`,
          components: [{ components: [{ custom_id: "code", value: code }] }],
        },
      },
      "tok"
    );
    expect(writes).toEqual(["r-verified"]);
    expect(JSON.stringify(done!.data)).toContain("Verification successful");
  });

  it("grants nothing on a wrong code", async () => {
    const writes = stub();
    const start = await handleVerify({ ...base, data: { custom_id: VERIFY_START_ID } }, "tok");
    const id = (start!.data as any).components[0].components[0].custom_id.split(":").pop();

    const done = await handleVerify(
      {
        ...base,
        data: {
          custom_id: `verify:v1:submit:${id}`,
          components: [{ components: [{ custom_id: "code", value: "ZZZZZ" }] }],
        },
      },
      "tok"
    );
    expect(writes).toEqual([]);
    expect(JSON.stringify(done!.data)).toContain("Not verified");
  });

  it("explains the hierarchy problem rather than silently failing", async () => {
    // Bot's highest role at position 1, same as Verified.
    const writes = stub({ botRoles: ["r-verified"] });
    const start = await handleVerify({ ...base, data: { custom_id: VERIFY_START_ID } }, "tok");
    const id = (start!.data as any).components[0].components[0].custom_id.split(":").pop();
    const code = (await readChallenge(id))!.code;

    const done = await handleVerify(
      {
        ...base,
        data: {
          custom_id: `verify:v1:submit:${id}`,
          components: [{ components: [{ custom_id: "code", value: code }] }],
        },
      },
      "tok"
    );
    expect(writes).toEqual([]);
    expect(JSON.stringify(done!.data)).toContain("above it");
  });

  it("throttles a member spinning the Verify button", async () => {
    stub();
    let last;
    for (let i = 0; i < 8; i++) {
      last = await handleVerify({ ...base, data: { custom_id: VERIFY_START_ID } }, "tok");
    }
    expect(JSON.stringify(last!.data)).toContain("Wait a few minutes");
  });

  it("ignores interactions that are not its own", async () => {
    stub();
    expect(await handleVerify({ ...base, data: { custom_id: "roles:v1:identity" } }, "tok")).toBeNull();
  });

  it("never leaks the bot token", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));
    const start = await handleVerify({ ...base, data: { custom_id: VERIFY_START_ID } }, "super-secret");
    expect(JSON.stringify(start)).not.toContain("super-secret");
  });

  it("extracts a modal value from the nested action-row shape", () => {
    const i = { data: { components: [{ components: [{ custom_id: "code", value: "ABC12" }] }] } };
    expect(modalValue(i, "code")).toBe("ABC12");
    expect(modalValue(i, "nope")).toBe("");
  });
});

describe("Verified is not a self-serve role", () => {
  it("cannot be granted through the role picker", () => {
    // If the picker could grant Verified, the captcha gate would be decorative.
    const spec = ROLE_CATALOG.find((r) => r.name === VERIFIED_ROLE_NAME);
    expect(spec).toBeDefined();
    expect(spec!.selfAssignable).toBe(false);
  });
});
