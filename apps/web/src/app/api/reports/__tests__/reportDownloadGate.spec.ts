import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The public report's download form: one business email, then the PDF.
// Real route, real lead capture and the in-memory lead store; only rate
// limiting, email, audit and logging are stubbed.

const sent: { to: string }[] = [];
vi.mock("@/lib/rateLimit", () => ({
  rateLimitOr429: async () => null,
  limit: async () => ({ ok: true, remaining: 1, retryAfterSeconds: 0 }),
}));
vi.mock("@/lib/audit", () => ({ audit: () => {} }));
vi.mock("@/lib/log", () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }));
vi.mock("@/lib/email", async (orig) => ({
  ...(await orig<typeof import("@/lib/email")>()),
  sendEmail: async (m: { to: string }) => (sent.push(m), { ok: true }),
}));

const { POST } = await import("../[slug]/download/route");
const { __resetLeadMemory, findLead, upsertLead } = await import("@/lib/leads/store");

const SLUG = "global-stablecoin-report-2026";
const download = (body: unknown) =>
  POST(
    new NextRequest(`https://furlpay.com/api/reports/${SLUG}/download`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug: SLUG }) },
  );

beforeEach(() => {
  __resetLeadMemory();
  sent.length = 0;
});

describe("report download: one business email, then the PDF", () => {
  it("an email alone is enough, and the response carries the public PDF", async () => {
    const res = await download({ email: "Ana@Company.com", consent: true });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.downloadUrl).toBe("/reports/global-stablecoin-report-2026.pdf");
    const lead = await findLead("ana@company.com");
    expect(lead?.emailType).toBe("business");
    expect(lead?.marketingConsent).toBe(false);
    expect(sent.map((m) => m.to)).toEqual(["ana@company.com"]);
  });

  it.each(["name@gmail.com", "someone@yahoo.com", "x@mailinator.com"])(
    "%s is refused as not a business email, and nothing is stored",
    async (email) => {
      const res = await download({ email, consent: true });
      expect(res.status).toBe(422);
      expect((await res.json()).detail).toBe("Please enter your business or work email.");
      expect(await findLead(email)).toBeNull();
    },
  );

  it("a malformed address or missing consent is a validation error, not a download", async () => {
    expect((await download({ email: "not-an-email", consent: true })).status).toBe(400);
    expect((await download({ email: "ana@company.com" })).status).toBe(400);
  });

  it("an email-only download does not blank a profile an earlier form recorded", async () => {
    await upsertLead(
      { email: "ana@company.com", firstName: "Ana", lastName: "Lee", company: "Co", jobTitle: "CFO", country: "SG", consent: true },
      "webinar_registration",
      "203.0.113.1",
    );
    expect((await download({ email: "ana@company.com", consent: true })).status).toBe(200);
    expect(await findLead("ana@company.com")).toMatchObject({ firstName: "Ana", company: "Co", jobTitle: "CFO", country: "SG" });
  });
});
