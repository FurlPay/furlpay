import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";

// AGENTS rule 1: the screening body is validated, not coerced.

let ip = 0;
const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/security/simulate", {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": `198.51.100.${(ip++ % 200) + 1}` },
      body: JSON.stringify(body),
    })
  );

describe("POST /api/security/simulate", () => {
  it("screens a well-formed request", async () => {
    const res = await post({ to: "0x52908400098527886E0F7030069857D2E4169EE7", valueUsd: 50, firstInteraction: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty("action");
  });

  it.each([
    [{}, "missing recipient"],
    [{ to: "0xabc", valueUsd: "lots" }, "non-numeric value (used to become NaN)"],
    [{ to: "0xabc", valueUsd: -5 }, "negative value"],
    [{ to: "0xabc", flaggedRecipient: "yes" }, "non-boolean signal"],
  ])("%j → 400 (%s)", async (body) => {
    expect((await post(body)).status).toBe(400);
  });
});
