import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/telegram", () => ({ handleUpdate: async () => ({ method: "sendMessage", chat_id: 1, text: "ok" }) }));
const { POST } = await import("../route");

const post = (token?: string) =>
  POST(
    new NextRequest("https://furlpay.com/api/telegram/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token !== undefined ? { "x-telegram-bot-api-secret-token": token } : {}) },
      body: JSON.stringify({ update_id: 1 }),
    }),
  );

afterEach(() => vi.unstubAllEnvs());

describe("telegram webhook secret (SEC-P3-001)", () => {
  it("fails closed when no secret is configured", async () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "");
    expect((await post("anything")).status).toBe(401);
  });

  it("rejects a missing, wrong, prefix or longer token", async () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "s3cret-token-value");
    for (const t of [undefined, "", "wrong", "s3cret-token-valu", "s3cret-token-value-and-more"]) {
      expect((await post(t)).status).toBe(401);
    }
  });

  it("accepts the exact secret", async () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "s3cret-token-value");
    expect((await post("s3cret-token-value")).status).toBe(200);
  });
});
