import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { canonicalEmail, isPlausibleEmail } from "../identity";
import { findOrCreateUserByIdentity, findUserByIdentity, updateUser } from "../store";
import { isBootstrapAdminEmail } from "../adminIdentity";

// One mailbox = one identity (audit: identity split between the OTP key and
// the account lookup), and a failed identity lookup never mints a new account.

describe("canonicalEmail", () => {
  it.each([
    ["User@Example.com", "user@example.com"],
    ["  user@example.com\t", "user@example.com"],
    ["USER@EXAMPLE.COM", "user@example.com"],
    // "é" precomposed (NFC) vs e + combining acute (NFD): one identity.
    ["josé@example.com", "josé@example.com"],
    ["josé@example.com", "josé@example.com"],
  ])("%j → %j", (input, want) => {
    expect(canonicalEmail(input)).toBe(want);
  });

  it("does NOT fold look-alike characters into one identity (Cyrillic а ≠ Latin a)", () => {
    expect(canonicalEmail("аlice@example.com")).not.toBe(canonicalEmail("alice@example.com"));
  });

  it("rejects non-addresses", () => {
    expect(isPlausibleEmail("not an email")).toBe(false);
    expect(isPlausibleEmail("a@b")).toBe(false);
    expect(isPlausibleEmail(" A@B.co ")).toBe(true);
  });
});

describe("store: one account per mailbox", () => {
  it("case and whitespace variants resolve to the SAME account", () => {
    const local = `split-${randomUUID()}`;
    const first = findOrCreateUserByIdentity({ email: `${local}@example.com` });
    const variant = findOrCreateUserByIdentity({ email: `  ${local.toUpperCase()}@EXAMPLE.com ` });
    expect(variant.created).toBe(false);
    expect(variant.account.user.id).toBe(first.account.user.id);
    expect(findUserByIdentity({ email: `${local}@Example.COM` })?.user.id).toBe(first.account.user.id);
  });

  it("stores the canonical form", () => {
    const local = `stored-${randomUUID()}`;
    const { account } = findOrCreateUserByIdentity({ email: ` ${local.toUpperCase()}@Example.com` });
    expect(account.user.email).toBe(`${local}@example.com`);
  });

  it("admin bootstrap matching uses the same canonical form", () => {
    const env = { NODE_ENV: "production", FURLPAY_ADMIN_EMAIL: " Founder@Example.com" };
    expect(isBootstrapAdminEmail("founder@example.com ", env)).toBe(true);
    expect(isBootstrapAdminEmail("fоunder@example.com", env)).toBe(false); // Cyrillic о
  });
});

describe("durable resolver fails closed", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("../supabase");
    vi.doUnmock("../storeDb");
    delete (globalThis as { __appStateV2?: unknown }).__appStateV2;
  });

  it("a database outage during login throws; it never creates a phantom account", async () => {
    delete (globalThis as { __appStateV2?: unknown }).__appStateV2;
    vi.resetModules();
    vi.doMock("../supabase", async (orig) => ({ ...(await orig<typeof import("../supabase")>()), supabaseBackend: "supabase" }));
    vi.doMock("../storeDb", async (orig) => ({
      ...(await orig<typeof import("../storeDb")>()),
      findUserIdByIdentity: async () => {
        throw new Error("ECONNRESET");
      },
    }));
    const store = await import("../store");
    const email = `outage-${randomUUID()}@example.com`;
    await expect(store.findOrCreateUserByIdentityDurable({ email })).rejects.toBeInstanceOf(store.IdentityUnavailableError);
    expect(store.findUserByIdentity({ email })).toBeUndefined();
  });
});

describe("identity change: the old key stops resolving", () => {
  it("after an email change, the old address no longer finds the account", async () => {
    const old = `old-${randomUUID()}@example.com`;
    const next = `new-${randomUUID()}@example.com`;
    const { account } = findOrCreateUserByIdentity({ email: old });
    updateUser(account.user.id, { email: next });
    expect(findUserByIdentity({ email: old })).toBeUndefined();
    expect(findUserByIdentity({ email: next })?.user.id).toBe(account.user.id);
    // And a login with the OLD address now creates a separate, empty account
    // rather than landing in this one.
    const fresh = findOrCreateUserByIdentity({ email: old });
    expect(fresh.account.user.id).not.toBe(account.user.id);
  });

  it("a phone change drops the old phone key", async () => {
    const { account } = findOrCreateUserByIdentity({ email: `ph-${randomUUID()}@example.com` });
    updateUser(account.user.id, { phone: "+15550000001" });
    updateUser(account.user.id, { phone: "+15550000002" });
    expect(findUserByIdentity({ phone: "+15550000001" })).toBeUndefined();
    expect(findUserByIdentity({ phone: "+15550000002" })?.user.id).toBe(account.user.id);
  });
});
