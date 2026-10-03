import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// FP-WEB-01: user input in the swag notification email must not render as HTML.
const sendEmail = vi.fn().mockResolvedValue({ ok: true });
vi.mock("@/lib/email", () => ({ sendEmail: (m: unknown) => sendEmail(m) }));
vi.mock("@/lib/rateLimit", () => ({ rateLimitOr429: async () => null }));

import { POST } from "@/app/api/swag/redeem/route";
import { getSwag } from "@/lib/swag";

describe("swag redemption email", () => {
  it("escapes every user-supplied field in the HTML body", async () => {
    const slug = ["tee", "hoodie", "cap", "sticker-pack", "mug"].find((s) => getSwag(s) && !getSwag(s)!.sizes) ?? "sticker-pack";
    const evil = `<a href="https://evil.example">x</a>`;
    const res = await POST(
      new NextRequest("https://furlpay.com/api/swag/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: evil,
          email: "a@example.com",
          wallet: `<img src=x onerror=alert(1)>`,
          address: { line1: evil, city: "<b>c</b>", postal: "1", country: "'IN'" },
          items: [{ slug, qty: 1 }],
        }),
      }),
    );
    if (res.status !== 200) {
      // The catalogue slug guess failed; surface it rather than pass vacuously.
      throw new Error(`redeem returned ${res.status}: ${await res.text()}`);
    }
    const html = (sendEmail.mock.calls[0][0] as { html: string }).html;
    expect(html).not.toContain("<a href");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>c</b>");
    expect(html).toContain("&lt;a href=&quot;https://evil.example&quot;&gt;");
    expect(html).toContain("&#39;IN&#39;");
  });
});
