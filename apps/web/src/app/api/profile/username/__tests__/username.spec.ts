import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { findOrCreateUserByIdentity } from "@/lib/store";
import { signSession } from "@/lib/session";
import { validateUsername } from "@/lib/username";
import * as walletHandles from "@/lib/walletHandles";
import { PUT } from "../route";

// Usernames: rules, uniqueness, identity binding (no Supabase here, so the
// process-local index stands in for migration 0029's unique index; the SQL
// itself is exercised on PostgreSQL by the harness).

let ip = 0;
const put = (body: unknown, token?: string) =>
  PUT(
    new NextRequest("http://localhost/api/profile/username", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-real-ip": `203.0.113.${(ip++ % 200) + 1}`,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    })
  );

async function user() {
  const email = `u-${randomUUID()}@example.test`;
  const { account } = findOrCreateUserByIdentity({ email, name: "Test User", authProvider: "email" } as never);
  const token = await signSession({ sub: account.user.id, safe: account.user.safeAddress, roles: ["user"] } as never);
  return { account, token };
}
const name = () => `u-${randomUUID().slice(0, 8)}`;

describe("validateUsername", () => {
  it.each([
    ["Ada-Lovelace", "ada-lovelace"],
    ["  @ada99 ", "ada99"],
  ])("%j → %s (trimmed, lowercased, @ stripped)", (raw, want) => {
    expect(validateUsername(raw)).toEqual({ ok: true, username: want });
  });
  it.each(["ab", "a".repeat(33), "has space", "under_score", "-lead", "trail-", "admin", "furlpay", "", 42])(
    "%j is refused",
    (raw) => expect(validateUsername(raw).ok).toBe(false)
  );
});

describe("PUT /api/profile/username", () => {
  it("requires a session", async () => {
    expect((await put({ username: name() })).status).toBe(401);
  });

  it("sets, then reads back through the account", async () => {
    const { account, token } = await user();
    const n = name();
    const res = await put({ username: n.toUpperCase() }, token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ username: n });
    expect(account.user.username).toBe(n);
  });

  it("a second account cannot take the same name (409), case-insensitively", async () => {
    const a = await user();
    const b = await user();
    const n = name();
    expect((await put({ username: n }, a.token)).status).toBe(200);
    const res = await put({ username: n.toUpperCase() }, b.token);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("taken");
    expect(b.account.user.username).toBeUndefined();
  });

  it("renaming frees the old name for someone else", async () => {
    const a = await user();
    const b = await user();
    const first = name();
    await put({ username: first }, a.token);
    expect((await put({ username: name() }, a.token)).status).toBe(200);
    expect((await put({ username: first }, b.token)).status).toBe(200);
  });

  it("invalid and reserved names → 400 with the rule in words", async () => {
    const { token } = await user();
    for (const bad of ["x", "support", "no spaces"]) {
      const res = await put({ username: bad }, token);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { detail: string }).detail.length).toBeGreaterThan(5);
    }
  });

  it("cannot target another account: identity fields in the body are rejected", async () => {
    const a = await user();
    const b = await user();
    const res = await put({ username: name(), userId: b.account.user.id }, a.token);
    expect(res.status).toBe(400);
    expect(b.account.user.username).toBeUndefined();
  });

  it("someone else's wallet handle is not available as a username", async () => {
    const { token } = await user();
    const n = name();
    const spy = vi.spyOn(walletHandles, "getHandle").mockResolvedValue({ ownerId: "someone-else", reservedAt: 0 } as never);
    const res = await put({ username: n }, token);
    spy.mockRestore();
    expect(res.status).toBe(409);
  });

  it("null clears the username", async () => {
    const { account, token } = await user();
    await put({ username: name() }, token);
    const res = await put({ username: null }, token);
    expect(res.status).toBe(200);
    expect(account.user.username).toBeUndefined();
  });
});
