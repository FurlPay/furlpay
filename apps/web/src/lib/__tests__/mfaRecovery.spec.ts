import { describe, expect, it } from "vitest";
import {
  RECOVERY_CODE_COUNT,
  consumeRecoveryCode,
  generateRecoveryCodes,
  hashCode,
  normalizeCode,
} from "../mfaRecovery";

// ---------------------------------------------------------------------------
// MFA recovery codes.
//
// A recovery code is a second factor that bypasses TOTP, so the properties that
// matter are: it is unguessable, it is not recoverable from storage, and it works
// exactly once. Each is tested directly rather than through the route, because
// each is a property of the primitive.
// ---------------------------------------------------------------------------

describe("generation", () => {
  it("mints the documented number of distinct codes", () => {
    const { codes, hashes } = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    expect(hashes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(hashes).size).toBe(RECOVERY_CODE_COUNT);
  });

  it("formats codes as two readable groups", () => {
    for (const code of generateRecoveryCodes().codes) {
      expect(code).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
    }
  });

  it("omits characters a human would misread", () => {
    // No I/L/O/U: 1/l, 0/O and U/V are the transcription errors people actually
    // make on a code they copied onto paper.
    const all = generateRecoveryCodes().codes.join("");
    for (const ch of ["I", "L", "O", "U"]) expect(all).not.toContain(ch);
  });

  it("does not repeat across sets", () => {
    const a = new Set(generateRecoveryCodes().codes);
    const b = generateRecoveryCodes().codes;
    expect(b.some((c) => a.has(c))).toBe(false);
  });

  it("is not obviously biased toward the start of the alphabet", () => {
    // Guards the rejection sampling. A `% 30` fold would over-represent the
    // first 16 symbols; over 4000 characters that skew is visible.
    const chars: string[] = [];
    for (let i = 0; i < 40; i++) chars.push(...generateRecoveryCodes().codes.join("").split(""));
    const early = chars.filter((c) => "ABCDEFGHJKMNPQ".includes(c)).length;
    const share = early / chars.length;
    // 14 of 30 symbols ≈ 0.467. A modulo fold pushes this well past 0.55.
    expect(share).toBeGreaterThan(0.38);
    expect(share).toBeLessThan(0.55);
  });
});

describe("storage", () => {
  it("stores hashes, never the codes", () => {
    const { codes, hashes } = generateRecoveryCodes();
    for (const code of codes) {
      expect(hashes).not.toContain(code);
      expect(hashes).not.toContain(normalizeCode(code));
      // And no hash contains the code as a substring.
      expect(hashes.some((h) => h.includes(normalizeCode(code)))).toBe(false);
    }
    for (const h of hashes) expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes are stable and domain-separated", () => {
    expect(hashCode("ABCDE-FGHJK")).toBe(hashCode("ABCDE-FGHJK"));
    // A bare sha256 of the normalised code would collide with any other system
    // hashing the same string; the prefix prevents cross-context reuse.
    expect(hashCode("ABCDE-FGHJK")).not.toBe(
      require("crypto").createHash("sha256").update("ABCDEFGHJK").digest("hex")
    );
  });
});

describe("normalisation — dashes and case are presentation only", () => {
  it.each([
    ["abcde-fghjk", "ABCDEFGHJK"],
    ["ABCDE-FGHJK", "ABCDEFGHJK"],
    ["  abcdefghjk  ", "ABCDEFGHJK"],
    ["ABCDE FGHJK", "ABCDEFGHJK"],
  ])("%s normalises to %s", (input, expected) => {
    expect(normalizeCode(input)).toBe(expected);
  });

  it("accepts a code typed back in any of those forms", () => {
    const { codes, hashes } = generateRecoveryCodes();
    const code = codes[0];
    for (const variant of [code, code.toLowerCase(), code.replace("-", ""), ` ${code} `]) {
      expect(consumeRecoveryCode(variant, hashes).ok).toBe(true);
    }
  });
});

describe("consumption — single use", () => {
  it("accepts a valid code and removes exactly that one", () => {
    const { codes, hashes } = generateRecoveryCodes();
    const res = consumeRecoveryCode(codes[3], hashes);

    expect(res.ok).toBe(true);
    expect(res.remaining).toHaveLength(RECOVERY_CODE_COUNT - 1);
    expect(res.remaining).not.toContain(hashCode(codes[3]));
    // Every other code survives.
    for (const [i, c] of codes.entries()) {
      if (i !== 3) expect(res.remaining).toContain(hashCode(c));
    }
  });

  it("refuses the same code a second time", () => {
    const { codes, hashes } = generateRecoveryCodes();
    const first = consumeRecoveryCode(codes[0], hashes);
    expect(first.ok).toBe(true);

    const replay = consumeRecoveryCode(codes[0], first.remaining);
    expect(replay.ok).toBe(false);
    expect(replay.remaining).toEqual(first.remaining);
  });

  it("rejects a wrong code without consuming anything", () => {
    const { hashes } = generateRecoveryCodes();
    const res = consumeRecoveryCode("ZZZZZ-ZZZZZ", hashes);
    expect(res.ok).toBe(false);
    expect(res.remaining).toEqual(hashes);
  });

  it.each([
    ["an empty string", ""],
    ["whitespace", "   "],
    ["a TOTP code", "123456"],
    ["a very long string", "A".repeat(500)],
    ["the literal word undefined", "undefined"],
  ])("rejects %s", (_label, input) => {
    const { hashes } = generateRecoveryCodes();
    expect(consumeRecoveryCode(input, hashes).ok).toBe(false);
  });

  it("handles an empty or missing set without throwing", () => {
    expect(consumeRecoveryCode("ABCDE-FGHJK", []).ok).toBe(false);
    expect(consumeRecoveryCode("ABCDE-FGHJK", undefined).ok).toBe(false);
    expect(consumeRecoveryCode("ABCDE-FGHJK", undefined).remaining).toEqual([]);
  });

  it("does not throw on a stored hash of the wrong length", () => {
    // timingSafeEqual throws on a length mismatch; a corrupted or legacy row must
    // not take down the recovery path.
    const { codes, hashes } = generateRecoveryCodes();
    const corrupted = ["deadbeef", ...hashes];
    expect(() => consumeRecoveryCode(codes[0], corrupted)).not.toThrow();
    expect(consumeRecoveryCode(codes[0], corrupted).ok).toBe(true);
  });

  it("burns the whole set one code at a time", () => {
    const { codes, hashes } = generateRecoveryCodes();
    let remaining = hashes;
    for (const code of codes) {
      const res = consumeRecoveryCode(code, remaining);
      expect(res.ok).toBe(true);
      remaining = res.remaining;
    }
    expect(remaining).toEqual([]);
    // Exhausted: nothing works any more.
    expect(consumeRecoveryCode(codes[0], remaining).ok).toBe(false);
  });
});
