import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComplyAdvantageProvider } from "@/lib/compliance/providers/complyAdvantage";

const secret = "test-webhook-secret";
const body = JSON.stringify({ type: "screening.completed", client_ref: "case_123" });

afterEach(() => vi.unstubAllEnvs());

describe("ComplyAdvantage webhook verification", () => {
  it("accepts only the exact HMAC hex digest", async () => {
    vi.stubEnv("COMPLYADVANTAGE_WEBHOOK_SECRET", secret);
    const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
    await expect(new ComplyAdvantageProvider().verifyWebhook(body, signature)).resolves.toMatchObject({
      provider: "complyadvantage",
      referenceId: "case_123",
    });
    await expect(new ComplyAdvantageProvider().verifyWebhook(body, `${signature}zz`)).rejects.toThrow(
      "signature verification failed"
    );
  });

  it("fails closed when the secret is absent", async () => {
    vi.stubEnv("COMPLYADVANTAGE_WEBHOOK_SECRET", "");
    await expect(new ComplyAdvantageProvider().verifyWebhook(body, "a".repeat(64))).rejects.toThrow(
      "COMPLYADVANTAGE_WEBHOOK_SECRET not set"
    );
  });
});
