import { shortUid, stableHash } from "../avatar";

const UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("shortUid — display-only account id", () => {
  it("has the FP- + 7 Crockford-base32 chars format", () => {
    expect(shortUid(UUID)).toMatch(/^FP-[0-9A-HJKMNP-TV-Z]{7}$/);
  });

  it("is deterministic per id (stable across launches)", () => {
    expect(shortUid(UUID)).toBe(shortUid(UUID));
  });

  it("differs for different ids", () => {
    const a = shortUid("11111111-1111-1111-1111-111111111111");
    const b = shortUid("22222222-2222-2222-2222-222222222222");
    expect(a).not.toBe(b);
  });

  it("does NOT leak the raw UUID (one-way, not a credential)", () => {
    const uid = shortUid(UUID);
    expect(uid).not.toContain(UUID);
    expect(uid.replace("FP-", "").length).toBe(7);
    expect(uid).not.toContain("550e");
  });

  it("spreads across the id space (collision-free on a sample)", () => {
    const ids = Array.from({ length: 500 }, (_, i) => shortUid(`acct-${i}`));
    expect(new Set(ids).size).toBe(500);
  });
});

describe("stableHash", () => {
  it("is a deterministic unsigned 32-bit value", () => {
    const h = stableHash("abc");
    expect(h).toBe(stableHash("abc"));
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
});
