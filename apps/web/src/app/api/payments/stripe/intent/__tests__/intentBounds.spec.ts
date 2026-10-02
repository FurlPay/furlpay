import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// AGENTS rule 1 on a public route that creates real Stripe objects: bounded
// amount, USD only (the webhook credits only USD).

const createCryptoPaymentIntent = vi.fn(async () => ({ clientSecret: "cs_test", id: "pi_test" }));
vi.mock("@/lib/payments/stripe", () => ({ createCryptoPaymentIntent }));

const { POST } = await import("../route");
const post = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/payments/stripe/intent", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => createCryptoPaymentIntent.mockClear());

describe("POST /api/payments/stripe/intent", () => {
  it.each([
    [{ amountInCents: 5_000_001 }],
    [{ amountInCents: 0 }],
    [{ amountInCents: 10.5 }],
    [{ amountInCents: "1000" }],
    [{ amountInCents: 1000, currency: "eur" }],
  ])("refuses %j without calling Stripe", async (body) => {
    expect((await post(body)).status).toBe(400);
    expect(createCryptoPaymentIntent).not.toHaveBeenCalled();
  });

  it("creates a USD intent within bounds", async () => {
    const res = await post({ amountInCents: 2500 });
    expect(res.status).toBe(200);
    expect(createCryptoPaymentIntent).toHaveBeenCalledWith(2500, "usd");
  });
});
