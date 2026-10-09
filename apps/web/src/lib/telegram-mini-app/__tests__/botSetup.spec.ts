import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
// @ts-expect-error — plain ESM operator script at the repo root, no type declarations
import { APPROVED_ORIGINS, BOT_COMMANDS, redact, sameCommands, validateMiniAppUrl } from "../../../../../../scripts/telegram-bot-setup.mjs";

const SCRIPT = join(__dirname, "../../../../../../scripts/telegram-bot-setup.mjs");
const BOT = join(__dirname, "../../telegram.ts");
const fake = "123456789:AAsynthetic_unit_test_token_not_real_000000";

describe("telegram-bot-setup: Mini App URL policy", () => {
  it("accepts only https on an approved origin", () => {
    expect(validateMiniAppUrl("https://furlpay.com/telegram")).toBe("https://furlpay.com/telegram");
    expect(APPROVED_ORIGINS).toEqual(["https://furlpay.com"]);
  });
  it.each([
    ["http://furlpay.com/telegram", /https/],
    ["https://www.furlpay.com/telegram", /not approved/],
    ["https://evil.example/telegram", /not approved/],
    ["https://user:pass@furlpay.com/telegram", /credentials/],
    ["https://furlpay.com/telegram#x", /fragment/],
    ["not a url", /valid URL/],
    ["", /not set/],
  ])("rejects %s", (url, msg) => {
    expect(() => validateMiniAppUrl(url)).toThrow(msg);
  });
  it("a preview origin needs explicit approval", () => {
    expect(() => validateMiniAppUrl("https://web-abc.vercel.app/telegram")).toThrow(/not approved/);
    expect(validateMiniAppUrl("https://web-abc.vercel.app/telegram", [...APPROVED_ORIGINS, "https://web-abc.vercel.app"])).toBe("https://web-abc.vercel.app/telegram");
  });
});

describe("telegram-bot-setup: secrets", () => {
  it("redacts the token in every form it can appear", () => {
    const line = `fetch https://api.telegram.org/bot${fake}/getMe failed; token=${fake}`;
    const out = redact(line, fake);
    expect(out).not.toContain(fake);
    expect(out).not.toMatch(/\d+:AA/);
    expect(redact(`bot${fake}/x`, "")).toBe("bot<redacted-token>/x");
  });
  it("refuses to run without a token, before any network call, and prints no secret", () => {
    const r = spawnSync(process.execPath, [SCRIPT], { env: { PATH: process.env.PATH ?? "" }, encoding: "utf8", timeout: 20_000 });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/TELEGRAM_BOT_TOKEN is missing/);
  });
  it("never registers or changes a webhook", () => {
    const src = readFileSync(SCRIPT, "utf8");
    expect(src).not.toMatch(/call\(\s*["'](setWebhook|deleteWebhook)["']/);
  });
});

describe("telegram-bot-setup: commands", () => {
  it("publishes exactly the commands the bot answers (no drift with lib/telegram.ts)", () => {
    const handled = [...readFileSync(BOT, "utf8").matchAll(/^\s+case "([a-z_]+)":/gm)].map((m) => m[1]).sort();
    expect(BOT_COMMANDS.map((c: { command: string }) => c.command).sort()).toEqual(handled);
  });
  it("Telegram's command limits hold", () => {
    for (const c of BOT_COMMANDS as { command: string; description: string }[]) {
      expect(c.command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(c.description.length).toBeGreaterThanOrEqual(1);
      expect(c.description.length).toBeLessThanOrEqual(256);
    }
  });
  it("compares command lists exactly, so re-running is a no-op", () => {
    expect(sameCommands(BOT_COMMANDS, [...BOT_COMMANDS])).toBe(true);
    expect(sameCommands(BOT_COMMANDS, BOT_COMMANDS.slice(1))).toBe(false);
  });
});
