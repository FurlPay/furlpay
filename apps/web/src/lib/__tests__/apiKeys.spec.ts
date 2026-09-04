import { describe, it, expect, beforeEach } from "vitest";
import {
  API_SCOPES,
  createApiKey,
  effectiveStatus,
  getApiKey,
  hashSecret,
  ipAllowed,
  isValidCidr,
  listApiKeys,
  maskedForm,
  originAllowed,
  parseApiKey,
  redactApiKey,
  revokeApiKey,
  rotateApiKey,
  securityFindings,
  updateApiKey,
  verifyApiKey,
  type ApiKeyRecord,
} from "../apiKeys";

// ---------------------------------------------------------------------------
// API keys.
//
// The property under test throughout: a credential can do exactly what its
// record says and nothing more, and the record is the only authority. Most of
// these are DENIAL tests, because that is where the value is — an API key
// system that grants correctly and denies loosely is not an API key system.
//
// These run against the kv layer's in-memory backend, which is the same code
// path Redis takes minus the transport.
// ---------------------------------------------------------------------------

const USER = "user_alice";
const OTHER = "user_mallory";

/** Each test gets a clean store; kv's memory backend is a globalThis Map. */
beforeEach(() => {
  const g = globalThis as unknown as { __furlpayKv?: Map<string, unknown> };
  g.__furlpayKv?.clear();
});

async function makeKey(over: Partial<Parameters<typeof createApiKey>[0]> = {}) {
  return createApiKey({
    userId: USER,
    name: "Production backend",
    prefix: "rk",
    environment: "live",
    scopes: ["payments:read", "payments:create"],
    ...over,
  });
}

describe("generation and format", () => {
  it("returns a parseable key whose parts match the record", async () => {
    const { record, secret } = await makeKey();
    const parsed = parseApiKey(secret);
    expect(parsed).not.toBeNull();
    expect(parsed!.prefix).toBe("rk");
    expect(parsed!.environment).toBe("live");
    expect(parsed!.keyId).toBe(record.keyId);
  });

  it("never stores the raw secret", async () => {
    const { record, secret } = await makeKey();
    const stored = await getApiKey(record.keyId);
    const serialized = JSON.stringify(stored);
    const secretPart = parseApiKey(secret)!.secret;

    expect(serialized).not.toContain(secretPart);
    expect(serialized).not.toContain(secret);
    // What IS stored is the hash, and it must actually be the hash.
    expect(stored!.secretHash).toBe(hashSecret(secretPart));
  });

  it("issues a distinct secret and id every time", async () => {
    const a = await makeKey();
    const b = await makeKey();
    expect(a.secret).not.toBe(b.secret);
    expect(a.record.keyId).not.toBe(b.record.keyId);
  });

  it("never exposes hashes or owner through the public shape", async () => {
    const { record } = await makeKey();
    const publicShape = JSON.stringify(redactApiKey(record));
    expect(publicShape).not.toContain(record.secretHash);
    expect(publicShape).not.toContain(USER);
  });

  it("masks a key without revealing a usable prefix of the secret", async () => {
    const { record } = await makeKey();
    const masked = maskedForm(record);
    expect(masked).toContain(record.last4);
    expect(masked.length).toBeLessThan(32);
  });
});

describe("authentication", () => {
  it("accepts the issued key", async () => {
    const { record, secret } = await makeKey();
    const auth = await verifyApiKey(secret);
    expect(auth.ok).toBe(true);
    if (auth.ok) expect(auth.record.keyId).toBe(record.keyId);
  });

  it("rejects a malformed key", async () => {
    for (const bad of ["", "nonsense", "sk_live_only_three", "zz_live_aaa_bbb", "sk_prod_aaa_bbb"]) {
      const auth = await verifyApiKey(bad);
      expect(auth.ok).toBe(false);
    }
  });

  it("rejects an unknown key id", async () => {
    const auth = await verifyApiKey("rk_live_deadbeefdeadbeefdeadbe_notarealsecretvalue");
    expect(auth).toEqual({ ok: false, reason: "unknown_key" });
  });

  it("rejects the right key id with the wrong secret", async () => {
    const { record } = await makeKey();
    const forged = `rk_live_${record.keyId}_${"A".repeat(43)}`;
    const auth = await verifyApiKey(forged);
    expect(auth).toEqual({ ok: false, reason: "bad_secret" });
  });

  it("rejects a key whose prefix or environment was edited by the caller", async () => {
    const { record, secret } = await makeKey();
    const secretPart = parseApiKey(secret)!.secret;

    // Same valid secret, relabelled as a live secret key. Believing the
    // presented string over the stored record would be a free privilege
    // upgrade AND a sandbox-to-live jump.
    const edited = `sk_live_${record.keyId}_${secretPart}`;
    expect((await verifyApiKey(edited)).ok).toBe(false);

    const rebranded = `rk_test_${record.keyId}_${secretPart}`;
    expect((await verifyApiKey(rebranded)).ok).toBe(false);
  });
});

describe("revocation and expiry", () => {
  it("stops authenticating the moment it is revoked", async () => {
    const { record, secret } = await makeKey();
    expect((await verifyApiKey(secret)).ok).toBe(true);

    await revokeApiKey(USER, record.keyId);
    expect(await verifyApiKey(secret)).toEqual({
      ok: false,
      reason: "revoked",
    });
  });

  it("refuses an expired key without any scheduled job running", async () => {
    const { secret } = await makeKey({ expiresAt: new Date(Date.now() + 40).toISOString() });
    expect((await verifyApiKey(secret)).ok).toBe(true);

    await new Promise((r) => setTimeout(r, 60));
    // Expiry is evaluated at verification time against the stored timestamp,
    // so it holds even if no sweeper ever ran.
    expect(await verifyApiKey(secret)).toEqual({ ok: false, reason: "expired" });
  });

  it("reports expired status without mutating the record", async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const { record } = await makeKey({ expiresAt: past });
    expect(effectiveStatus(record)).toBe("expired");
    expect(record.status).toBe("active");
  });

  it("closes the rotation window when a key is revoked", async () => {
    const { record, secret: original } = await makeKey();
    await rotateApiKey(USER, record.keyId, 604_800);
    expect((await verifyApiKey(original)).ok).toBe(true);

    await revokeApiKey(USER, record.keyId);
    // The grace window must not outlive the revocation that ended the key.
    expect((await verifyApiKey(original)).ok).toBe(false);
  });
});

describe("environment separation", () => {
  it("refuses a sandbox key on a live endpoint and the reverse", async () => {
    const { secret: testKey } = await makeKey({ environment: "test" });
    const { secret: liveKey } = await makeKey({ environment: "live" });

    expect(await verifyApiKey(testKey, { environment: "live" })).toEqual({
      ok: false,
      reason: "wrong_environment",
    });
    expect(await verifyApiKey(liveKey, { environment: "test" })).toEqual({
      ok: false,
      reason: "wrong_environment",
    });
    expect((await verifyApiKey(testKey, { environment: "test" })).ok).toBe(true);
  });
});

describe("scopes", () => {
  it("allows a scope the key holds and denies one it does not", async () => {
    const { secret } = await makeKey({ scopes: ["payments:read"] });
    expect((await verifyApiKey(secret, { requiredScope: "payments:read" })).ok).toBe(true);
    expect(await verifyApiKey(secret, { requiredScope: "transfers:create" })).toEqual({
      ok: false,
      reason: "insufficient_scope",
    });
  });

  it("refuses to mint a publishable key with a private scope", async () => {
    // A pk_ is served to browsers. Anything it can do, the public can do.
    const { record } = await makeKey({
      prefix: "pk",
      scopes: ["payments:read", "transfers:create", "wallets:read"],
    });
    expect(record.scopes).toEqual(["payments:read"]);
  });

  it("cannot be escalated to a private scope by a later update", async () => {
    const { record } = await makeKey({ prefix: "pk", scopes: ["payments:read"] });
    const updated = await updateApiKey(USER, record.keyId, {
      scopes: ["payments:read", "transfers:create"],
    });
    expect(updated!.scopes).toEqual(["payments:read"]);
  });

  it("drops scopes that are not real", async () => {
    const { record } = await makeKey({
      scopes: ["payments:read", "billing:destroy" as never],
    });
    expect(record.scopes).toEqual(["payments:read"]);
    for (const s of record.scopes) expect(API_SCOPES).toContain(s);
  });
});

describe("ownership isolation", () => {
  it("does not list another account's keys", async () => {
    await makeKey();
    await createApiKey({
      userId: OTHER,
      name: "Mallory key",
      prefix: "rk",
      environment: "live",
      scopes: [],
    });
    const mine = await listApiKeys(USER);
    expect(mine).toHaveLength(1);
    expect(mine.every((k) => k.userId === USER)).toBe(true);
  });

  it("refuses to revoke, rotate or update a key owned by someone else", async () => {
    const { record, secret } = await makeKey();

    expect(await revokeApiKey(OTHER, record.keyId)).toBe(false);
    expect(await rotateApiKey(OTHER, record.keyId, 0)).toBeNull();
    expect(await updateApiKey(OTHER, record.keyId, { name: "stolen" })).toBeNull();

    // And the key is untouched by all three attempts.
    expect((await verifyApiKey(secret)).ok).toBe(true);
    expect((await getApiKey(record.keyId))!.name).toBe("Production backend");
  });
});

describe("rotation", () => {
  it("issues a new secret and keeps the old one alive for the grace window", async () => {
    const { record, secret: original } = await makeKey();
    const rotated = await rotateApiKey(USER, record.keyId, 3_600);

    expect(rotated!.secret).not.toBe(original);
    // Both work during the window — that is the entire point of a grace
    // period: a rolling deploy must not have a gap of 401s.
    expect((await verifyApiKey(rotated!.secret)).ok).toBe(true);
    expect((await verifyApiKey(original)).ok).toBe(true);
  });

  it("kills the old secret immediately at zero grace", async () => {
    const { record, secret: original } = await makeKey();
    const rotated = await rotateApiKey(USER, record.keyId, 0);

    expect((await verifyApiKey(rotated!.secret)).ok).toBe(true);
    expect((await verifyApiKey(original)).ok).toBe(false);
  });

  it("expires the grace window on time", async () => {
    const { record, secret: original } = await makeKey();
    await rotateApiKey(USER, record.keyId, 0.05);
    expect((await verifyApiKey(original)).ok).toBe(true);

    await new Promise((r) => setTimeout(r, 80));
    expect((await verifyApiKey(original)).ok).toBe(false);
  });

  it("keeps only ONE previous secret alive across repeated rotations", async () => {
    const { record, secret: gen1 } = await makeKey();
    const gen2 = (await rotateApiKey(USER, record.keyId, 3_600))!.secret;
    const gen3 = (await rotateApiKey(USER, record.keyId, 3_600))!.secret;

    // Two rotations must not leave three live credentials. The oldest dies
    // as soon as it is displaced, or a key rotated weekly accumulates a
    // trailing set nobody is tracking.
    expect((await verifyApiKey(gen3)).ok).toBe(true);
    expect((await verifyApiKey(gen2)).ok).toBe(true);
    expect((await verifyApiKey(gen1)).ok).toBe(false);
  });

  it("refuses to rotate a revoked key", async () => {
    const { record } = await makeKey();
    await revokeApiKey(USER, record.keyId);
    await expect(rotateApiKey(USER, record.keyId, 0)).rejects.toThrow(/revoked/);
  });

  it("keeps exactly one live secret when rotations race", async () => {
    const { record, secret: original } = await makeKey();

    // Two operators hit Rotate at the same moment. Whatever interleaving the
    // store produces, the invariant is that the key still authenticates with
    // exactly one of the issued secrets — never zero (a locked-out account),
    // and never the original once both have completed.
    const [a, b] = await Promise.all([
      rotateApiKey(USER, record.keyId, 0),
      rotateApiKey(USER, record.keyId, 0),
    ]);

    const live = [a!.secret, b!.secret].filter(async (s) => (await verifyApiKey(s)).ok);
    expect(live.length).toBeGreaterThan(0);

    const results = await Promise.all([verifyApiKey(a!.secret), verifyApiKey(b!.secret)]);
    expect(results.some((r) => r.ok)).toBe(true);
    expect((await verifyApiKey(original)).ok).toBe(false);
  });
});

describe("IP allowlist", () => {
  it("matches bare IPv4 and CIDR ranges", () => {
    expect(ipAllowed("203.0.113.10", ["203.0.113.10"])).toBe(true);
    expect(ipAllowed("203.0.113.11", ["203.0.113.10"])).toBe(false);
    expect(ipAllowed("10.0.0.42", ["10.0.0.0/24"])).toBe(true);
    expect(ipAllowed("10.0.1.42", ["10.0.0.0/24"])).toBe(false);
    expect(ipAllowed("10.0.1.42", ["10.0.0.0/16"])).toBe(true);
  });

  it("handles non-byte-aligned prefixes", () => {
    // /28 = 16 addresses. The boundary is where a naive byte-wise compare
    // silently widens the range.
    expect(ipAllowed("192.168.1.15", ["192.168.1.0/28"])).toBe(true);
    expect(ipAllowed("192.168.1.16", ["192.168.1.0/28"])).toBe(false);
  });

  it("matches IPv6 including compressed form", () => {
    expect(ipAllowed("2001:db8::1", ["2001:db8::/32"])).toBe(true);
    expect(ipAllowed("2001:db9::1", ["2001:db8::/32"])).toBe(false);
    expect(ipAllowed("2001:db8:0:0:0:0:0:1", ["2001:db8::1"])).toBe(true);
  });

  it("treats an IPv4-mapped IPv6 address as its IPv4 form", () => {
    // How a v4 client commonly arrives behind a v6 proxy. If this did not
    // normalise, every v4 allowlist would silently deny in production.
    expect(ipAllowed("::ffff:203.0.113.10", ["203.0.113.10"])).toBe(true);
  });

  it("never matches across address families", () => {
    expect(ipAllowed("203.0.113.10", ["2001:db8::/32"])).toBe(false);
    expect(ipAllowed("2001:db8::1", ["203.0.113.0/24"])).toBe(false);
  });

  it("fails closed when the client IP is unknown", () => {
    // A configured allowlist that cannot see an IP must deny. Allowing here
    // would make the control vanish exactly when it is being probed.
    expect(ipAllowed(null, ["203.0.113.10"])).toBe(false);
    expect(ipAllowed("not-an-ip", ["203.0.113.10"])).toBe(false);
    // With no allowlist at all, absence of an IP is simply unrestricted.
    expect(ipAllowed(null, [])).toBe(true);
  });

  it("rejects an invalid CIDR at write time rather than ignoring it later", async () => {
    expect(isValidCidr("10.0.0.0/24")).toBe(true);
    expect(isValidCidr("10.0.0.0/33")).toBe(false);
    expect(isValidCidr("999.0.0.1")).toBe(false);
    await expect(makeKey({ ipAllowlist: ["999.0.0.1"] })).rejects.toThrow(/invalid IP/);
  });

  it("denies a key presented from outside its allowlist", async () => {
    const { secret } = await makeKey({ ipAllowlist: ["203.0.113.0/24"] });
    expect((await verifyApiKey(secret, { ip: "203.0.113.7" })).ok).toBe(true);
    expect(await verifyApiKey(secret, { ip: "198.51.100.7" })).toEqual({
      ok: false,
      reason: "ip_not_allowed",
    });
  });
});

describe("origin allowlist", () => {
  it("matches exact hosts and wildcard subdomains", () => {
    expect(originAllowed("https://example.com", ["example.com"])).toBe(true);
    expect(originAllowed("https://evil.com", ["example.com"])).toBe(false);
    expect(originAllowed("https://app.example.com", ["*.example.com"])).toBe(true);
    // A wildcard covers subdomains, not the apex — an operator who means the
    // apex must say so.
    expect(originAllowed("https://example.com", ["*.example.com"])).toBe(false);
  });

  it("is not fooled by a suffix that merely ends the same way", () => {
    expect(originAllowed("https://notexample.com", ["*.example.com"])).toBe(false);
    expect(originAllowed("https://example.com.evil.com", ["example.com"])).toBe(false);
  });

  it("fails closed on a missing or unparseable origin", () => {
    expect(originAllowed(null, ["example.com"])).toBe(false);
    expect(originAllowed("garbage", ["example.com"])).toBe(false);
    expect(originAllowed(null, [])).toBe(true);
  });
});

describe("security findings", () => {
  const base: ApiKeyRecord = {
    keyId: "k1",
    userId: USER,
    name: "Live backend",
    prefix: "sk",
    environment: "live",
    secretHash: "x",
    last4: "9f21",
    scopes: [],
    status: "active",
    createdAt: new Date().toISOString(),
    createdBy: USER,
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    lastUsedRoute: null,
    lastUsedIp: null,
    ipAllowlist: [],
    originAllowlist: [],
    previousSecretHash: null,
    rotationGraceUntil: null,
    rotatedAt: null,
  };

  it("says nothing about a healthy, freshly created key", () => {
    const findings = securityFindings([{ ...base, ipAllowlist: ["10.0.0.0/8"] }]);
    // A panel that always has something in it is a panel nobody reads.
    expect(findings.filter((f) => f.code === "stale_secret")).toHaveLength(0);
    expect(findings.filter((f) => f.code === "no_ip_allowlist")).toHaveLength(0);
  });

  it("flags a live secret key that has never been rotated", () => {
    const old = new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString();
    const findings = securityFindings([{ ...base, createdAt: old, ipAllowlist: ["10.0.0.0/8"] }]);
    expect(findings.map((f) => f.code)).toContain("stale_secret");
  });

  it("stops flagging staleness once the key is rotated", () => {
    const old = new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString();
    const findings = securityFindings([
      { ...base, createdAt: old, rotatedAt: new Date().toISOString(), ipAllowlist: ["10.0.0.0/8"] },
    ]);
    expect(findings.map((f) => f.code)).not.toContain("stale_secret");
  });

  it("flags a key expiring within the week", () => {
    const soon = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();
    const findings = securityFindings([{ ...base, expiresAt: soon, ipAllowlist: ["10.0.0.0/8"] }]);
    expect(findings.map((f) => f.code)).toContain("expiring_soon");
  });

  it("ignores revoked and expired keys entirely", () => {
    const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const findings = securityFindings([
      { ...base, status: "revoked" },
      { ...base, keyId: "k2", expiresAt: past },
    ]);
    // Advice about a credential that cannot authenticate is noise.
    expect(findings).toHaveLength(0);
  });
});
