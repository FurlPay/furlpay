import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// HTTP behaviour of the three research-download routes, with storage, KV,
// email and lead capture mocked. No real email, storage or KV is touched.

const state = {
  report: null as null | Record<string, unknown>,
  consume: { ok: true, grantId: "G".repeat(43), grant: { slug: "r", objectKey: "r/v1.pdf", expiresAt: "2099-01-01T00:00:00Z" } } as unknown,
  grant: null as unknown,
  signed: { ok: true, url: "https://proj.supabase.co/storage/v1/object/sign/b/r/v1.pdf?token=t" } as unknown,
  configured: true,
  uses: 0,
  sent: { ok: true } as unknown,
  emails: [] as { to: string; text: string }[],
};

vi.mock("@/lib/rateLimit", () => ({
  rateLimitOr429: async () => null,
  limit: async () => ({ ok: true, remaining: 1, retryAfterSeconds: 0 }),
}));
vi.mock("@/lib/audit", () => ({ audit: () => {} }));
vi.mock("@/lib/log", () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }));
vi.mock("@/lib/content", async (orig) => ({
  ...(await orig<typeof import("@/lib/content")>()),
  getPublishedReport: (slug: string) => (state.report && state.report.slug === slug ? state.report : undefined),
}));
vi.mock("@/lib/research/storage", () => ({
  storageConfigured: () => state.configured,
  signedPdfUrl: async () => state.signed,
}));
vi.mock("@/lib/research/access", async (orig) => ({
  ...(await orig<typeof import("@/lib/research/access")>()),
  issueVerificationToken: async () => "T".repeat(43),
  consumeVerificationToken: async () => state.consume,
  readGrant: async () => state.grant,
  redeemGrantUse: async () => state.uses++ < 3,
}));
vi.mock("@/lib/leads/capture", () => ({
  captureLead: async (req: NextRequest) => {
    const b = await req.json();
    return { response: null, lead: { email: String(b.email).toLowerCase(), firstName: b.firstName, marketingConsent: b.marketingConsent === true } };
  },
}));
vi.mock("@/lib/email", async (orig) => ({
  ...(await orig<typeof import("@/lib/email")>()),
  sendEmail: async (m: { to: string; text: string }) => (state.emails.push(m), state.sent),
}));

const requestRoute = await import("../../reports/[slug]/download/route");
const verifyRoute = await import("../download-verifications/route");
const downloadRoute = await import("../downloads/[grantId]/route");

const REPORT = { slug: "r", title: "Report R", status: "published", privatePdf: { objectKey: "r/v1.pdf", bytes: 1, sha256: "0".repeat(64), version: "1" } };
const form = (email: string) => ({ firstName: "A", lastName: "B", email, company: "C", jobTitle: "D", country: "SG", consent: true });
const post = (url: string, body: unknown) =>
  new NextRequest(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  state.report = { ...REPORT };
  state.configured = true;
  state.uses = 0;
  state.sent = { ok: true };
  state.emails = [];
  state.consume = { ok: true, grantId: "G".repeat(43), grant: { slug: "r", objectKey: "r/v1.pdf", expiresAt: "2099-01-01T00:00:00Z" } };
  state.grant = { slug: "r", objectKey: "r/v1.pdf", expiresAt: "2099-01-01T00:00:00Z" };
  state.signed = { ok: true, url: "https://proj.supabase.co/storage/v1/object/sign/b/r/v1.pdf?token=t" };
});

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });

describe("POST /api/reports/[slug]/download (verified delivery)", () => {
  it("sends a verification email with the token in the URL FRAGMENT and never returns a file link", async () => {
    const res = await requestRoute.POST(post("http://x/api/reports/r/download", form("reader@tinyco.sg")), ctx("r"));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, verification: "sent", expiresMinutes: 30 });
    expect(JSON.stringify(body)).not.toMatch(/T{43}|\.pdf|supabase/);
    expect(state.emails).toHaveLength(1);
    expect(state.emails[0].text).toContain(`/research/verify#t=${"T".repeat(43)}`);
    expect(state.emails[0].text).not.toContain("?t=");
  });

  it("answers identically whatever the address — no disclosure of prior requests", async () => {
    const a = await (await requestRoute.POST(post("http://x/api/reports/r/download", form("one@a.com")), ctx("r"))).json();
    const b = await (await requestRoute.POST(post("http://x/api/reports/r/download", form("two@b.com")), ctx("r"))).json();
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
  });

  it("refuses a throwaway mailbox before storing a lead", async () => {
    const res = await requestRoute.POST(post("http://x/api/reports/r/download", form("x@mailinator.com")), ctx("r"));
    expect(res.status).toBe(422);
    expect(state.emails).toHaveLength(0);
  });

  it("fails visibly when private storage is not configured", async () => {
    state.configured = false;
    const res = await requestRoute.POST(post("http://x/api/reports/r/download", form("a@b.com")), ctx("r"));
    expect(res.status).toBe(503);
    expect(state.emails).toHaveLength(0);
  });

  it("does not claim an email was sent when sending failed", async () => {
    state.sent = { ok: false, error: "budget" };
    const res = await requestRoute.POST(post("http://x/api/reports/r/download", form("a@b.com")), ctx("r"));
    expect(res.status).toBe(503);
  });

  it("404s an unpublished report exactly like a missing one", async () => {
    state.report = null;
    const res = await requestRoute.POST(post("http://x/api/reports/r/download", form("a@b.com")), ctx("r"));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/research/download-verifications", () => {
  it("returns a grant download path, no-store and noindex", async () => {
    const res = await verifyRoute.POST(post("http://x/api/research/download-verifications", { token: "T".repeat(43) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, downloadUrl: `/api/research/downloads/${"G".repeat(43)}` });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("410 for a used link, 400 for an invalid or expired one", async () => {
    state.consume = { ok: false, reason: "used" };
    expect((await verifyRoute.POST(post("http://x/v", { token: "T".repeat(43) }))).status).toBe(410);
    state.consume = { ok: false, reason: "invalid" };
    expect((await verifyRoute.POST(post("http://x/v", { token: "T".repeat(43) }))).status).toBe(400);
  });

  it("refuses a token issued for a report since unpublished or re-versioned", async () => {
    state.report = { ...REPORT, privatePdf: { ...REPORT.privatePdf, objectKey: "r/v2.pdf" } };
    expect((await verifyRoute.POST(post("http://x/v", { token: "T".repeat(43) }))).status).toBe(400);
  });

  it("rejects a malformed body", async () => {
    expect((await verifyRoute.POST(post("http://x/v", { nope: 1 }))).status).toBe(400);
  });
});

describe("GET /api/research/downloads/[grantId]", () => {
  const get = () => downloadRoute.GET(new NextRequest(`http://x/api/research/downloads/${"G".repeat(43)}`), { params: Promise.resolve({ grantId: "G".repeat(43) }) });

  it("303-redirects to the signed URL with no-store, noindex and no-referrer", async () => {
    const res = await get();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://proj.supabase.co/storage/v1/object/sign/b/r/v1.pdf?token=t");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("410 once a grant has been redeemed its maximum number of times", async () => {
    for (let i = 0; i < 3; i++) expect((await get()).status).toBe(303);
    expect((await get()).status).toBe(410);
  });

  it("410 for an expired or unknown grant", async () => {
    state.grant = null;
    expect((await get()).status).toBe(410);
  });

  it("410 when the report was unpublished after the grant was issued", async () => {
    state.report = null;
    expect((await get()).status).toBe(410);
  });

  it("503 — never a public fallback — when storage cannot sign", async () => {
    state.signed = { ok: false, reason: "not_configured" };
    expect((await get()).status).toBe(503);
  });
});
