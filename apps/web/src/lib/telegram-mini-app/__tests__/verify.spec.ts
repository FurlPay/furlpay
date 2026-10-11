import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TELEGRAM_USER_ID_MAX, TelegramAuthError, verifyTelegramInitData } from "../verify";
import { checkoutPath, TransferDraftSchema } from "../contracts";
import { telegramLaunchUrl, telegramStartRoute } from "../config";

const token = "123456789:synthetic-unit-test-token";
const now = 1_800_000_000;
function signed(fields: Record<string, string> = {}) {
  const params = new URLSearchParams({ auth_date: String(now), user: JSON.stringify({ id: 123456789, first_name: "Test" }), query_id: "unit-test-launch", ...fields });
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const check = [...params].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${k}=${v}`).join("\n");
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}
describe("Telegram verified identity", () => {
  it("matches the database identity bound instead of allowing a later storage error", () => {
    expect(verifyTelegramInitData(signed({ user: JSON.stringify({ id: TELEGRAM_USER_ID_MAX, first_name: "Test" }) }), token, 300, now).user.id).toBe(TELEGRAM_USER_ID_MAX);
    expect(() => verifyTelegramInitData(signed({ user: JSON.stringify({ id: TELEGRAM_USER_ID_MAX + 1, first_name: "Test" }) }), token, 300, now)).toThrow(TelegramAuthError);
  });
  it("accepts a signed fresh user and signs the optional signature field too", () => {
    expect(verifyTelegramInitData(signed({ signature: "synthetic-ed25519-field" }), token, 300, now).user.id).toBe(123456789);
  });
  it.each(["", "hash=abc", "%zz=foo", "user=null&hash=" + "a".repeat(64)])("rejects malformed data %s", raw => expect(() => verifyTelegramInitData(raw, token, 300, now)).toThrow(TelegramAuthError));
  it("rejects spoofed user ids even with the old valid hash", () => {
    const raw = new URLSearchParams(signed()); raw.set("user", JSON.stringify({ id: 9, first_name: "Test" }));
    expect(() => verifyTelegramInitData(raw.toString(), token, 300, now)).toThrow(TelegramAuthError);
  });
  it("rejects duplicate fields and hash ambiguity", () => {
    expect(() => verifyTelegramInitData(signed() + "&user=%7B%7D", token, 300, now)).toThrow();
    expect(() => verifyTelegramInitData(signed() + "&hash=" + "0".repeat(64), token, 300, now)).toThrow();
  });
  it.each([String(now - 301), String(now + 31), "NaN", "1.5", "0"])("rejects stale, future and malformed dates %s", auth_date => expect(() => verifyTelegramInitData(signed({ auth_date }), token, 300, now)).toThrow());
  it("rejects missing user, unsafe numeric identity, and bot identity", () => {
    for (const user of ["null", "{}", JSON.stringify({ id: Number.MAX_SAFE_INTEGER + 1, first_name: "x" }), JSON.stringify({ id: 1, first_name: "x", is_bot: true })]) expect(() => verifyTelegramInitData(signed({ user }), token, 300, now)).toThrow();
  });
  it("fails closed without a bot token or with the wrong token", () => {
    expect(() => verifyTelegramInitData(signed(), "", 300, now)).toThrow();
    expect(() => verifyTelegramInitData(signed(), "wrong", 300, now)).toThrow();
  });
});
describe("Mini app navigation and payment safeguards", () => {
  it("allows only named non-sensitive deep links", () => {
    expect(telegramStartRoute("cards")).toBe("/telegram/cards");
    for (const value of ["https://evil.test", "__proto__", "constructor", "pay?amount=999"]) expect(telegramStartRoute(value)).toBeNull();
    expect(telegramLaunchUrl("cards", "ExampleTestBot", "payments")).toBe("https://t.me/ExampleTestBot/payments?startapp=cards");
    expect(telegramLaunchUrl("cards", "not a bot")).toBeNull();
    expect(telegramLaunchUrl("cards", "ExampleTestBot", "../evil")).toBeNull();
  });
  it("validates amounts and recipients before review", () => {
    const base = { amount: "1.123456", chain: "base", destination: "0x" + "1".repeat(40) };
    expect(TransferDraftSchema.safeParse(base).success).toBe(true);
    for (const amount of ["0", "-1", "NaN", "Infinity", "1000001", "1.1234567", "1e3"]) expect(TransferDraftSchema.safeParse({ ...base, amount }).success).toBe(false);
    expect(TransferDraftSchema.safeParse({ ...base, destination: "0xBAD" }).success).toBe(false);
    expect(TransferDraftSchema.safeParse({ ...base, chain: "unknown" }).success).toBe(false);
  });
  it("opens only the canonical merchant checkout path, discarding amount overrides", () => {
    const path = "/p/" + "a".repeat(24);
    expect(checkoutPath("https://furlpay.com" + path + "?amount=1")).toBe(path);
    for (const url of ["javascript:alert(1)", "https://evil.test" + path, "https://furlpay.com@evil.test" + path, "https://furlpay.com/profile", "https://furlpay.com/p/x", "https://furlpay.com" + path + "#secret"]) expect(checkoutPath(url)).toBeNull();
  });
});
