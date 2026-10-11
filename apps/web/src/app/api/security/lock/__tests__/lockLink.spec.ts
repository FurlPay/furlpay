import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/*
 * The emailed "lock my account" link. It is reachable without a session on
 * purpose, which makes its behaviour the whole control: a GET must change
 * nothing (mail scanners fetch every link), only the POST from the
 * confirmation button may lock, and nothing but a valid, unexpired HMAC for
 * that exact account gets either one past the token check.
 */

process.env.FURLPAY_SESSION_SECRET = "lock-link-test-secret-0123456789abcdef";

type Account = { user: { id: string; name: string; email: string; security: { accountLocked: boolean } } };
const accounts = new Map<string, Account>();
const persisted: string[] = [];
const audited: { event: string; subject: string }[] = [];
const emails: { to: string }[] = [];
let allowRate = true;

vi.mock("@/lib/store", () => ({
  getAccountDurable: async (id: string) => accounts.get(id) ?? null,
  persistAccount: async (id: string) => {
    persisted.push(id);
  },
}));
vi.mock("@/lib/audit", () => ({ audit: (event: string, subject: string) => audited.push({ event, subject }) }));
vi.mock("@/lib/email", async (orig) => ({
  ...(await orig<typeof import("@/lib/email")>()),
  sendEmail: async (m: { to: string }) => void emails.push(m),
}));
vi.mock("@/lib/rateLimit", async () => {
  const { NextResponse } = await import("next/server");
  return { rateLimitOr429: async () => (allowRate ? null : NextResponse.json({ error: "rate_limited" }, { status: 429 })) };
});

const { lockLinkFor } = await import("@/lib/lockLink");
const { GET, POST } = await import("@/app/api/security/lock/route");

const USER = "user-victim";
const OTHER = "user-other";

function linkParts(userId = USER, ttlDays = 30) {
  const url = new URL(lockLinkFor(userId, ttlDays)!);
  return { u: url.searchParams.get("u")!, e: url.searchParams.get("e")!, t: url.searchParams.get("t")!, url };
}
const get = (search: string) => GET(new NextRequest(`https://furlpay.test/api/security/lock${search}`));
const post = (fields: Record<string, string>) =>
  POST(
    new NextRequest("https://furlpay.test/api/security/lock", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    })
  );
const locked = (id = USER) => accounts.get(id)!.user.security.accountLocked;

beforeEach(() => {
  accounts.clear();
  for (const id of [USER, OTHER]) accounts.set(id, { user: { id, name: id, email: `${id}@example.com`, security: { accountLocked: false } } });
  persisted.length = 0;
  audited.length = 0;
  emails.length = 0;
  allowRate = true;
});

describe("GET: viewing the link changes nothing", () => {
  it("shows a confirmation page and does not lock, however many times it is fetched", async () => {
    const { url } = linkParts();
    for (let i = 0; i < 5; i++) {
      const res = await get(url.search);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('method="post"');
      expect(html).toContain("Lock my account");
    }
    // What a mail gateway or link-preview bot does. The account is untouched.
    expect(locked()).toBe(false);
    expect(persisted).toEqual([]);
    expect(audited).toEqual([]);
    expect(emails).toEqual([]);
  });

  it("keeps the token out of referrers, caches and indexes", async () => {
    const res = await get(linkParts().url.search);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    expect(res.headers.get("content-security-policy")).toContain("form-action 'self'");
  });

  it("rejects a missing, malformed or forged token without revealing anything", async () => {
    const { u, e, t } = linkParts();
    for (const search of ["", `?u=${u}`, `?u=${u}&e=${e}&t=short`, `?u=${u}&e=${e}&t=${"A".repeat(t.length)}`, `?u=${u}&e=notanumber&t=${t}`]) {
      const res = await get(search);
      expect(res.status, search).toBe(401);
      expect(await res.text()).toContain("invalid or has expired");
    }
  });

  it("escapes what it reflects into the page", async () => {
    // A value that fails the HMAC never reaches the form; this checks the
    // escaper on the one path that reflects, using a valid token.
    const { url } = linkParts();
    const html = await (await get(url.search)).text();
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain(`name="u" value="${USER}"`);
  });
});

describe("POST: the button locks the account", () => {
  it("locks, persists, audits and notifies", async () => {
    const res = await post(linkParts());
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Your account is locked");
    expect(locked()).toBe(true);
    expect(persisted).toEqual([USER]);
    expect(audited).toEqual([{ event: "account.locked", subject: USER }]);
    expect(emails.map((m) => m.to)).toEqual([`${USER}@example.com`]);
  });

  it("is idempotent: a replay leaves the account locked and sends no second email", async () => {
    const parts = linkParts();
    await post(parts);
    const again = await post(parts);
    expect(again.status).toBe(200);
    expect(locked()).toBe(true);
    expect(emails).toHaveLength(1);
  });

  it("handles concurrent submissions without unlocking or erroring", async () => {
    const parts = linkParts();
    const results = await Promise.all(Array.from({ length: 8 }, () => post(parts)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(locked()).toBe(true);
  });

  it("cannot be pointed at another account: the token is bound to the user id", async () => {
    const { e, t } = linkParts(USER);
    const res = await post({ u: OTHER, e, t });
    expect(res.status).toBe(401);
    expect(locked(OTHER)).toBe(false);
    expect(locked(USER)).toBe(false);
  });

  it("cannot have its expiry extended: the token is bound to the expiry", async () => {
    const { u, e, t } = linkParts();
    const res = await post({ u, e: String(Number(e) + 86_400), t });
    expect(res.status).toBe(401);
    expect(locked()).toBe(false);
  });

  it("rejects an expired link", async () => {
    const res = await post(linkParts(USER, -1));
    expect(res.status).toBe(401);
    expect(locked()).toBe(false);
  });

  it("rejects a tampered signature", async () => {
    const { u, e, t } = linkParts();
    const flipped = (t[0] === "A" ? "B" : "A") + t.slice(1);
    expect((await post({ u, e, t: flipped })).status).toBe(401);
    expect(locked()).toBe(false);
  });

  it("answers an unknown account exactly like a bad token", async () => {
    const parts = linkParts("user-that-does-not-exist");
    const res = await post(parts);
    expect(res.status).toBe(401);
    expect(await res.text()).toContain("invalid or has expired");
    expect(persisted).toEqual([]);
  });

  it("rejects a body that is not a form, and missing fields", async () => {
    const bad = await POST(new NextRequest("https://furlpay.test/api/security/lock", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(bad.status).toBe(401);
    expect((await post({ u: USER })).status).toBe(401);
    expect(locked()).toBe(false);
  });

  it("is rate limited before anything else runs", async () => {
    allowRate = false;
    expect((await post(linkParts())).status).toBe(429);
    expect((await get(linkParts().url.search)).status).toBe(429);
    expect(locked()).toBe(false);
  });
});

describe("the token", () => {
  it("is not written to the audit record", async () => {
    await post(linkParts());
    expect(JSON.stringify(audited)).not.toContain(linkParts().t);
  });
});
