import {
  REDACTED,
  isDeniedKey,
  scrubString,
  scrubUrl,
  scrubValue,
} from "../scrub";

// These tests are the contract for what may leave the device. Each case is a
// value that actually appears in FurlPay request/response payloads.

describe("isDeniedKey", () => {
  it.each([
    "password",
    "Password",
    "authToken",
    "x-auth-token",
    "refresh_token",
    "sessionId",
    "privateKey",
    "private_key",
    "mnemonic",
    "seedPhrase",
    "cvv",
    "cardNumber",
    "card_number",
    "iban",
    "accountNumber",
    "idempotencyKey",
    "email",
    "phoneNumber",
    "passportNumber",
    "apiKey",
    "totpSecret",
    "signature",
  ])("denies %s", (key) => {
    expect(isDeniedKey(key)).toBe(true);
  });

  it.each(["amount", "status", "chain", "network", "createdAt", "count", "symbol"])(
    "allows %s",
    (key) => {
      expect(isDeniedKey(key)).toBe(false);
    }
  );
});

describe("scrubString", () => {
  it("redacts a BIP-39 mnemonic hiding in prose", () => {
    const seed =
      "abandon ability able about above absent absorb abstract absurd abuse access accident";
    const out = scrubString(`restore failed for ${seed} at step 2`);
    expect(out).not.toContain("abandon");
    expect(out).not.toContain("accident");
    expect(out).toContain("[mnemonic]");
  });

  it("redacts an EVM address", () => {
    const out = scrubString("send to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e failed");
    expect(out).not.toContain("0x742d35Cc");
    expect(out).toContain("[evm]");
  });

  it("redacts a 64-char private key before the shorter address rule can split it", () => {
    const key = "4c0883a69102937d6231471b5dbb6204fe512961708279e1b2c0e9b6b7b1a1f7";
    const out = scrubString(`key=${key}`);
    expect(out).toContain("[hex]");
    expect(out).not.toContain(key);
    // The whole key must go, not a prefix of it.
    expect(out).not.toMatch(/[0-9a-f]{20,}/);
  });

  it("redacts a JWT", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    expect(scrubString(`Bearer ${jwt}`)).toContain("[jwt]");
  });

  it("redacts a card number with or without grouping", () => {
    expect(scrubString("4111 1111 1111 1111")).toContain("[pan]");
    expect(scrubString("4111111111111111")).toContain("[pan]");
  });

  it("redacts an email and a phone number", () => {
    const out = scrubString("contact ashutosh@example.com or +91 98765 43210");
    expect(out).not.toContain("@example.com");
    expect(out).toContain("[email]");
    expect(out).toContain("[phone]");
  });

  it("leaves ordinary error prose alone", () => {
    const msg = "Request timed out after 30 seconds";
    expect(scrubString(msg)).toBe(msg);
  });

  it("is idempotent — scrubbing twice does not corrupt the placeholder", () => {
    const once = scrubString("to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e");
    expect(scrubString(once)).toBe(once);
  });

  it("does not lose matches across repeated calls (global regex lastIndex)", () => {
    const s = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
    // A /g regex whose lastIndex is not reset silently skips the second call.
    expect(scrubString(s)).toContain("[evm]");
    expect(scrubString(s)).toContain("[evm]");
    expect(scrubString(s)).toContain("[evm]");
  });
});

describe("scrubValue", () => {
  it("redacts denied keys at any depth", () => {
    const out = scrubValue({
      amount: 100,
      user: { email: "a@b.com", nested: { authToken: "abc123" } },
    }) as Record<string, any>;
    expect(out.amount).toBe(100);
    expect(out.user.email).toBe(REDACTED);
    expect(out.user.nested.authToken).toBe(REDACTED);
  });

  it("scrubs sensitive values even under an allowed key", () => {
    const out = scrubValue({
      note: "paying 0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
    }) as Record<string, string>;
    expect(out.note).toContain("[evm]");
  });

  it("survives a cycle", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    expect(() => scrubValue(a)).not.toThrow();
    expect((scrubValue(a) as any).self).toBe("[circular]");
  });

  it("caps depth rather than recursing forever", () => {
    let deep: Record<string, unknown> = { end: true };
    for (let i = 0; i < 20; i++) deep = { next: deep };
    expect(JSON.stringify(scrubValue(deep))).toContain("depth-limit");
  });

  it("caps long arrays", () => {
    const out = scrubValue(Array.from({ length: 200 }, (_, i) => i)) as unknown[];
    expect(out.length).toBe(51);
    expect(out[50]).toBe("…150 more");
  });

  it("truncates a very long string", () => {
    const out = scrubValue("x".repeat(5000)) as string;
    expect(out.length).toBeLessThan(1100);
    expect(out).toContain("[truncated]");
  });

  it("converts an Error without losing the class name", () => {
    const e = new TypeError("bad address 0x742d35Cc6634C0532925a3b844Bc454e4438f44e");
    const out = scrubValue(e) as { name: string; message: string };
    expect(out.name).toBe("TypeError");
    expect(out.message).toContain("[evm]");
  });
});

describe("scrubUrl", () => {
  it("drops the query string entirely", () => {
    expect(scrubUrl("https://furlpay.com/api/tx?token=secret&id=9")).toBe(
      "https://furlpay.com/api/tx"
    );
  });

  it("normalizes identifier segments so routes group", () => {
    expect(scrubUrl("https://furlpay.com/api/transaction/9f8e7d6c5b4a3f2e1d0c")).toBe(
      "https://furlpay.com/api/transaction/:id"
    );
    expect(scrubUrl("https://furlpay.com/api/cards/123456")).toBe(
      "https://furlpay.com/api/cards/:id"
    );
  });

  it("keeps a readable route shape", () => {
    expect(scrubUrl("https://furlpay.com/api/markets/quotes")).toBe(
      "https://furlpay.com/api/markets/quotes"
    );
  });

  it("scrubs an unparseable url as prose instead of returning it raw", () => {
    expect(scrubUrl("not a url ashutosh@example.com")).toContain("[email]");
  });
});
